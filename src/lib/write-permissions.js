import { writable } from 'svelte/store'
import { getOrbitDB, getCurrentTodoDB, getOrOpenPeerWritePermissionDb } from './p2p/database.js'
import { getLibP2P } from './p2p/network.js'
import { getWritePermissionsForDatabase } from './access-controllers/WritePermissionAccessController.js'

// Store for write permission requests
export const writePermissionRequestsStore = writable([])

// Map to track pending requests to avoid duplicates
const pendingRequests = new Map()

// My write permission request database (where others write requests to me)
let myWritePermissionDB = null

/**
 * Initialize the per-peer write permission request system
 */
export async function initializeWritePermissionSystem() {
  const orbitdb = getOrbitDB()
  if (!orbitdb) {
    throw new Error('OrbitDB not initialized')
  }
  
  const libp2p = getLibP2P()
  if (!libp2p) {
    throw new Error('LibP2P not initialized')
  }
  
  const myPeerId = libp2p.peerId.toString()

  try {
    // Create/open MY write permission request database
    // This database allows everyone to write permission requests TO ME
    const myDbName = `write-permission-requests-${myPeerId}`
    myWritePermissionDB = await orbitdb.open(myDbName, {
      type: 'keyvalue'
      // Use default access controller (public write access)
      // OrbitDB v3 defaults to allowing anyone to write if no AccessController is specified
    })

    console.log('✅ Write permission request database initialized:', {
      address: myWritePermissionDB.address,
      addressString: myWritePermissionDB.address.toString(),
      dbName: myWritePermissionDB.dbName,
      type: myWritePermissionDB.type
    })
    
    // Force the database to be announced to the network for discovery
    // by writing and immediately deleting a marker entry
    try {
      console.log('📢 [DISCOVERY] Force announcing write permission database for peer discovery...')
      const announceKey = `discovery-marker-${myPeerId}`
      const markerData = {
        type: 'write-permission-database',
        peerId: myPeerId,
        purpose: 'Make this database discoverable',
        timestamp: new Date().toISOString()
      }
      
      // Write marker to trigger network announcement
      await myWritePermissionDB.set(announceKey, markerData)
      console.log('✅ [DISCOVERY] Write permission database marker written, should now be discoverable')
      
      // Keep the marker - it will help with categorization
      // (Don't delete it immediately so peers can categorize this as a write permission DB)
      
    } catch (announceError) {
      console.warn('⚠️ [DISCOVERY] Failed to announce write permission database:', announceError)
    }
    
    // Set up event listeners for permission requests
    setupWritePermissionEventListeners()

    // Clean up expired requests on startup
    await cleanupExpiredRequests()

    return myWritePermissionDB
  } catch (error) {
    console.error('❌ Failed to initialize write permission system:', error)
    throw error
  }
}

/**
 * Request write permission for a specific database
 */
export async function requestWritePermission(targetDatabaseAddress, targetPeerID, reason = '') {
  if (!myWritePermissionDB) {
    await initializeWritePermissionSystem()
  }

  const libp2p = getLibP2P()
  if (!libp2p) {
    throw new Error('LibP2P not initialized')
  }

  const myPeerId = libp2p.peerId.toString()
  const requestId = `${myPeerId}-${targetDatabaseAddress}-${Date.now()}`

  // Check if we already have a pending request
  if (pendingRequests.has(`${myPeerId}-${targetDatabaseAddress}`)) {
    console.log('⏳ Write permission request already pending for this database')
    return pendingRequests.get(`${myPeerId}-${targetDatabaseAddress}`)
  }

  const request = {
    id: requestId,
    requesterPeerId: myPeerId,
    targetDatabaseAddress,
    targetPeerID,
    reason,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString() // 48 hours
  }

  try {
    // Open the target peer's write permission database using the proper address
    const targetWritePermissionDB = await getOrOpenPeerWritePermissionDb(targetPeerID);

    if (!targetWritePermissionDB) {
      throw new Error('Failed to access target peer write permission database');
    }

    console.log('📝 [DEBUG] About to write permission request to TARGET peer database:', {
      requestId,
      request,
      targetWritePermissionDBAddress: targetWritePermissionDB.address.toString(),
      targetWritePermissionDBName: targetWritePermissionDB.dbName || 'unknown',
      targetPeerID
    })
    
    // Check current state of the target database before writing
    try {
      const currentEntries = await targetWritePermissionDB.all()
      console.log('🔍 [DEBUG] Target database state before write:', {
        entryCount: Object.keys(currentEntries).length,
        entries: Object.keys(currentEntries)
      })
    } catch (preCheckError) {
      console.warn('⚠️ [DEBUG] Failed to check target database state before write:', preCheckError)
    }
    
    // Write to the target peer's database (not our own!)
    await targetWritePermissionDB.set(requestId, request)
    console.log('✅ [DEBUG] Successfully wrote request to TARGET peer database')
    
    pendingRequests.set(`${myPeerId}-${targetDatabaseAddress}`, request)
    console.log('💾 [DEBUG] Added to pending requests cache:', pendingRequests.size, 'total pending')
    
    // Wait longer for the write to propagate and replicate to the target peer
    console.log('⏳ [DEBUG] Waiting for database write to replicate to target peer...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Verify the request was actually written to the target database
    try {
      const verifyRequest = await targetWritePermissionDB.get(requestId)
      console.log('🔍 [DEBUG] Verification - request in TARGET database:', !!verifyRequest, verifyRequest)
      
      // Also check the full state of the database after write
      const updatedEntries = await targetWritePermissionDB.all()
      console.log('🔍 [DEBUG] Target database state after write:', {
        entryCount: Object.keys(updatedEntries).length,
        entries: Object.keys(updatedEntries),
        newlyWrittenExists: !!updatedEntries[requestId]
      })
    } catch (verifyError) {
      console.warn('⚠️ [DEBUG] Failed to verify request was written to target database:', verifyError)
    }
    
    // Keep the database connection open for a bit longer to allow replication
    console.log('🔗 [DEBUG] Keeping database connection open for replication...')
    await new Promise(resolve => setTimeout(resolve, 2000))
    console.log('✅ [DEBUG] Replication delay completed')
    
    console.log('📝 Write permission request sent to target peer:', {
      requestId,
      targetDatabase: targetDatabaseAddress,
      targetPeer: targetPeerID,
      targetPeerWritePermissionDB: targetWritePermissionDB.address.toString()
    })

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('write-permission-request-sent', {
        detail: { targetPeerId: targetPeerID }
      }))
    }

    return request
  } catch (error) {
    console.error('❌ Failed to send write permission request:', error)
    throw error
  }
}

/**
 * Grant write permission to a requester
 */
export async function grantWritePermission(requestId) {
  if (!myWritePermissionDB) {
    throw new Error('Write permission system not initialized')
  }

  const libp2p = getLibP2P()
  const myPeerId = libp2p.peerId.toString()

  try {
    // Get the request
    const request = await myWritePermissionDB.get(requestId)
    if (!request) {
      throw new Error('Permission request not found')
    }

    // Verify we're the target peer for this request
    if (request.targetPeerID !== myPeerId) {
      throw new Error('Not authorized to grant this permission')
    }

    // Check if request is still valid (not expired)
    if (new Date(request.expiresAt) < new Date()) {
      throw new Error('Permission request has expired')
    }

    // Update request status
    const updatedRequest = {
      ...request,
      status: 'granted',
      grantedAt: new Date().toISOString(),
      grantedBy: myPeerId
    }

    await myWritePermissionDB.set(requestId, updatedRequest)

    // Grant actual write permission to the database
    const currentDB = getCurrentTodoDB()
    if (currentDB && currentDB.access && typeof currentDB.access.grantWritePermission === 'function') {
      currentDB.access.grantWritePermission(request.requesterPeerId)
    }

    console.log('✅ Write permission granted:', {
      requestId,
      requester: request.requesterPeerId,
      database: request.targetDatabaseAddress
    })

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('write-permission-granted', {
        detail: { requesterPeerId: request.requesterPeerId }
      }))
    }

    return updatedRequest
  } catch (error) {
    console.error('❌ Failed to grant write permission:', error)
    throw error
  }
}

/**
 * Deny write permission request
 */
export async function denyWritePermission(requestId, reason = '') {
  if (!myWritePermissionDB) {
    throw new Error('Write permission system not initialized')
  }

  const libp2p = getLibP2P()
  const myPeerId = libp2p.peerId.toString()

  try {
    const request = await myWritePermissionDB.get(requestId)
    if (!request) {
      throw new Error('Permission request not found')
    }

    if (request.targetPeerID !== myPeerId) {
      throw new Error('Not authorized to deny this permission')
    }

    const updatedRequest = {
      ...request,
      status: 'denied',
      deniedAt: new Date().toISOString(),
      deniedBy: myPeerId,
      denialReason: reason
    }

    await myWritePermissionDB.set(requestId, updatedRequest)

    console.log('❌ Write permission denied:', {
      requestId,
      requester: request.requesterPeerId,
      reason
    })

    return updatedRequest
  } catch (error) {
    console.error('❌ Failed to deny write permission:', error)
    throw error
  }
}

/**
 * Get all write permission requests (for UI display)
 */
export async function getWritePermissionRequests() {
  if (!myWritePermissionDB) {
    console.log('⚠️ [DEBUG] getWritePermissionRequests called but myWritePermissionDB is null')
    return []
  }

  try {
    console.log('🔍 [DEBUG] Fetching all write permission requests from database...')
    const allRequests = await myWritePermissionDB.all()
    console.log('🔍 [DEBUG] Raw requests from database:', {
      count: Object.keys(allRequests).length,
      keys: Object.keys(allRequests),
      allRequests
    })
    
    const requests = Object.values(allRequests).map(entry => entry.value || entry)
    console.log('🔍 [DEBUG] Processed requests:', requests)
    
    // Filter out expired requests
    const validRequests = requests.filter(request => {
      const isValid = new Date(request.expiresAt) > new Date()
      if (!isValid) {
        console.log('🗑️ [DEBUG] Filtering out expired request:', request.id)
      }
      return isValid
    })
    
    console.log('🔍 [DEBUG] Valid requests after filtering:', validRequests.length)
    
    const sortedRequests = validRequests.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))
    console.log('🔍 [DEBUG] Final sorted requests:', sortedRequests)
    
    return sortedRequests
  } catch (error) {
    console.error('❌ Failed to get write permission requests:', error)
    return []
  }
}

/**
 * Get write permission requests for my databases
 */
export async function getMyWritePermissionRequests() {
  const libp2p = getLibP2P()
  if (!libp2p) {
    console.log('⚠️ [DEBUG] getMyWritePermissionRequests: libp2p not available')
    return []
  }

  const myPeerId = libp2p.peerId.toString()
  console.log('🔍 [DEBUG] Getting incoming requests for my peer ID:', myPeerId)
  
  const allRequests = await getWritePermissionRequests()
  console.log('🔍 [DEBUG] All requests before filtering for incoming:', allRequests.length)
  
  const incomingRequests = allRequests.filter(request => {
    const isForMe = request.targetPeerID === myPeerId
    const isFromMe = request.requesterPeerId === myPeerId
    console.log('🔍 [DEBUG] Request filter check:', {
      requestId: request.id,
      targetPeerID: request.targetPeerID,
      requesterPeerId: request.requesterPeerId,
      myPeerId,
      isForMe,
      isFromMe,
      willInclude: isForMe && !isFromMe
    })
    return isForMe && !isFromMe // Only requests TO me, not FROM me
  })
  
  console.log('🔍 [DEBUG] Incoming requests for me:', incomingRequests.length, incomingRequests)
  return incomingRequests
}

/**
 * Get write permission requests I've made (searches across all peer write permission databases)
 */
export async function getMyOutgoingWritePermissionRequests() {
  const libp2p = getLibP2P()
  if (!libp2p) {
    console.log('⚠️ [DEBUG] getMyOutgoingWritePermissionRequests: libp2p not available')
    return []
  }

  const myPeerId = libp2p.peerId.toString()
  console.log('🔍 [DEBUG] Getting outgoing requests from my peer ID:', myPeerId)
  
  // Import the function to get peer write permission database addresses
  const { getPeerWritePermissionDbAddresses, getOrOpenPeerWritePermissionDb } = await import('./p2p/database.js')
  
  const peerWritePermissionDbAddresses = getPeerWritePermissionDbAddresses()
  console.log('🔍 [DEBUG] Checking outgoing requests across peer write permission databases:', {
    peerCount: peerWritePermissionDbAddresses.size,
    peers: Array.from(peerWritePermissionDbAddresses.keys())
  })
  
  const allOutgoingRequests = []
  
  // Check each peer's write permission database for requests FROM me
  for (const [peerId, dbAddress] of peerWritePermissionDbAddresses) {
    try {
      console.log(`🔍 [DEBUG] Checking peer ${peerId}'s write permission database for my outgoing requests...`)
      
      // Open the peer's write permission database
      const peerWritePermissionDB = await getOrOpenPeerWritePermissionDb(peerId)
      
      // Get all requests from this peer's database
      const allRequests = await peerWritePermissionDB.all()
      const requests = Object.values(allRequests).map(entry => entry.value || entry)
      
      // Filter for requests FROM me
      const outgoingRequestsFromThisPeer = requests.filter(request => {
        const isFromMe = request.requesterPeerId === myPeerId
        const isValidRequest = request.id && request.status && request.requestedAt
        
        if (isFromMe && isValidRequest) {
          console.log(`🔍 [DEBUG] Found outgoing request in peer ${peerId}'s database:`, {
            requestId: request.id,
            targetPeerID: request.targetPeerID,
            status: request.status
          })
        }
        
        return isFromMe && isValidRequest
      })
      
      allOutgoingRequests.push(...outgoingRequestsFromThisPeer)
      
    } catch (error) {
      console.warn(`⚠️ [DEBUG] Failed to check peer ${peerId}'s write permission database for outgoing requests:`, error)
    }
  }
  
  // Filter out expired requests
  const validOutgoingRequests = allOutgoingRequests.filter(request => {
    const isValid = new Date(request.expiresAt) > new Date()
    if (!isValid) {
      console.log('🗑️ [DEBUG] Filtering out expired outgoing request:', request.id)
    }
    return isValid
  })
  
  // Sort by most recent first
  const sortedOutgoingRequests = validOutgoingRequests.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))
  
  console.log('🔍 [DEBUG] Final outgoing requests from me across all peers:', {
    totalFound: sortedOutgoingRequests.length,
    requests: sortedOutgoingRequests.map(r => ({
      id: r.id,
      targetPeerID: r.targetPeerID,
      status: r.status,
      requestedAt: r.requestedAt
    }))
  })
  
  return sortedOutgoingRequests
}

/**
 * Clean up expired permission requests
 */
export async function cleanupExpiredRequests() {
  if (!myWritePermissionDB) {
    return 0
  }

  try {
    const allRequests = await myWritePermissionDB.all()
    const now = new Date()
    let cleanedCount = 0

    for (const [key, entry] of Object.entries(allRequests)) {
      const request = entry.value || entry
      if (new Date(request.expiresAt) <= now) {
        await myWritePermissionDB.delete ? await myWritePermissionDB.delete(key) : await myWritePermissionDB.set(key, null)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired write permission requests`)
    }

    return cleanedCount
  } catch (error) {
    console.error('❌ Failed to clean up expired requests:', error)
    return 0
  }
}

/**
 * Set up event listeners for write permission updates
 */
function setupWritePermissionEventListeners() {
  if (!myWritePermissionDB) {
    console.warn('⚠️ Cannot setup write permission event listeners - myWritePermissionDB is null')
    return
  }

  console.log('🔔 Setting up write permission database event listeners for:', {
    address: myWritePermissionDB.address.toString(),
    dbName: myWritePermissionDB.dbName
  })
  
  myWritePermissionDB.events.on('update', async (entry) => {
    console.log('📝 [EVENT] Write permission database update received:', {
      entry,
      payload: entry.payload,
      operation: entry.payload?.op,
      key: entry.payload?.key,
      value: entry.payload?.value
    })
    
    // Check if this is a new request (status === 'pending')
    const request = entry.payload?.value || entry.value || entry;
    if (request && request.status === 'pending') {
      const libp2p = getLibP2P()
      const myPeerId = libp2p?.peerId?.toString()
      
      // If this is a request TO me (not FROM me), show a toast
      if (request.targetPeerID === myPeerId && request.requesterPeerId !== myPeerId) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('write-permission-request-received', {
            detail: { requesterPeerId: request.requesterPeerId }
          }))
        }
      }
    }
    
    // Update the reactive store
    const requests = await getWritePermissionRequests()
    writePermissionRequestsStore.set(requests)
  })

  console.log('✅ Write permission event listeners configured')
}

/**
 * Get diagnostic information about the write permission database status
 */
export function getWritePermissionDatabaseStatus() {
  const libp2p = getLibP2P()
  const myPeerId = libp2p?.peerId?.toString() || 'unknown'
  
  return {
    myPeerId,
    myWritePermissionDB: {
      exists: !!myWritePermissionDB,
      address: myWritePermissionDB?.address?.toString() || null,
      dbName: myWritePermissionDB?.dbName || null,
      type: myWritePermissionDB?.type || null,
      // Check if events object exists (indicates active subscription)
      hasEvents: !!myWritePermissionDB?.events,
      // Check if we can get data (indicates database is open)
      canRead: false  // Will be set below
    },
    timestamp: new Date().toISOString()
  }
}

/**
 * Test if Browser B's write permission database is actively listening
 */
export async function testWritePermissionDatabaseConnection() {
  const status = getWritePermissionDatabaseStatus()
  
  if (myWritePermissionDB) {
    try {
      // Try to read from the database to test if it's still open
      const testData = await myWritePermissionDB.all()
      status.myWritePermissionDB.canRead = true
      status.myWritePermissionDB.entryCount = Object.keys(testData).length
      
      // Check if database is actively replicating
      status.myWritePermissionDB.isReplicating = !!myWritePermissionDB.replicator
      status.myWritePermissionDB.replicatorPeers = myWritePermissionDB.replicator?.peers?.size || 0
      
      // Test if we can write to our own database (this should trigger our own event listener)
      const testKey = `self-test-${Date.now()}`
      const testValue = { test: true, timestamp: new Date().toISOString() }
      
      console.log('🧪 [TEST] Writing test entry to own write permission database...')
      await myWritePermissionDB.set(testKey, testValue)
      
      // Wait a moment for the event to fire
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Clean up the test entry
      await myWritePermissionDB.del(testKey)
      
      console.log('✅ [DIAGNOSTIC] Write permission database is readable:', {
        entryCount: status.myWritePermissionDB.entryCount,
        address: status.myWritePermissionDB.address,
        isReplicating: status.myWritePermissionDB.isReplicating,
        replicatorPeers: status.myWritePermissionDB.replicatorPeers
      })
    } catch (error) {
      status.myWritePermissionDB.canRead = false
      status.myWritePermissionDB.error = error.message
      console.error('❌ [DIAGNOSTIC] Write permission database read test failed:', error)
    }
  }
  
  return status
}

/**
 * Get my own write permission database instance
 */
export function getMyWritePermissionDatabase() {
  return myWritePermissionDB
}

/**
 * Get my own write permission database address
 */
export function getMyWritePermissionDatabaseAddress() {
  return myWritePermissionDB?.address?.toString() || null
}

/**
 * Get my own write permission database name
 */
export function getMyWritePermissionDatabaseName() {
  return myWritePermissionDB?.dbName || null
}

/**
 * Ensure write permission database is open and ready
 */
export async function ensureWritePermissionDatabaseOpen() {
  if (!myWritePermissionDB) {
    console.log('⚠️ Write permission database not initialized, initializing now...')
    await initializeWritePermissionSystem()
    return
  }
  
  // Test if database is actually open
  try {
    await myWritePermissionDB.all()
    console.log('✅ Write permission database is already open and readable')
  } catch (error) {
    if (error.message.includes('Database is not open') || error.message.includes('closed')) {
      console.log('🔄 Write permission database was closed, reopening...')
      
      // Get the database address to reopen it
      const dbAddress = myWritePermissionDB.address.toString()
      const orbitdb = getOrbitDB()
      
      if (orbitdb) {
        try {
          // Reopen the database
          myWritePermissionDB = await orbitdb.open(dbAddress, {
            type: 'keyvalue'
          })
          
          console.log('✅ Write permission database reopened:', {
            address: myWritePermissionDB.address.toString(),
            dbName: myWritePermissionDB.dbName
          })
          
          // Re-setup event listeners
          setupWritePermissionEventListeners()
          
        } catch (reopenError) {
          console.error('❌ Failed to reopen write permission database:', reopenError)
          // Fall back to full reinitialization
          await initializeWritePermissionSystem()
        }
      }
    } else {
      console.error('❌ Unexpected error testing write permission database:', error)
    }
  }
}

/**
 * Check if I have write permission for a database by querying the write permission database
 */
export async function hasWritePermission(databaseAddress, selectedPeerId = null) {
  const currentDB = getCurrentTodoDB()
  if (!currentDB) {
    return false
  }

  const libp2p = getLibP2P()
  if (!libp2p) return false

  const myPeerId = libp2p.peerId.toString()
  
  // If no database address specified, check current database
  const targetAddress = databaseAddress || currentDB.address?.toString()
  
  if (!targetAddress) {
    console.warn('🔍 No database address to check permissions for')
    return false
  }
  
  console.log('🔍 [DEBUG] hasWritePermission called with:', {
    databaseAddress,
    targetAddress,
    currentDBAddress: currentDB.address?.toString(),
    selectedPeerId,
    myPeerId
  })
  
  // Key insight: If we have a selectedPeerId, it means we're viewing a peer's database
  // If selectedPeerId is null/empty, we're on our own database
  if (selectedPeerId && selectedPeerId !== myPeerId) {
    // This is definitely a peer's database - check their write permission database
    console.log('🔍 This is a peer\'s database - checking write permission database for granted permissions')
    
    try {
      // Open the peer's write permission database to check for granted permissions
      const peerWritePermissionDB = await getOrOpenPeerWritePermissionDb(selectedPeerId)
      
  console.log('🔍 [PERMISSION CHECK] Opened write permission database:', {
    address: peerWritePermissionDB.address.toString(),
    dbName: peerWritePermissionDB.dbName || 'unknown',
    selectedPeerId
  })
      
      // Get all permission requests from the write permission database
      const allRequests = await peerWritePermissionDB.all()
      const requests = Object.values(allRequests).map(entry => entry.value || entry)
      
      console.log('🔍 [PERMISSION CHECK] All requests in write permission database:', {
        totalRequests: requests.length,
        requests: requests.map(r => ({
          id: r.id,
          requesterPeerId: r.requesterPeerId,
          targetDatabaseAddress: r.targetDatabaseAddress,
          status: r.status
        }))
      })
      
      // Look for granted permission requests from me to this database
      const grantedPermission = requests.find(request => 
        request.requesterPeerId === myPeerId &&
        request.targetDatabaseAddress === targetAddress &&
        request.status === 'granted' &&
        new Date(request.expiresAt) > new Date() // Not expired
      )
      
      const hasPermission = !!grantedPermission
      
      console.log('🔍 [PERMISSION CHECK] Write permission check result:', {
        targetAddress,
        myPeerId,
        selectedPeerId,
        hasPermission,
        grantedPermission: grantedPermission
      })
      
      return hasPermission
      
    } catch (error) {
      console.warn('Error checking write permissions in peer write permission database:', error)
      console.log('🔍 Assuming no write permission for peer database due to error')
      return false
    }
  } else {
    // This is our own database (selectedPeerId is null/empty or equals our peerId)
    console.log('🔍 This is my own database - I have write permission')
    return true
  }
}
