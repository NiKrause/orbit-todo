import { createOrbitDB, useAccessController } from '@orbitdb/core'
import { WritePermissionAccessController } from '../access-controllers/WritePermissionAccessController.js'
import { writable } from 'svelte/store'
import { OrbitDBTopicDiscovery } from '../orbit-discovery.js'
import { initializeWritePermissionSystem } from '../write-permissions.js'
import { formatPeerId } from './peer-discovery.js'

/**
 * Database state management
 */
let orbitdb = null
let myOwnTodoDB = null  // My own database - always writable
let currentViewedTodoDB = null  // Currently viewed database (could be mine or peer's)

// Store database event callbacks globally so they persist across function calls
let databaseUpdateCallbacks = []

// Map to store peerId -> TODO OrbitDB address (for dropdown)
const peerOrbitDbAddresses = new Map()

// Map to store peerId -> Write Permission OrbitDB address (for permission requests)
const peerWritePermissionDbAddresses = new Map()

// Map to store peerId -> TODO OrbitDB database instance (kept open)
const peerTodoDbInstances = new Map()

// Map to store peerId -> Write Permission OrbitDB database instance (kept open)
const peerWritePermissionDbInstances = new Map()

// Map to store discovered OrbitDB topics -> discovery info
const discoveredOrbitDBTopics = new Map()

// Store for reactive updates to discovered databases
export const discoveredDatabasesStore = writable([])

/**
 * Initialize OrbitDB with Helia instance
 */
export async function initializeOrbitDB(helia) {
  if (orbitdb) return orbitdb
  
  console.log('🛬 Creating OrbitDB instance...')
  const orbitStartTime = Date.now()
  
  // Register the custom access controller
  useAccessController(WritePermissionAccessController)
  
  orbitdb = await createOrbitDB({
    ipfs: helia,
    id: 'todo-p2p-app',
    directory: './orbitdb-data'
  })
  
  console.log(`✅ OrbitDB created in ${Date.now() - orbitStartTime}ms`)
  
  // Set up OrbitDB topic discovery
  await setupOrbitDBDiscovery(helia)
  
  // Initialize write permission system
  try {
    await initializeWritePermissionSystem()
    console.log('✅ Write permission system initialized')
  } catch (error) {
    console.warn('⚠️ Failed to initialize write permission system:', error.message)
  }
  
  return orbitdb
}

/**
 * Set up OrbitDB topic discovery
 */
async function setupOrbitDBDiscovery(helia) {
  console.log('🔍 Setting up OrbitDB topic discovery...')
  
  // Clear any existing mappings to start fresh
  peerOrbitDbAddresses.clear()
  discoveredOrbitDBTopics.clear()
  console.log('🧹 Cleared existing peer-to-database mappings')
  
  const discovery = new OrbitDBTopicDiscovery(helia)
  
  // Add debug listener to see if ANY subscription-change events occur
  helia.libp2p.services.pubsub.addEventListener('subscription-change', (event) => {
    const eventData = {
      peerId: event.detail.peerId.toString(),
      subscriptions: event.detail.subscriptions.map(s => ({
        topic: s.topic,
        subscribe: s.subscribe,
        isOrbitDB: s.topic.startsWith('/orbitdb/') 
      }))
    }
    console.log('🎯 [DEBUG] Raw subscription-change event received:', eventData)
    
    // Check if any OrbitDB topics were detected
    const orbitDBTopics = eventData.subscriptions.filter(s => s.isOrbitDB && s.subscribe)
    if (orbitDBTopics.length > 0) {
      console.log('🎯 [ORBITDB DETECTED] OrbitDB topics found:', orbitDBTopics.map(s => s.topic))
    }
  })
  
  await discovery.startDiscovery(async (topic, announcingPeerId) => {
    console.log(`🎯 [DISCOVERY] Automatically subscribing to discovered OrbitDB topic: ${topic} from announcing peer: ${announcingPeerId}`)
    try {
      
      // Get current state
      const announcingPeerIdStr = announcingPeerId.toString()
      const myPeerId = helia.libp2p.peerId.toString()
      const myDbAddress = myOwnTodoDB?.address?.toString()
      
      console.log(`📝 [DEBUG] Processing OrbitDB topic discovery:`, {
        announcingPeerIdStr,
        myPeerId,
        topic,
        myDbAddress,
        isMyOwnPeer: announcingPeerIdStr === myPeerId,
        isMyOwnDb: myDbAddress && topic === myDbAddress,
        peerMapBefore: Array.from(peerOrbitDbAddresses.keys()),
        peerMapSizeBefore: peerOrbitDbAddresses.size
      })
      
      // Only map if this is from a different peer (not ourselves)
      // and we can definitively verify it's not our own database
      const isMyOwnPeer = announcingPeerIdStr === myPeerId
      const isMyOwnDb = myDbAddress && topic === myDbAddress
      
      if (!isMyOwnPeer && !isMyOwnDb) {
        // This is a peer's database - map it
        const databaseOwnerPeerId = announcingPeerIdStr
        
        // Store the discovered OrbitDB topic
        discoveredOrbitDBTopics.set(topic, {
          peerId: databaseOwnerPeerId,
          topic,
          discoveredAt: new Date().toISOString()
        })
        
        // Determine database type by opening and inspecting the database contents
        const isWritePermissionDb = await categorizeDatabaseByContent(topic, databaseOwnerPeerId)
        
        // Update the reactive store
        updateDiscoveredDatabasesStore()
        
        // Dispatch event for UI updates AFTER mapping is complete
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('orbitdb-database-discovered', {
              detail: { peerId: announcingPeerIdStr, topic, address: topic, isWritePermissionDb }
            }))
        }
      } else {
        console.log(`🚫 [SKIPPED] Not mapping - this is our own database or peer:`, {
          isMyOwnPeer,
          isMyOwnDb,
          topic,
          myDbAddress
        })
      }
      
      console.log(`📝 [DEBUG] After processing discovery:`, {
        peerMapAfter: Array.from(peerOrbitDbAddresses.keys()),
        peerMapSizeAfter: peerOrbitDbAddresses.size,
        finalMapping: Array.from(peerOrbitDbAddresses.entries()).map(([peerId, addr]) => `${formatPeerId(peerId)} -> ${addr.slice(-8)}`)
      })
      
    } catch (error) {
      console.error(`❌ Failed to subscribe to OrbitDB topic ${topic}:`, error)
    }
  })


}

/**
 * Categorize a discovered database by temporarily opening it to inspect contents
 */
async function categorizeDatabaseByContent(topic, databaseOwnerPeerId) {
  console.log(`🔍 [CATEGORIZE] Inspecting database content for: ${topic} from peer: ${formatPeerId(databaseOwnerPeerId)}`)
  
  let tempDbInstance = null
  let isWritePermissionDb = false
  
  try {
    // Open the database temporarily to inspect its contents
    tempDbInstance = await orbitdb.open(topic, {
      type: 'keyvalue'
    })
    
    console.log(`✅ [CATEGORIZE] Opened database temporarily for inspection:`, {
      address: tempDbInstance.address.toString(),
      dbName: tempDbInstance.dbName,
      type: tempDbInstance.type
    })
    
    // Get a sample of the database contents
    const allData = await tempDbInstance.all()
    const keys = Object.keys(allData)
    const sampleSize = Math.min(3, keys.length) // Check up to 3 entries
    
    console.log(`🔍 [CATEGORIZE] Database has ${keys.length} entries, sampling ${sampleSize}:`, keys.slice(0, sampleSize))
    
    // Check if this looks like a write permission database
    let permissionRequestCount = 0
    let todoCount = 0
    
    for (let i = 0; i < sampleSize; i++) {
      const key = keys[i]
      const entry = allData[key]
      const value = entry?.value || entry
      
      console.log(`🔍 [CATEGORIZE] Entry ${i + 1}:`, { 
        key, 
        entry: JSON.stringify(entry, null, 2), 
        value: JSON.stringify(value, null, 2),
        valueType: typeof value,
        hasType: value?.type,
        hasPeerId: value?.peerId,
        hasPurpose: value?.purpose
      })
      
      // Check if this looks like a permission request or write permission database marker
      if (value && typeof value === 'object') {
        if (value.requesterPeerId && value.targetPeerID && value.status && value.requestedAt) {
          permissionRequestCount++
          console.log(`📝 [CATEGORIZE] Found permission request pattern in entry ${i + 1}`)
        } else if (value.type === 'write-permission-database' && value.peerId && value.purpose) {
          permissionRequestCount++
          console.log(`✅ [CATEGORIZE] 🎉 Found write permission database marker in entry ${i + 1}! Type: ${value.type}, PeerId: ${value.peerId}, Purpose: ${value.purpose}`)
        } else if (value.text && (value.completed !== undefined || value.assignee !== undefined)) {
          todoCount++
          console.log(`📋 [CATEGORIZE] Found TODO pattern in entry ${i + 1}`)
        } else {
          console.log(`❓ [CATEGORIZE] Unknown entry type in entry ${i + 1}:`, {
            hasType: !!value.type,
            type: value.type,
            hasPeerId: !!value.peerId,
            peerId: value.peerId,
            hasPurpose: !!value.purpose,
            purpose: value.purpose,
            hasText: !!value.text,
            hasCompleted: value.completed !== undefined,
            hasAssignee: value.assignee !== undefined,
            allKeys: Object.keys(value)
          })
        }
      } else {
        console.log(`⚠️ [CATEGORIZE] Entry ${i + 1} is not an object:`, { value, type: typeof value })
      }
    }
    
    // Determine database type based on content patterns and cache instances appropriately
    if (permissionRequestCount > 0 && todoCount === 0) {
      isWritePermissionDb = true
      peerWritePermissionDbAddresses.set(databaseOwnerPeerId, topic)
      
      // CRITICAL: Cache the write permission database instance to keep it alive for replication
      peerWritePermissionDbInstances.set(databaseOwnerPeerId, tempDbInstance)
      console.log(`✅ [CATEGORIZE] Classified as WRITE PERMISSION database for peer ${formatPeerId(databaseOwnerPeerId)} and CACHED INSTANCE:`, {
        peerId: databaseOwnerPeerId,
        address: topic,
        mapSizeAfter: peerWritePermissionDbAddresses.size,
        instanceCached: true,
        allWritePermissionMappings: Array.from(peerWritePermissionDbAddresses.entries()).map(([p, addr]) => `${formatPeerId(p)} -> ${addr}`)
      })
      
      // Set up event listeners for write permission database updates
      setupWritePermissionDatabaseEventListeners(tempDbInstance, databaseOwnerPeerId)
      
    } else if (todoCount > 0 && permissionRequestCount === 0) {
      isWritePermissionDb = false
      peerOrbitDbAddresses.set(databaseOwnerPeerId, topic)
      
      // Cache TODO database instance as well for consistent behavior
      peerTodoDbInstances.set(databaseOwnerPeerId, tempDbInstance)
      console.log(`✅ [CATEGORIZE] Classified as TODO database for peer ${formatPeerId(databaseOwnerPeerId)} and CACHED INSTANCE`)
      
    } else if (keys.length === 0) {
      // Empty database - try to determine type from database name if available
      const dbName = tempDbInstance.dbName || ''
      if (dbName.includes('write-permission') || dbName.includes('write_permission')) {
        isWritePermissionDb = true
        peerWritePermissionDbAddresses.set(databaseOwnerPeerId, topic)
        
        // CRITICAL: Cache the write permission database instance
        peerWritePermissionDbInstances.set(databaseOwnerPeerId, tempDbInstance)
        console.log(`✅ [CATEGORIZE] Empty database classified as WRITE PERMISSION based on name: ${dbName} and CACHED INSTANCE`)
        
        // Set up event listeners for write permission database updates
        setupWritePermissionDatabaseEventListeners(tempDbInstance, databaseOwnerPeerId)
        
      } else {
        // Default to TODO database for empty databases with no clear name indication
        isWritePermissionDb = false
        peerOrbitDbAddresses.set(databaseOwnerPeerId, topic)
        
        // Cache TODO database instance
        peerTodoDbInstances.set(databaseOwnerPeerId, tempDbInstance)
        console.log(`✅ [CATEGORIZE] Empty database classified as TODO (default) for peer ${formatPeerId(databaseOwnerPeerId)} and CACHED INSTANCE`)
      }
    } else {
      // Mixed or unclear content - default to TODO database
      isWritePermissionDb = false
      peerOrbitDbAddresses.set(databaseOwnerPeerId, topic)
      
      // Cache TODO database instance
      peerTodoDbInstances.set(databaseOwnerPeerId, tempDbInstance)
      console.log(`⚠️ [CATEGORIZE] Unclear database content (${permissionRequestCount} permission, ${todoCount} todo), defaulting to TODO for peer ${formatPeerId(databaseOwnerPeerId)} and CACHED INSTANCE`)
    }
    
  } catch (error) {
    console.error(`❌ [CATEGORIZE] Failed to inspect database content for ${topic}:`, error)
    // On error, default to TODO database
    isWritePermissionDb = false
    peerOrbitDbAddresses.set(databaseOwnerPeerId, topic)
    
    // Still cache the instance if we managed to open it
    if (tempDbInstance) {
      peerTodoDbInstances.set(databaseOwnerPeerId, tempDbInstance)
      console.log(`⚠️ [CATEGORIZE] Error occurred, defaulting to TODO database for peer ${formatPeerId(databaseOwnerPeerId)} but CACHED INSTANCE`)
    }
  }
  
  // NOTE: We no longer close the database instance in the finally block
  // Instead, we keep it cached and alive for persistent replication
  console.log(`📦 [CATEGORIZE] Database instance kept alive and cached for replication: ${topic}`)
  
  return isWritePermissionDb
}

/**
 * Update the reactive store with discovered database information
 */
function updateDiscoveredDatabasesStore() {
  const databases = Array.from(discoveredOrbitDBTopics.values())
  discoveredDatabasesStore.set(databases)
}

/**
 * Get the map of peer OrbitDB addresses for UI consumption
 */
export function getPeerOrbitDbAddresses() {
  console.log('🔍 [DEBUG] getPeerOrbitDbAddresses called:', {
    todoDbCount: peerOrbitDbAddresses.size,
    todoDbMapping: Array.from(peerOrbitDbAddresses.entries()),
    permissionDbCount: peerWritePermissionDbAddresses.size,
    permissionDbMapping: Array.from(peerWritePermissionDbAddresses.entries())
  })
  return new Map(peerOrbitDbAddresses)
}

/**
 * Get the map of peer write permission OrbitDB addresses
 */
export function getPeerWritePermissionDbAddresses() {
  console.log('🔍 [DEBUG] getPeerWritePermissionDbAddresses called:', {
    writePermissionDbCount: peerWritePermissionDbAddresses.size,
    writePermissionDbMapping: Array.from(peerWritePermissionDbAddresses.entries()).map(([peerId, addr]) => `${formatPeerId(peerId)} -> ${addr}`),
    todoDbCount: peerOrbitDbAddresses.size,
    todoDbMapping: Array.from(peerOrbitDbAddresses.entries()).map(([peerId, addr]) => `${formatPeerId(peerId)} -> ${addr}`)
  })
  return new Map(peerWritePermissionDbAddresses)
}

/**
 * Get the map of peer TODO database instances
 */
export function getPeerTodoDbInstances() {
  return new Map(peerTodoDbInstances)
}

/**
 * Get the map of peer write permission database instances
 */
export function getPeerWritePermissionDbInstances() {
  return new Map(peerWritePermissionDbInstances)
}

/**
 * Get a specific peer's TODO database instance
 */
export function getPeerTodoDbInstance(peerId) {
  return peerTodoDbInstances.get(peerId)
}

/**
 * Get a specific peer's write permission database instance
 */
export function getPeerWritePermissionDbInstance(peerId) {
  return peerWritePermissionDbInstances.get(peerId)
}

/**
 * Get or open a peer's write permission database instance (lazy loading)
 */
export async function getOrOpenPeerWritePermissionDb(peerId) {
  if (!orbitdb) {
    throw new Error('OrbitDB not initialized')
  }
  
  console.log(`🔍 [DEBUG] getOrOpenPeerWritePermissionDb called for peer: ${formatPeerId(peerId)}`)
  
  // Check if we already have an open instance (from categorization or previous access)
  const existingInstance = peerWritePermissionDbInstances.get(peerId)
  if (existingInstance) {
    console.log(`⚙️ Reusing existing write permission database instance for peer ${formatPeerId(peerId)}:`, {
      address: existingInstance.address?.toString(),
      dbName: existingInstance.dbName,
      hasReplicator: !!existingInstance.replicator,
      replicatorPeers: existingInstance.replicator?.peers?.size || 0,
      isReplicating: existingInstance.replicator?.started || false
    })
    return existingInstance
  }
  
  // Check if we have the address for this peer's write permission database
  const address = peerWritePermissionDbAddresses.get(peerId)
  console.log(`🔍 [DEBUG] Looking up write permission database address for peer ${formatPeerId(peerId)}:`, {
    peerId,
    foundAddress: address,
    allMappings: Array.from(peerWritePermissionDbAddresses.entries()).map(([p, addr]) => `${formatPeerId(p)} -> ${addr}`)
  })
  
  if (!address) {
    console.error(`❌ [DEBUG] No write permission database found for peer ${formatPeerId(peerId)}:`, {
      peerId,
      availableWritePermissionPeers: Array.from(peerWritePermissionDbAddresses.keys()),
      availableTodoPeers: Array.from(peerOrbitDbAddresses.keys()),
      writePermissionDbMapping: Array.from(peerWritePermissionDbAddresses.entries()),
      todoDbMapping: Array.from(peerOrbitDbAddresses.entries())
    })
    throw new Error(`No write permission database address found for peer ${formatPeerId(peerId)}. Available write permission databases: ${Array.from(peerWritePermissionDbAddresses.keys()).map(formatPeerId).join(', ')}`)
  }
  
  try {
    console.log(`🔓 Opening write permission database for peer ${formatPeerId(peerId)} with address: ${address}`)
    
    // Open the write permission database
    const dbInstance = await orbitdb.open(address, {
      type: 'keyvalue'
    })
    
    console.log(`✅ Successfully opened write permission database:`, {
      address: dbInstance.address.toString(),
      name: dbInstance.dbName,
      type: dbInstance.type,
      hasReplicator: !!dbInstance.replicator,
      replicatorPeers: dbInstance.replicator?.peers?.size || 0,
      isReplicating: dbInstance.replicator?.started || false
    })
    
    // Cache the instance for future use and persistent replication
    peerWritePermissionDbInstances.set(peerId, dbInstance)
    console.log(`📦 Cached write permission database instance for peer ${formatPeerId(peerId)}`)
    
    // Set up event listeners for this database instance
    setupWritePermissionDatabaseEventListeners(dbInstance, peerId)
    
    return dbInstance
    
  } catch (error) {
    console.error(`❌ Failed to open write permission database for peer ${formatPeerId(peerId)}:`, error)
    throw error
  }
}

/**
 * Get information about the currently active database
 */
export function getCurrentDatabaseInfo() {
  const currentDB = getCurrentTodoDB()
  if (!currentDB) {
    return { active: false, address: null, name: null, type: null }
  }
  
  return {
    active: true,
    address: currentDB.address?.toString?.() || null,
    name: currentDB.dbName || null,
    type: currentDB.type || null,
    opened: currentDB.opened || false
  }
}

/**
 * Open a selected peer's OrbitDB database (with lazy loading and caching)
 */
export async function openTodoDatabaseForPeer(peerId, helia) {
  if (!orbitdb) {
    await initializeOrbitDB(helia)
  }
  
  console.log(`🔄 Switching to database for peer: ${peerId || 'default'}`)
  
  // Close the current viewed database if it exists
  // BUT DO NOT close write permission databases - they must stay alive for replication
  if (currentViewedTodoDB) {
    try {
      // Check if this is a write permission database by examining cached instances
      let isWritePermissionDb = false
      for (const [cachedPeerId, cachedDbInstance] of peerWritePermissionDbInstances) {
        if (cachedDbInstance === currentViewedTodoDB) {
          isWritePermissionDb = true
          console.log(`🔐 [CRITICAL] Preventing closure of write permission database for peer ${formatPeerId(cachedPeerId)} to maintain replication`)
          break
        }
      }
      
      if (!isWritePermissionDb) {
        console.log(`🗋️ Closing current viewed database: ${currentViewedTodoDB.address}`)
        await currentViewedTodoDB.close()
      } else {
        console.log(`🔐 [CRITICAL] Skipping closure of write permission database to preserve replication connection`)
      }
      
      currentViewedTodoDB = null
    } catch (error) {
      console.warn('Error closing current viewed database:', error)
    }
  }
  
  // If no peerId provided, switch back to my own database
  if (!peerId) {
    console.log('🏠 Switching back to my own database')
    currentViewedTodoDB = null  // This will make getTodoDatabase() return myOwnTodoDB
    return await getMyOwnTodoDatabase(helia)
  }
  
  let address
  if (peerOrbitDbAddresses.has(peerId)) {
    // Check if we already have an open instance for this peer
    const existingInstance = peerTodoDbInstances.get(peerId)
    if (existingInstance) {
      console.log(`⚙️ Reusing existing TODO database instance for peer ${formatPeerId(peerId)}`)
      currentViewedTodoDB = existingInstance
      return currentViewedTodoDB
    }
    
    // Use the discovered OrbitDB address for this peer
    address = peerOrbitDbAddresses.get(peerId)
    console.log(`📍 Opening peer's database with address: ${address}`)
  } else {
    throw new Error(`No database found for peer ${formatPeerId(peerId)}`)
  }
  
  try {
    // Open the database
    currentViewedTodoDB = await orbitdb.open(address, {
      type: 'keyvalue'
      // Don't specify access control when opening existing databases
    })
    
    console.log(`✅ Successfully opened peer database:`, {
      address: currentViewedTodoDB.address,
      name: currentViewedTodoDB.dbName,
      type: currentViewedTodoDB.type
    })
    
    // Cache the instance for future use
    peerTodoDbInstances.set(peerId, currentViewedTodoDB)
    console.log(`📦 Cached TODO database instance for peer ${formatPeerId(peerId)}`)
    
    return currentViewedTodoDB
    
  } catch (error) {
    console.error(`❌ Failed to open database for peer ${peerId}:`, error)
    throw error
  }
}

/**
 * Get or create MY OWN todo database (always writable)
 */
export async function getMyOwnTodoDatabase(helia) {
  if (!orbitdb) {
    await initializeOrbitDB(helia)
  }
  
  if (!myOwnTodoDB) {
    console.log('🏠 Opening/creating MY OWN OrbitDB with WritePermissionAccessController...')
    
    try {
      // Use WritePermissionAccessController with our OrbitDB identity as owner
      myOwnTodoDB = await orbitdb.open('todos', {
        type: 'keyvalue',
        AccessController: WritePermissionAccessController({ ownerPeerId: orbitdb.identity.id })
      })
      
      console.log('✅ MY OWN database opened successfully with WritePermissionAccessController:', {
        address: myOwnTodoDB.address,
        type: myOwnTodoDB.type,
        accessController: myOwnTodoDB.access
      })
      
    } catch (error) {
      console.warn('⚠️ Failed to open with WritePermissionAccessController, trying fallback:', error.message)
      
      try {
        // Fallback: Use IPFS access controller with wildcard
        myOwnTodoDB = await orbitdb.open('todos', {
          type: 'keyvalue',
          AccessController: {
            type: 'ipfs',
            write: ['*'] // Allow anyone to write
          }
        })
        
        console.log('✅ MY OWN database opened with IPFS AccessController fallback')
        
      } catch (error2) {
        console.warn('⚠️ IPFS AccessController failed, using default:', error2.message)
        
        // Final fallback: No access controller (defaults to public)
        myOwnTodoDB = await orbitdb.open('todos', {
          type: 'keyvalue'
        })
        
        console.log('✅ MY OWN database opened with default access controller')
      }
    }
    
    // Set up event listeners for my own database
    setupMyOwnDatabaseEventListeners()
  }
  
  return myOwnTodoDB
}

/**
 * Get the currently viewed database (for reading data - could be mine or peer's)
 */
export async function getTodoDatabase(helia) {
  // Return currently viewed database if set, otherwise return my own database
  if (currentViewedTodoDB) {
    return currentViewedTodoDB
  }
  
  // Fallback to my own database if no specific database is being viewed
  return await getMyOwnTodoDatabase(helia)
}

/**
 * Set up OrbitDB event listeners for MY OWN database
 */
function setupMyOwnDatabaseEventListeners() {
  if (!myOwnTodoDB) {
    console.warn('Cannot set up MY OWN database event listeners - myOwnTodoDB not available')
    return
  }
  
  console.log('🏠 Setting up MY OWN OrbitDB event listeners...')
  
  // Listen for database updates in OrbitDB v2.5.0 format
  myOwnTodoDB.events.on('update', (entry) => {
    console.log('📝 MY OWN OrbitDB update event:', { 
      payload: entry?.payload, 
      operation: entry?.payload?.op,
      key: entry?.payload?.key,
      value: entry?.payload?.value 
    })
    
    // Check if this is a relevant operation (PUT/SET or DEL)
    if (entry?.payload?.op === 'PUT' || entry?.payload?.op === 'SET') {
      console.log('✅ Todo added/updated in MY OWN database:', entry.payload.key, entry.payload.value)
      
      // Notify all registered callbacks
      databaseUpdateCallbacks.forEach(callback => {
        try {
          callback('update', { type: 'PUT', key: entry.payload.key, value: entry.payload.value, entry })
        } catch (error) {
          console.error('Error in database update callback:', error)
        }
      })
      
    } else if (entry?.payload?.op === 'DEL' || entry?.payload?.op === 'DELETE') {
      console.log('🗑️ Todo deleted from MY OWN database:', entry.payload.key)
      
      // Notify all registered callbacks  
      databaseUpdateCallbacks.forEach(callback => {
        try {
          callback('update', { type: 'DEL', key: entry.payload.key, entry })
        } catch (error) {
          console.error('Error in database update callback:', error)
        }
      })
    }
  })
  
  console.log('✅ MY OWN OrbitDB event listeners configured')
}

/**
 * Set up OrbitDB event listeners for write permission databases
 */
function setupWritePermissionDatabaseEventListeners(dbInstance, peerId) {
  if (!dbInstance) {
    console.warn(`Cannot set up write permission database event listeners - dbInstance not available for peer ${formatPeerId(peerId)}`)
    return
  }
  
  console.log(`🔐 Setting up write permission database event listeners for peer ${formatPeerId(peerId)}...`)
  
  // Listen for database updates in OrbitDB 3.0 format
  dbInstance.events.on('update', (entry) => {
    console.log(`🔐 [WRITE PERMISSION] Database update event from peer ${formatPeerId(peerId)}:`, { 
      peerId,
      payload: entry?.payload, 
      operation: entry?.payload?.op,
      key: entry?.payload?.key,
      value: entry?.payload?.value,
      timestamp: new Date().toISOString()
    })
    
    // Check if this is a relevant operation (PUT/SET or DEL)
    if (entry?.payload?.op === 'PUT' || entry?.payload?.op === 'SET') {
      const value = entry.payload.value
      
      // Check if this looks like a write permission request
      if (value && typeof value === 'object' && value.requesterPeerId && value.targetPeerID && value.status) {
        console.log(`🎯 [WRITE PERMISSION] NEW PERMISSION REQUEST received from peer ${formatPeerId(peerId)}:`, {
          requesterPeerId: value.requesterPeerId,
          targetPeerID: value.targetPeerID,
          status: value.status,
          requestedAt: value.requestedAt,
          key: entry.payload.key
        })
        
        // Dispatch a custom event for the UI to handle
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('write-permission-request-received', {
            detail: {
              peerId,
              requestKey: entry.payload.key,
              request: value,
              timestamp: new Date().toISOString()
            }
          }))
        }
      } else {
        console.log(`📝 [WRITE PERMISSION] General update in write permission database from peer ${formatPeerId(peerId)}:`, entry.payload.key, entry.payload.value)
      }
      
    } else if (entry?.payload?.op === 'DEL' || entry?.payload?.op === 'DELETE') {
      console.log(`🗑️ [WRITE PERMISSION] Entry deleted from write permission database of peer ${formatPeerId(peerId)}:`, entry.payload.key)
    }
  })
  
  console.log(`✅ Write permission database event listeners configured for peer ${formatPeerId(peerId)}`)
}

/**
 * Set up OrbitDB event listeners for reactive updates (for viewed databases)
 */
function setupDatabaseEventListeners() {
  if (!todoDB) {
    console.warn('Cannot set up database event listeners - todoDB not available')
    return
  }
  
  console.log('🔄 Setting up OrbitDB event listeners...')
  
  // Listen for database updates in OrbitDB v2.5.0 format
  todoDB.events.on('update', (entry) => {
    console.log('📝 OrbitDB update event:', { 
      payload: entry?.payload, 
      operation: entry?.payload?.op,
      key: entry?.payload?.key,
      value: entry?.payload?.value 
    })
    
    // Check if this is a relevant operation (PUT/SET or DEL)
    if (entry?.payload?.op === 'PUT' || entry?.payload?.op === 'SET') {
      console.log('✅ Todo added/updated:', entry.payload.key, entry.payload.value)
      
      // Notify all registered callbacks
      databaseUpdateCallbacks.forEach(callback => {
        try {
          callback('update', { type: 'PUT', key: entry.payload.key, value: entry.payload.value, entry })
        } catch (error) {
          console.error('Error in database update callback:', error)
        }
      })
      
    } else if (entry?.payload?.op === 'DEL' || entry?.payload?.op === 'DELETE') {
      console.log('🗑️ Todo deleted:', entry.payload.key)
      
      // Notify all registered callbacks  
      databaseUpdateCallbacks.forEach(callback => {
        try {
          callback('update', { type: 'DEL', key: entry.payload.key, entry })
        } catch (error) {
          console.error('Error in database update callback:', error)
        }
      })
    }
  })
  
  console.log('✅ OrbitDB event listeners configured')
}

/**
 * Register a callback for database updates
 */
export function onDatabaseUpdate(callback) {
  console.log('🔄 Registering database update callback')
  
  // Add callback to global list
  databaseUpdateCallbacks.push(callback)
  
  // Return cleanup function
  return () => {
    const index = databaseUpdateCallbacks.indexOf(callback)
    if (index > -1) {
      databaseUpdateCallbacks.splice(index, 1)
      console.log('🗑️ Database update callback removed')
    }
  }
}

/**
 * Get MY OWN OrbitDB address
 */
export function getTodoDbAddress() {
  return myOwnTodoDB?.address?.toString?.() || null
}

/**
 * Get MY OWN OrbitDB name
 */
export function getTodoDbName() {
  return myOwnTodoDB?.dbName || null
}

/**
 * Stop OrbitDB and close all databases
 */
export async function stopOrbitDB() {
  console.log('🛑 Stopping OrbitDB...')
  
  try {
    // Close my own todo database
    if (myOwnTodoDB) {
      await myOwnTodoDB.close()
      myOwnTodoDB = null
      console.log('🔒 Closed my own todo database')
    }
    
    // Close the currently viewed database
    if (currentViewedTodoDB) {
      await currentViewedTodoDB.close()
      currentViewedTodoDB = null
      console.log('🔒 Closed currently viewed database')
    }
    
    // Close all peer TODO database instances
    console.log(`🔒 Closing ${peerTodoDbInstances.size} peer TODO database instances...`)
    for (const [peerId, dbInstance] of peerTodoDbInstances) {
      try {
        await dbInstance.close()
        console.log(`🔒 Closed TODO database instance for peer ${formatPeerId(peerId)}`)
      } catch (error) {
        console.warn(`⚠️ Failed to close TODO database instance for peer ${formatPeerId(peerId)}:`, error)
      }
    }
    
    // Close all peer write permission database instances
    console.log(`🔒 Closing ${peerWritePermissionDbInstances.size} peer write permission database instances...`)
    for (const [peerId, dbInstance] of peerWritePermissionDbInstances) {
      try {
        await dbInstance.close()
        console.log(`🔒 Closed write permission database instance for peer ${formatPeerId(peerId)}`)
      } catch (error) {
        console.warn(`⚠️ Failed to close write permission database instance for peer ${formatPeerId(peerId)}:`, error)
      }
    }
    
    // Stop OrbitDB instance
    if (orbitdb) {
      await orbitdb.stop()
      orbitdb = null
      console.log('🔒 Stopped OrbitDB instance')
    }
    
    // Clear callbacks and maps
    databaseUpdateCallbacks.length = 0
    peerOrbitDbAddresses.clear()
    peerWritePermissionDbAddresses.clear()
    peerTodoDbInstances.clear()
    peerWritePermissionDbInstances.clear()
    discoveredOrbitDBTopics.clear()
    
    console.log('✅ OrbitDB stopped and all database instances closed')
  } catch (error) {
    console.error('❌ Error stopping OrbitDB:', error)
    throw error
  }
}

/**
 * Get OrbitDB instance
 */
export function getOrbitDB() {
  return orbitdb
}

/**
 * Get current todo database (returns viewed database or own database)
 */
export function getCurrentTodoDB() {
  // Return currently viewed database if set, otherwise return my own database
  return currentViewedTodoDB || myOwnTodoDB
}
