import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { writable } from 'svelte/store'
import { OrbitDBTopicDiscovery } from '../orbit-discovery.js'

/**
 * Database state management
 */
let orbitdb = null
let todoDB = null

// Store database event callbacks globally so they persist across function calls
let databaseUpdateCallbacks = []

// Map to store peerId -> OrbitDB address
const peerOrbitDbAddresses = new Map()

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
  
  orbitdb = await createOrbitDB({
    ipfs: helia,
    id: 'todo-p2p-app',
    directory: './orbitdb-data',
    AccessControllers: {
      'ipfs': IPFSAccessController
    }
  })
  
  console.log(`✅ OrbitDB created in ${Date.now() - orbitStartTime}ms`)
  
  // Set up OrbitDB topic discovery
  await setupOrbitDBDiscovery(helia)
  
  return orbitdb
}

/**
 * Set up OrbitDB topic discovery
 */
async function setupOrbitDBDiscovery(helia) {
  console.log('🔍 Setting up OrbitDB topic discovery...')
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
  
  await discovery.startDiscovery(async (topic, peerId) => {
    console.log(`🎯 [DISCOVERY] Automatically subscribing to discovered OrbitDB topic: ${topic} from peer: ${peerId}`)
    try {
      await helia.libp2p.services.pubsub.subscribe(topic)
      console.log(`✅ Successfully subscribed to OrbitDB topic: ${topic}`)
      
      // Store the discovered OrbitDB topic
      const peerIdStr = peerId.toString()
      console.log(`📝 [DEBUG] Storing OrbitDB topic discovery:`, {
        peerIdStr,
        topic,
        peerMapBefore: Array.from(peerOrbitDbAddresses.keys()),
        peerMapSizeBefore: peerOrbitDbAddresses.size
      })
      
      discoveredOrbitDBTopics.set(topic, {
        peerId: peerIdStr,
        topic,
        discoveredAt: new Date().toISOString()
      })
      
      // Also add to the legacy map for UI compatibility
      peerOrbitDbAddresses.set(peerIdStr, topic)
      
      console.log(`📝 [DEBUG] After storing discovery:`, {
        peerMapAfter: Array.from(peerOrbitDbAddresses.keys()),
        peerMapSizeAfter: peerOrbitDbAddresses.size,
        topicForThisPeer: peerOrbitDbAddresses.get(peerIdStr)
      })
      
      // Update the reactive store
      updateDiscoveredDatabasesStore()
      
      // Dispatch event for UI updates
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('orbitdb-database-discovered', {
          detail: { peerId: peerIdStr, topic, address: topic }
        }))
      }
    } catch (error) {
      console.error(`❌ Failed to subscribe to OrbitDB topic ${topic}:`, error)
    }
  })

  // Optionally, handle messages from topics
  await discovery.enableAutoSubscribe(async (event) => {
    const { topic, from, data } = event.detail
    console.log(`📩 [ORBITDB] Received message on topic ${topic} from ${from}:`, new TextDecoder().decode(data))
  })
  
  console.log('✅ OrbitDB topic discovery configured')
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
  return new Map(peerOrbitDbAddresses)
}

/**
 * Get information about the currently active database
 */
export function getCurrentDatabaseInfo() {
  if (!todoDB) {
    return { active: false, address: null, name: null, type: null }
  }
  
  return {
    active: true,
    address: todoDB.address?.toString?.() || null,
    name: todoDB.dbName || null,
    type: todoDB.type || null,
    opened: todoDB.opened || false
  }
}

/**
 * Open a selected peer's OrbitDB database
 */
export async function openTodoDatabaseForPeer(peerId, helia) {
  if (!orbitdb) {
    await initializeOrbitDB(helia)
  }
  
  console.log(`🔄 Switching to database for peer: ${peerId || 'default'}`)
  
  // Close the current database if it exists
  if (todoDB) {
    try {
      console.log(`🗂️ Closing current database: ${todoDB.address}`)
      await todoDB.close()
      todoDB = null
    } catch (error) {
      console.warn('Error closing current database:', error)
    }
  }
  
  let address
  if (peerId && peerOrbitDbAddresses.has(peerId)) {
    // Use the discovered OrbitDB address for this peer
    address = peerOrbitDbAddresses.get(peerId)
    console.log(`📍 Opening peer's database with address: ${address}`)
  } else {
    // fallback to default name 'todos'
    address = 'todos'
    console.log(`📍 Opening default database with name: ${address}`)
  }
  
  try {
    // Use a consistent approach for all databases
    todoDB = await orbitdb.open(address, {
      type: 'keyvalue'
      // Don't specify access control when opening existing databases
    })
    
    console.log(`✅ Successfully opened database:`, {
      address: todoDB.address,
      name: todoDB.dbName,
      type: todoDB.type
    })
    
    // Set up event listeners for the new database
    setupDatabaseEventListeners()
    
    return todoDB
    
  } catch (error) {
    console.error(`❌ Failed to open database for peer ${peerId}:`, error)
    throw error
  }
}

/**
 * Get or create the default todo database
 */
export async function getTodoDatabase(helia) {
  if (!orbitdb) {
    await initializeOrbitDB(helia)
  }
  
  if (!todoDB) {
    console.log('🔓 Opening/creating OrbitDB with IPFSAccessController...')
    
    try {
      // Use IPFSAccessController with wildcard for open write access
      todoDB = await orbitdb.open('todos', {
        type: 'keyvalue',
        AccessController: IPFSAccessController({
          write: ['*'] // Allow any peer to write
        })
      })
      
      console.log('✅ Database opened successfully with IPFSAccessController:', {
        address: todoDB.address,
        type: todoDB.type,
        accessController: todoDB.access
      })
      
    } catch (error) {
      console.warn('⚠️ Failed to open with IPFSAccessController, trying legacy approach:', error.message)
      
      try {
        // Fallback 1: Try with accessController object syntax
        todoDB = await orbitdb.open('todos', {
          type: 'keyvalue',
          accessController: {
            type: 'ipfs',
            write: ['*']
          }
        })
        
        console.log('✅ Database opened with legacy accessController syntax')
        
      } catch (error2) {
        console.warn('⚠️ Legacy syntax failed, trying no access controller:', error2.message)
        
        // Fallback 2: No access controller (defaults to public)
        todoDB = await orbitdb.open('todos', {
          type: 'keyvalue'
        })
        
        console.log('✅ Database opened with default access controller')
      }
    }
    
    setupDatabaseEventListeners()
  }
  
  return todoDB
}

/**
 * Set up OrbitDB event listeners for reactive updates
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
 * Get the current OrbitDB address
 */
export function getTodoDbAddress() {
  return todoDB?.address?.toString?.() || null
}

/**
 * Get the current OrbitDB name
 */
export function getTodoDbName() {
  return todoDB?.dbName || null
}

/**
 * Stop OrbitDB and close all databases
 */
export async function stopOrbitDB() {
  console.log('🛑 Stopping OrbitDB...')
  
  try {
    if (todoDB) {
      await todoDB.close()
      todoDB = null
    }
    
    if (orbitdb) {
      await orbitdb.stop()
      orbitdb = null
    }
    
    // Clear callbacks and maps
    databaseUpdateCallbacks.length = 0
    peerOrbitDbAddresses.clear()
    discoveredOrbitDBTopics.clear()
    
    console.log('✅ OrbitDB stopped')
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
 * Get current todo database
 */
export function getCurrentTodoDB() {
  return todoDB
}
