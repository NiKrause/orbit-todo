/**
 * Write Permission Access Controller for OrbitDB v3
 * 
 * This follows the OrbitDB v3 pattern where access controllers are factory functions
 * that return async functions for creating access controller instances.
 */

// Global map to store write permissions across all databases
const globalWritePermissions = new Map() // databaseAddress -> Map<peerId, { grantedAt, expiresAt }>

const type = 'write-permission'

/**
 * Create a WritePermissionAccessController factory function
 * @param {Object} options - Configuration options
 * @param {string} options.ownerPeerId - The peer ID of the database owner
 * @param {number} options.permissionTTL - Permission duration in milliseconds (default: 48 hours)
 * @returns {Function} Factory function that creates access controller instances
 */
export const WritePermissionAccessController = (options = {}) => async ({ orbitdb, identities, address }) => {
  // Use OrbitDB identity ID as owner (not libp2p peer ID)
  const ownerPeerId = options.ownerPeerId || orbitdb.identity.id
  const permissionTTL = options.permissionTTL || (48 * 60 * 60 * 1000) // 48 hours

  console.log(`🔐 Creating WritePermissionAccessController for owner: ${ownerPeerId}`)

  // Set address for the access controller - use the provided address or create a new one
  const controllerAddress = address || `/write-permission/${orbitdb.identity.id}/${Date.now()}`
  
  /**
   * Check if an entry can be appended to the log
   * @param {Object} entry - The log entry to check
   * @returns {boolean} True if the entry can be appended
   */
  const canAppend = async (entry) => {
    // Get the identity of the writer
    const writerIdentity = await identities.getIdentity(entry.identity)
    if (!writerIdentity) {
      console.log(`❌ No identity found for ${entry.identity}`)
      return false
    }
    
    const writerId = writerIdentity.id
    
    console.log(`🔐 Checking write permission for identity ${writerId}`)
    console.log(`🔐 Owner peer ID: ${ownerPeerId}`)
    console.log(`🔐 OrbitDB identity ID: ${orbitdb.identity.id}`)
    
    // Always allow the owner to write
    // Compare with both the peer ID passed in options and the OrbitDB identity ID
    if (writerId === ownerPeerId || writerId === orbitdb.identity.id) {
      console.log(`✅ Owner ${writerId} granted write access`)
      return await identities.verifyIdentity(writerIdentity)
    }
    
    // For non-owners, check if they have explicit write permission
    // Use the entry's ID to identify the database (not entry.log.id)
    console.log(`🔍 Debug: entry structure:`, JSON.stringify(entry, null, 2))
    const databaseAddress = entry?.id
    console.log(`🔍 Debug: Extracted database address from entry:`, databaseAddress)
    
    // Show all available permissions in the global map
    console.log(`🔍 Debug: All global permissions:`, Array.from(globalWritePermissions.entries()).map(([addr, perms]) => ({
      address: addr,
      permissions: Array.from(perms.entries())
    })))
    
    if (databaseAddress) {
      const dbPermissions = globalWritePermissions.get(databaseAddress) || new Map()
      console.log(`🔍 Debug: Permissions for database ${databaseAddress}:`, Array.from(dbPermissions.entries()))
      
      // Check if peer has valid write permission
      const permission = dbPermissions.get(writerId)
      console.log(`🔍 Debug: Permission for peer ${writerId}:`, permission)
      
      if (permission && Date.now() < permission.expiresAt) {
        console.log(`✅ Peer ${writerId} has valid write permission (expires: ${new Date(permission.expiresAt).toISOString()})`)
        return await identities.verifyIdentity(writerIdentity)
      } else if (permission) {
        console.log(`❌ Peer ${writerId} has expired write permission (expired: ${new Date(permission.expiresAt).toISOString()})`)
      } else {
        console.log(`❌ Peer ${writerId} has no write permission for database ${databaseAddress}`)
      }
    } else {
      console.log(`❌ Could not extract database address from entry`)
    }
    
    // Clean up expired permissions for all databases
    cleanupExpiredPermissions()
    
    console.log(`❌ Peer ${writerId} denied write access - no valid permission`)
    return false
  }
  
  /**
   * Grant write permission to a peer for this database
   * @param {string} peerId - The OrbitDB identity ID to grant permission to
   * @param {number} duration - Permission duration in milliseconds (optional)
   */
  const grantWritePermission = (peerId, duration = null) => {
    // The address parameter contains the actual database address when the database is opened
    const databaseAddress = address

    console.log(`🔍 Debug: Granting permission for database address: ${databaseAddress}`)
    console.log(`🔍 Debug: Granting permission to OrbitDB identity: ${peerId}`)

    grantWritePermissionToDatabase(databaseAddress, peerId, duration)
  }

  /**
   * Revoke write permission from a peer for this database
   * @param {string} peerId - The OrbitDB identity ID to revoke permission from
   */
  const revokeWritePermission = (peerId) => {
    const databaseAddress = address || controllerAddress
    revokeWritePermissionFromDatabase(databaseAddress, peerId)
  }

  return {
    type,
    address: controllerAddress,
    canAppend,
    grantWritePermission,
    revokeWritePermission
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

// Set the type property for OrbitDB registration
WritePermissionAccessController.type = type

/**
 * Factory function for OrbitDB (kept for compatibility)
 */
export const WritePermissionAccessControllerFactory = (options = {}) => {
  return WritePermissionAccessController(options)
}
