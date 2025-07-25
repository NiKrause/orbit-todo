/**
 * Write Permission Access Controller for OrbitDB v3
 * 
 * This follows the OrbitDB v3 pattern where access controllers are functions
 * that return async functions for checking write permissions.
 */

// Global map to store write permissions across all databases
const globalWritePermissions = new Map() // databaseAddress -> Map<peerId, { grantedAt, expiresAt }>

/**
 * Create a write permission access controller
 * @param {Object} options - Configuration options
 * @param {string} options.ownerPeerId - The peer ID of the database owner
 * @param {number} options.permissionTTL - Permission duration in milliseconds (default: 48 hours)
 * @returns {Function} Async function that checks write permissions
 */
export const WritePermissionAccessController = (options = {}) => {
  const ownerPeerId = options.ownerPeerId
  const permissionTTL = options.permissionTTL || (48 * 60 * 60 * 1000) // 48 hours
  
  return async (log, entry, identityProvider, canAppend) => {
    // Get the database address from the log
    const databaseAddress = log.id
    
    // Get the peer ID from the entry
    const peerId = entry.identity
    
    console.log(`🔐 Checking write permission for ${peerId} on database ${databaseAddress}`)
    
    // Always allow the owner to write
    if (ownerPeerId && peerId === ownerPeerId) {
      console.log(`✅ Owner ${peerId} granted write access`)
      return true
    }
    
    // Get permissions for this database
    const dbPermissions = globalWritePermissions.get(databaseAddress) || new Map()
    
    // Check if peer has valid write permission
    const permission = dbPermissions.get(peerId)
    if (permission && Date.now() < permission.expiresAt) {
      console.log(`✅ Peer ${peerId} has valid write permission`)
      return true
    }
    
    // Clean up expired permissions for all databases
    cleanupExpiredPermissions()
    
    console.log(`❌ Peer ${peerId} denied write access - no valid permission`)
    return false
  }
}

/**
 * Grant write permission to a peer for a specific database
 * @param {string} databaseAddress - The database address
 * @param {string} peerId - The peer ID to grant permission to
 * @param {number} duration - Permission duration in milliseconds (optional)
 */
export const grantWritePermissionToDatabase = (databaseAddress, peerId, duration = null) => {
  const now = Date.now()
  const ttl = duration || (48 * 60 * 60 * 1000) // 48 hours default
  
  // Get or create permissions map for this database
  let dbPermissions = globalWritePermissions.get(databaseAddress)
  if (!dbPermissions) {
    dbPermissions = new Map()
    globalWritePermissions.set(databaseAddress, dbPermissions)
  }
  
  // Grant permission
  dbPermissions.set(peerId, {
    grantedAt: now,
    expiresAt: now + ttl
  })
  
  console.log(`✅ Write permission granted to ${peerId} for database ${databaseAddress} for ${Math.round(ttl / (60 * 60 * 1000))} hours`)
}

/**
 * Revoke write permission from a peer for a specific database
 * @param {string} databaseAddress - The database address
 * @param {string} peerId - The peer ID to revoke permission from
 */
export const revokeWritePermissionFromDatabase = (databaseAddress, peerId) => {
  const dbPermissions = globalWritePermissions.get(databaseAddress)
  if (dbPermissions) {
    dbPermissions.delete(peerId)
    console.log(`❌ Write permission revoked from ${peerId} for database ${databaseAddress}`)
  }
}

/**
 * Get all write permissions for a specific database
 * @param {string} databaseAddress - The database address
 * @returns {Map} Map of peer IDs to permission objects
 */
export const getWritePermissionsForDatabase = (databaseAddress) => {
  cleanupExpiredPermissions()
  return globalWritePermissions.get(databaseAddress) || new Map()
}

/**
 * Clean up expired permissions across all databases
 */
export const cleanupExpiredPermissions = () => {
  const now = Date.now()
  let totalCleaned = 0
  
  for (const [databaseAddress, dbPermissions] of globalWritePermissions) {
    const expiredPeers = []
    
    for (const [peerId, permission] of dbPermissions) {
      if (now >= permission.expiresAt) {
        expiredPeers.push(peerId)
      }
    }
    
    expiredPeers.forEach(peerId => {
      dbPermissions.delete(peerId)
      console.log(`🧹 Cleaned up expired write permission for ${peerId} on database ${databaseAddress}`)
      totalCleaned++
    })
    
    // Remove empty permission maps
    if (dbPermissions.size === 0) {
      globalWritePermissions.delete(databaseAddress)
    }
  }
  
  return totalCleaned
}

/**
 * Factory function for OrbitDB (kept for compatibility)
 */
export const WritePermissionAccessControllerFactory = (options = {}) => {
  return WritePermissionAccessController(options)
}
