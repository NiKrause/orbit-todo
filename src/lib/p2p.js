import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB } from '@orbitdb/core'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { dcutr } from '@libp2p/dcutr'
import { autoNAT } from '@libp2p/autonat'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { bootstrap } from '@libp2p/bootstrap'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import * as filters from '@libp2p/websockets/filters'
import { LevelDatastore } from 'datastore-level';
import { LevelBlockstore } from 'blockstore-level';
import { RelayDiscovery } from '../utils/relay-discovery.js'
import { runHealthCheck, runHealthCheckAndRecover } from '../utils/db-health-check.js'
import { writable } from 'svelte/store'
import { OrbitDBTopicDiscovery } from '../../orbitdb-discovery.js'
import { Multiaddr } from 'multiaddr';

export const discoveredPeersStore = writable([]) // or Set, but array is easier for Svelte

const browser = typeof window !== 'undefined'

let libp2p = null
let helia = null
let orbitdb = null
let todoDB = null
let relayDiscovery = null

// Bootstrap relay address
const RELAY_BOOTSTRAP_ADDR = '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE'

// If you have multiple bootstrap addresses, use an array
const BOOTSTRAP_ADDRS = [RELAY_BOOTSTRAP_ADDR];
// Extract peer IDs from bootstrap addresses
const BOOTSTRAP_PEER_IDS = BOOTSTRAP_ADDRS.map(addr => {
  try {
    const ma = new Multiaddr(addr);
    const peerIdStr = ma.getPeerId();
    return peerIdStr;
  } catch (e) {
    return null;
  }
}).filter(Boolean);


/**
 * Set up peer discovery event handlers and auto-dialing
 */
function setupPeerDiscoveryHandlers(node) {
  console.log('🔍 Setting up peer discovery event handlers...')
  
// Track discovered peers to avoid duplicate connection attempts
  const discoveredPeers = new Set()
  const connectionAttempts = new Map() // Track failed attempts
  const connectionDetails = new Map() // Track connection transport details
  
  // Handle peer discovery events
  node.addEventListener('peer:discovery', async (event) => {
    const { id: peerId, multiaddrs } = event.detail
    const peerIdStr = peerId?.toString()
    
    console.log('🎯 Peer discovered:', formatPeerId(peerIdStr), 'Addresses:', multiaddrs.map(ma => ma.toString()))
    
    // Skip if we've already discovered this peer recently
    if (discoveredPeers.has(peerIdStr)) {
      console.log('⏭️ Peer already discovered, skipping:', formatPeerId(peerIdStr))
      return
    }
    
    // Skip if we're already connected to this peer
    const existingConnections = node.getConnections(peerId)
    if (existingConnections && existingConnections.length > 0) {
      console.log('🔗 Already connected to peer:', formatPeerId(peerIdStr))
      discoveredPeers.add(peerIdStr)
      discoveredPeersStore.set(Array.from(discoveredPeers))
      return
    }
    
    // Skip if we've failed to connect to this peer recently
    const lastAttempt = connectionAttempts.get(peerIdStr)
    if (lastAttempt && (Date.now() - lastAttempt) < 30000) { // Wait 30s before retry
      console.log('⏳ Recent connection attempt failed, waiting before retry:', formatPeerId(peerIdStr))
      return
    }
    
    // Mark as discovered
    discoveredPeers.add(peerIdStr)
    discoveredPeersStore.set(Array.from(discoveredPeers))
    
    // Attempt to dial the discovered peer
    try {
      console.log('📞 Attempting to dial discovered peer:', formatPeerId(peerIdStr))
      

      const connection = await node.dial(peerId)
      
      if (connection) {
        console.log('✅ Successfully connected to peer:', formatPeerId(peerIdStr))
      }
      
    } catch (error) {
      console.warn('❌ Failed to connect to discovered peer:', formatPeerId(peerIdStr), 'Error:', error.message)
      connectionAttempts.set(peerIdStr, Date.now())
    }
  })
  
  // Handle successful connections
  node.addEventListener('peer:connect', async (event) => {
    // Try to get PeerId from event.detail or event itself
    const peerId = event.detail?.remotePeer || event.detail || event.peerId || event;

    // Get PeerId as string for logging
    const peerIdStr = typeof peerId.toString === 'function' ? peerId.toString() : String(peerId);

    // Try to get remoteAddr from event.detail if available
    const addr = event.detail?.remoteAddr?.toString?.() || 'unknown';

    console.log(`🤝 [peer:connect] PeerId: ${peerIdStr} | Direct address: ${addr}`);

    // 1. Log all activnode.addEventListener('peer:connect', (event) => {e connection addresses
    const connections = node.getConnections(peerId);
    if (connections.length > 0) {
      connections.forEach(conn => {
        console.log(`   - Active connection address: ${conn.remoteAddr?.toString()}`);
      });
    } else {
      // 2. If not connected, log all known addresses from peerStore
      try {
        const peer = await node.peerStore.get(peerId);
        const addrs = peer?.addresses?.map(a => a.multiaddr.toString()) || [];
        if (addrs.length > 0) {
          console.log(`   - Known addresses from peerStore:`, addrs);
        } else {
          console.log('   - No known addresses for this peer.');
        }
      } catch (err) {
        console.log('   - Could not retrieve addresses from peerStore:', err.message);
      }
    }
    
    // Determine transport type from address
    let transport = 'unknown'
    if (addr.includes('/ws')) transport = 'websocket'
    else if (addr.includes('/webrtc')) transport = 'webrtc'
    else if (addr.includes('/tcp') && !addr.includes('/ws')) transport = 'tcp'
    else if (addr.includes('/p2p-circuit')) transport = 'circuit-relay'
    
    // Store connection details
    connectionDetails.set(peerIdStr, {
      peerId: peerIdStr,
      peerIdFormatted: formatPeerId(peerIdStr),
      address: addr,
      transport,
      connectedAt: new Date().toISOString(),
      status: 'connected'
    })
    
    console.log(`🤝 [CLIENT CONNECT] ${formatPeerId(peerIdStr)} via ${transport.toUpperCase()} | Address: ${addr}`)
    
    // Clear any failed connection attempts
    connectionAttempts.delete(peerIdStr)
    
      window.dispatchEvent(new CustomEvent('p2p-peer-connected', {
        detail: {
          peerId: peerIdStr,
          peerIdFormatted: formatPeerId(peerIdStr),
          transport,
          address: addr
        }
      }))

    // OrbitDB topic discovery is now handled automatically via pubsub subscription monitoring

});
  
  // Handle disconnections
  node.addEventListener('peer:disconnect', (event) => {
    const { remotePeer } = event.detail
    const peerIdStr = remotePeer?.toString()
    const connInfo = connectionDetails.get(peerIdStr)
    
    // Calculate connection duration
    let duration = 'unknown'
    if (connInfo?.connectedAt) {
      const connectedTime = new Date(connInfo.connectedAt)
      const durationMs = Date.now() - connectedTime.getTime()
      duration = `${Math.round(durationMs / 1000)}s`
    }
    
    console.log(`👋 [CLIENT DISCONNECT] ${formatPeerId(peerIdStr)} | Duration: ${duration} | Transport: ${connInfo?.transport || 'unknown'}`)
    
    // Remove from discovered peers so we can try to reconnect later
    discoveredPeers.delete(peerIdStr)
    discoveredPeersStore.set(Array.from(discoveredPeers))
    
    // Remove connection details
    connectionDetails.delete(peerIdStr)

    window.dispatchEvent(new CustomEvent('p2p-peer-disconnected', {
      detail: {
        peerId: peerIdStr
      }
    }));
  })
  
  
  
  console.log('✅ Peer discovery handlers configured')
}

async function initializeP2PWithTimeout() {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('P2P initialization timed out after 30 seconds')), 30000)
  );
  
  const initPromise = async () => {
    console.log('🚀 Starting P2P initialization...')
    
    // Get fixed peer ID from environment variable
    console.log('🔑 Setting up peer identity...')
    const testPeerId = import.meta.env.VITE_TEST_PEER_ID
    let privateKey = null
    
    if (testPeerId) {
      try {
        privateKey = privateKeyFromProtobuf(uint8ArrayFromString(testPeerId, 'hex'))
        console.log('✅ Using fixed peer ID from environment')
      } catch (error) {
        console.warn('Invalid test peer ID, generating random key:', error)
      }
    } else {
      console.log('🎲 Generating random peer ID')
    }

    // Create libp2p node
    console.log('🌐 Creating libp2p node...')
    const startTime = Date.now()
    libp2p = await createLibp2p({
      ...(privateKey && { privateKey }),
      addresses: {
        listen: [
            '/p2p-circuit',
            "/webrtc",
            "/webtransport",
            "/wss", "/ws"
        ]
      },
      transports: [
        webSockets({
          filter: filters.all
        }),
        webRTC(),
        circuitRelayTransport({
          discoverRelays: 1
        })
      ],
      connectionEncrypters: [noise()],
      connectionGater: {
        denyDialMultiaddr: () => false,
        denyDialPeer: () => false,
        denyInboundConnection: () => false,
        denyOutboundConnection: () => false,
        denyInboundEncryptedConnection: () => false,
        denyOutboundEncryptedConnection: () => false,
        denyInboundUpgradedConnection: () => false,
        denyOutboundUpgradedConnection: () => false
      },
      streamMuxers: [yamux()],
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: 5000, // More frequent broadcasting
          topics: ['todo._peer-discovery._p2p._pubsub'], // Match relay topic
          listenOnly: false,
          emitSelf: true // Enable even when no peers are present initially
        })
      ],
      services: {
        identify: identify(),
        bootstrap: bootstrap({list: [RELAY_BOOTSTRAP_ADDR]}),
        ping: ping(),
        dcutr: dcutr(),
        autonat: autoNAT(),
        pubsub: gossipsub({
          emitSelf: true, // Enable to see our own messages
          allowPublishToZeroTopicPeers: true
        })
      }
    })
    console.log(`✅ libp2p node created in ${Date.now() - startTime}ms`)

    // Set up peer discovery event handlers
    setupPeerDiscoveryHandlers(libp2p)
    // Create Helia instance
    console.log('📁 Creating Helia instance...')
    const heliaStartTime = Date.now()
    let blockstore = new LevelBlockstore('./helia-blocks');
    let datastore = new LevelDatastore('./helia-data');
    helia = await createHelia({libp2p,blockstore,datastore})
    console.log(`✅ Helia created in ${Date.now() - heliaStartTime}ms`)

    // Create OrbitDB instance
    console.log('🛬 Creating OrbitDB instance...')
    const orbitStartTime = Date.now()
    orbitdb = await createOrbitDB({ipfs: helia, id: 'todo-p2p-app'})
    console.log(`✅ OrbitDB created in ${Date.now() - orbitStartTime}ms`)

// After libp2p is created, set up the OrbitDB topic discovery
    console.log('🔍 Setting up OrbitDB topic discovery...')
    const discovery = new OrbitDBTopicDiscovery(helia)
    
    // Add debug listener to see if ANY subscription-change events occur
    helia.libp2p.services.pubsub.addEventListener('subscription-change', (event) => {
      console.log('🎯 [DEBUG] Raw subscription-change event received:', {
        peerId: event.detail.peerId.toString(),
        subscriptions: event.detail.subscriptions.map(s => ({
          topic: s.topic,
          subscribe: s.subscribe
        }))
      })
    })
    
    await discovery.startDiscovery(async (topic, peerId) => {
      console.log(`🎯 [DISCOVERY] Automatically subscribing to discovered OrbitDB topic: ${topic} from peer: ${peerId}`)
      try {
        await helia.libp2p.services.pubsub.subscribe(topic)
        console.log(`✅ Successfully subscribed to OrbitDB topic: ${topic}`)
        
        // Store the discovered OrbitDB topic
        const peerIdStr = peerId.toString()
        discoveredOrbitDBTopics.set(topic, {
          peerId: peerIdStr,
          topic,
          discoveredAt: new Date().toISOString()
        })
        
        // Also add to the legacy map for UI compatibility
        peerOrbitDbAddresses.set(peerIdStr, topic)
        
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
    // setupOrbitDbAddressListener();
    
    // Open the database immediately so we can announce our address to peers
    await getTodoDatabase();
    

    console.log(`🎉 P2P initialized successfully in ${Date.now() - startTime}ms! PeerId:`, libp2p.peerId.toString())
    
    return libp2p
  };
  
  return Promise.race([initPromise(), timeout]);
}

export async function initializeP2P() {
  if (!browser || libp2p) return libp2p
  
  try {
    return await initializeP2PWithTimeout()
  } catch (error) {
    console.error('❌ P2P initialization failed:', error)
    
    // Clean up any partial initialization
    if (libp2p) {
      try {
        await libp2p.stop()
      } catch (stopError) {
        console.warn('Error stopping libp2p during cleanup:', stopError)
      }
    }
    
    // Reset global variables
    libp2p = null
    helia = null
    orbitdb = null
    todoDB = null
    
    throw error
  }
}

// Store database event callbacks globally so they persist across function calls
let databaseUpdateCallbacks = []

// Map to store peerId -> OrbitDB address
const peerOrbitDbAddresses = new Map();

// Map to store discovered OrbitDB topics -> discovery info
const discoveredOrbitDBTopics = new Map();

// Store for reactive updates to discovered databases
export const discoveredDatabasesStore = writable([])

/**
 * Update the reactive store with discovered database information
 */
function updateDiscoveredDatabasesStore() {
  const databases = Array.from(discoveredOrbitDBTopics.values())
  discoveredDatabasesStore.set(databases)
}

/**
 * Get the map of peer OrbitDB addresses for UI consumption
 * @returns {Map} Map of peerId -> OrbitDB address
 */
export function getPeerOrbitDbAddresses() {
  return new Map(peerOrbitDbAddresses)
}

/**
 * Get information about the currently active database
 * @returns {Object} Current database information
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

// Export a function to open a selected peer's OrbitDB address
export async function openTodoDatabaseForPeer(peerId) {
  if (!orbitdb) {
    await initializeP2P();
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
  
  let address;
  if (peerId && peerOrbitDbAddresses.has(peerId)) {
    // Use the discovered OrbitDB address for this peer
    address = peerOrbitDbAddresses.get(peerId);
    console.log(`📍 Opening peer's database with address: ${address}`)
  } else {
    // fallback to default name 'todos'
    address = 'todos';
    console.log(`📍 Opening default database with name: ${address}`)
  }
  
  try {
    todoDB = await orbitdb.open(address, {
      type: 'keyvalue',
      accessController: {
        type: 'orbitdb',
        write: ['*']
      }
    });
    
    console.log(`✅ Successfully opened database:`, {
      address: todoDB.address,
      name: todoDB.dbName,
      type: todoDB.type
    })
    
    // Set up event listeners for the new database
    setupDatabaseEventListeners()
    
    return todoDB;
  } catch (error) {
    console.error(`❌ Failed to open database for peer ${peerId}:`, error)
    throw error
  }
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

export async function addTodo(text, assignee = null) {
  const db = await getTodoDatabase()
  
  try {
    // Validate input parameters
    if (!text || typeof text !== 'string') {
      throw new Error('Todo text must be a non-empty string')
    }
    
    if (assignee !== null && typeof assignee !== 'string') {
      throw new Error('Assignee must be a string or null')
    }
    
    const todoId = Date.now().toString()
    const todo = {
      text: String(text).trim(), // Ensure it's a clean string
      assignee: assignee ? String(assignee).trim() : null,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: libp2p?.peerId?.toString() || 'unknown'
    }
    
    console.log('🔍 Attempting to add todo:', {
      id: todoId,
      todo: todo,
      todoType: typeof todo,
      textType: typeof todo.text,
      textLength: todo.text.length
    })
    
    // Validate the todo object before storing
    if (!todo.text || todo.text.length === 0) {
      throw new Error('Todo text cannot be empty after trimming')
    }
    
    // Test JSON serialization (OrbitDB might require serializable data)
    try {
      const testSerialization = JSON.stringify(todo)
      const testDeserialization = JSON.parse(testSerialization)
      console.log('✅ Todo serialization test passed:', testDeserialization)
    } catch (serializationError) {
      console.error('❌ Todo serialization failed:', serializationError)
      throw new Error(`Todo data is not serializable: ${serializationError.message}`)
    }
    
    // Store in OrbitDB with detailed error handling
    let hash
    try {
      console.log('💾 Storing todo in OrbitDB...', { id: todoId, data: todo })
      hash = await db.set(todoId, todo)
      console.log('✅ Todo stored successfully, hash:', hash)
      // Don't close the database here - keep it open for event listening
      // db.close()
    } catch (dbError) {
      // Don't close the database here - keep it open for event listening
      // db.close()
      console.error('❌ OrbitDB storage error:', {
        error: dbError,
        message: dbError.message,
        stack: dbError.stack,
        todoId: todoId,
        todoData: todo
      })
      throw new Error(`Failed to store todo in database: ${dbError.message}`)
    }
    
    console.log('🎉 Todo added successfully:', { id: todoId, ...todo }, 'Hash:', hash)
    
    return { id: todoId, ...todo }
    
  } catch (error) {
    console.error('❌ Error in addTodo:', {
      error: error,
      message: error.message,
      stack: error.stack,
      inputText: text,
      inputAssignee: assignee
    })
    throw error // Re-throw to be handled by the UI
  }
}

export async function updateTodo(id, updates) {
  const db = await getTodoDatabase()
  const existingTodo = await db.get(id)
  
  if (existingTodo) {
    const updatedTodo = {
      ...existingTodo,
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: libp2p.peerId.toString()
    }
    
    const hash = await db.set(id, updatedTodo)
    console.log('Todo updated:', { id, ...updatedTodo }, 'Hash:', hash)
    // Don't close the database here - keep it open for event listening
    // db.close()
    return { id, ...updatedTodo }
  }
  
  throw new Error(`Todo with id ${id} not found`)
}

export async function deleteTodo(id) {
  const db = await getTodoDatabase()
  const existingTodo = await db.get(id)
  
  if (existingTodo) {
    const hash = await db.delete(id)
    console.log('Todo deleted:', id, 'Hash:', hash)
    // Don't close the database here - keep it open for event listening
    // db.close()
    return true
  }
  // Don't close the database here - keep it open for event listening
  // db.close()
  return false
}

export async function getAllTodos() {
  const db = await getTodoDatabase()
  
  try {
    const allDocs = await db.all()
    console.log('🔍 Raw OrbitDB data:', allDocs)
    console.log('🔍 OrbitDB data type:', typeof allDocs, 'Is Array:', Array.isArray(allDocs))
    
    let todos = []
    
    // Handle different OrbitDB response formats
    if (Array.isArray(allDocs)) {
      // OrbitDB returns array of {hash, key, value} objects
      console.log('📋 Processing array format data...')
      todos = allDocs.map((doc, index) => {
        console.log(`Processing doc ${index}:`, doc)
        
        if (!doc || !doc.value || typeof doc.value !== 'object') {
          console.warn('⚠️ Invalid document structure:', doc)
          return null
        }
        
        const value = doc.value
        const key = doc.key
        
        const todo = {
          id: key,
          text: value.text || '',
          assignee: value.assignee || null,
          completed: Boolean(value.completed),
          createdAt: value.createdAt || new Date().toISOString(),
          createdBy: value.createdBy || 'unknown',
          updatedAt: value.updatedAt || null,
          updatedBy: value.updatedBy || null
        }
        
        console.log('✅ Processed todo:', todo)
        return todo
      }).filter(todo => todo !== null)
      
    } else if (allDocs && typeof allDocs === 'object') {
      // OrbitDB returns plain object with key-value pairs
      console.log('📋 Processing object format data...')
      todos = Object.entries(allDocs).map(([key, value]) => {
        if (!value || typeof value !== 'object') {
          console.warn('⚠️ Invalid todo data for key:', key, 'Value:', value)
          return null
        }
        
        const todo = {
          id: key,
          text: value.text || '',
          assignee: value.assignee || null,
          completed: Boolean(value.completed),
          createdAt: value.createdAt || new Date().toISOString(),
          createdBy: value.createdBy || 'unknown',
          updatedAt: value.updatedAt || null,
          updatedBy: value.updatedBy || null
        }
            // db.close()
        return todo
      }).filter(todo => todo !== null)
    } else {
      console.warn('⚠️ Unexpected OrbitDB data format:', allDocs)
      return []
    }
    
    console.log('✅ Final processed todos:', todos.length, todos)
    // Don't close the database here - keep it open for event listening
    // db.close()
    return todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    
  } catch (error) {
    console.error('❌ Error fetching todos from OrbitDB:', error)
    return []
  }
}

export async function getConnectedPeers() {
  if (!libp2p) return [];
  const connections = libp2p.getConnections();
  const peerMap = new Map();

  for (const conn of connections) {
    const peerId = conn.remotePeer.toString();
    const addr = conn.remoteAddr ? conn.remoteAddr.toString() : '';
    let type = 'unknown';
    if (addr.includes('/webrtc')) type = 'webrtc';
    else if (addr.includes('/p2p-circuit')) type = 'circuit-relay';
    else if (addr.includes('/ws')) type = 'websocket';

    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, new Set());
    }
    peerMap.get(peerId).add(type);
  }

  // Convert to array of { peerId, transports: [...] }
  return Array.from(peerMap.entries()).map(([peerId, transportsSet]) => ({
    peerId,
    transports: Array.from(transportsSet)
  }));
}

/**
 * Get detailed connection information for all connected peers
 * @returns {Array} Array of connection details
 */
export function getConnectionDetails() {
  if (!libp2p) return []
  
  const currentPeers = libp2p.getPeers()
  const details = []
  
  for (const peerId of currentPeers) {
    const peerIdStr = peerId.toString()
    const connections = libp2p.getConnections(peerId)
    
    // Get stored details if available
    const storedDetails = getStoredConnectionDetails().get(peerIdStr)
    
    if (connections && connections.length > 0) {
      const connection = connections[0] // Use first connection
      const addr = connection.remoteAddr?.toString() || 'unknown'
      
      // Determine transport type from address
      let transport = 'unknown'
      if (addr.includes('/ws')) transport = 'websocket'
      else if (addr.includes('/webrtc')) transport = 'webrtc'
      else if (addr.includes('/tcp') && !addr.includes('/ws')) transport = 'tcp'
      else if (addr.includes('/p2p-circuit')) transport = 'circuit-relay'
      
      details.push({
        peerId: peerIdStr,
        peerIdFormatted: formatPeerId(peerIdStr),
        address: addr,
        transport,
        status: connection.status,
        direction: connection.stat.direction,
        connectedAt: storedDetails?.connectedAt || new Date().toISOString(),
        connectionCount: connections.length
      })
    }
  }
  
  return details
}

/**
 * Get the internal connection details map (for accessing within this module)
 * @returns {Map} Connection details map
 */
function getStoredConnectionDetails() {
  // This is a bit of a hack to access the connectionDetails map from outside the handler
  // In a real app, you'd want to structure this better
  return new Map() // Placeholder - the actual map is in the closure
}

export function getMyPeerId() {
  return libp2p?.peerId?.toString() || null
}

/**
 * Format PeerId for display - shows first 5 characters for better readability
 * @param {string} peerId - Full peer ID string
 * @returns {string} Formatted peer ID
 */
export function formatPeerId(peerId) {
  if (!peerId || typeof peerId !== 'string') {
    return 'unknown'
  }
  // Show first 4 and last 4 characters for better readability
  const start = peerId.slice(0, 4)
  const end = peerId.slice(-4)
  return `${start}...${end}`
}

/**
 * Get formatted version of my peer ID
 * @returns {string} Formatted peer ID
 */
export function getFormattedMyPeerId() {
  const peerId = getMyPeerId()
  return formatPeerId(peerId)
}

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

export async function getRelayDiscoveryStatus() {
  if (!relayDiscovery) {
    relayDiscovery = new RelayDiscovery()
  }
  
  try {
    const isHealthy = await relayDiscovery.isRelayHealthy()
    const addresses = relayDiscovery.cachedAddrs
    const lastFetch = relayDiscovery.lastFetch
    
    return {
      healthy: isHealthy,
      addresses: addresses,
      lastFetch: lastFetch,
      cacheAge: lastFetch ? Date.now() - lastFetch : null,
      cacheValid: addresses && lastFetch && (Date.now() - lastFetch) < relayDiscovery.cacheTTL
    }
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      addresses: null,
      lastFetch: null,
      cacheAge: null,
      cacheValid: false
    }
  }
}

/**
 * Run comprehensive database health check
 * @returns {Promise<Object>} Health report
 */
export async function runDatabaseHealthCheck() {
  console.log('🏥 Running database health check...')
  
  const components = {
    libp2p,
    helia,
    orbitdb,
    todoDB,
    verbose: true
  }
  
  const healthReport = await runHealthCheck(components)
  
  console.log('🏥 Health check results:', {
    overall: healthReport.overall,
    errors: healthReport.errors,
    recommendations: healthReport.recommendations
  })
  
  return healthReport
}

/**
 * Run health check and attempt automatic recovery
 * @param {Object} options - Recovery options
 * @returns {Promise<Object>} Health report with recovery actions
 */
export async function runDatabaseHealthCheckAndRecover(options = {}) {
  console.log('🔧 Running database health check with recovery...')
  
  const components = {
    libp2p,
    helia,
    orbitdb,
    todoDB,
    verbose: true
  }
  
  const result = await runHealthCheckAndRecover(components, options)
  
  console.log('🔧 Health check and recovery complete:', {
    overall: result.healthReport.overall,
    recoveryActions: result.recoveryActions,
    needsFullReset: result.needsFullReset
  })
  
  // If full reset is needed, clear the global variables
  if (result.needsFullReset) {
    console.warn('⚠️ Critical database issues detected - full reset recommended')
    libp2p = null
    helia = null
    orbitdb = null
    todoDB = null
  }
  
  return result
}

/**
 * Force reset all database components
 * @returns {Promise<void>}
 */
export async function forceResetDatabase() {
  console.log('🔄 Force resetting all database components...')
  
  try {
    // Stop all components gracefully
    if (todoDB) {
      try {
        await todoDB.drop()
        await todoDB.close()
      } catch (error) {
        console.warn('Error closing todo database:', error)
      }
    }
    
    if (orbitdb) {
      try {
        await orbitdb.stop()
      } catch (error) {
        console.warn('Error stopping OrbitDB:', error)
      }
    }
    
    if (helia) {
      try {
        await helia.stop()
      } catch (error) {
        console.warn('Error stopping Helia:', error)
      }
    }
    
    if (libp2p) {
      try {
        await libp2p.stop()
      } catch (error) {
        console.warn('Error stopping LibP2P:', error)
      }
    }
    
  } catch (error) {
    console.error('Error during component shutdown:', error)
  } finally {
    // Reset all global variables
    libp2p = null
    helia = null
    orbitdb = null
    todoDB = null
    relayDiscovery = null
    
    console.log('✅ Database reset complete')
  }
}

/**
 * Test OrbitDB operations directly for diagnostics
 * @returns {Promise<Object>} Test results
 */
export async function testOrbitDBOperations() {
  console.log('🧪 Starting OrbitDB operations test...')
  
  try {
    const db = await getTodoDatabase()
    console.log('✅ Database obtained:', db.address)
    
    // Test 1: Simple key-value storage
    const testKey = `test-${Date.now()}`
    const testValue = {
      message: 'Hello OrbitDB',
      timestamp: new Date().toISOString(),
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      nested: { key: 'value' }
    }
    
    console.log('📋 Test 1: Storing test data...', { key: testKey, value: testValue })
    
    let hash
    try {
      hash = await db.set(testKey, testValue)
      console.log('✅ Test 1 PASSED: Data stored successfully, hash:', hash)
    } catch (setError) {
      console.error('❌ Test 1 FAILED: Set operation failed:', setError)
      return { success: false, error: 'Set operation failed', details: setError }
    }
    
    // Test 2: Retrieve the data
    console.log('📋 Test 2: Retrieving test data...')
    try {
      const retrieved = await db.get(testKey)
      console.log('✅ Test 2 PASSED: Data retrieved successfully:', retrieved)
      
      // Verify data integrity
      if (JSON.stringify(retrieved) === JSON.stringify(testValue)) {
        console.log('✅ Test 2a PASSED: Data integrity verified')
      } else {
        console.warn('⚠️ Test 2a WARNING: Data integrity mismatch', {
          expected: testValue,
          actual: retrieved
        })
      }
    } catch (getError) {
      console.error('❌ Test 2 FAILED: Get operation failed:', getError)
      return { success: false, error: 'Get operation failed', details: getError }
    }
    
    // Test 3: List all entries
    console.log('📋 Test 3: Listing all entries...')
    try {
      const allEntries = await db.all()
      console.log('✅ Test 3 PASSED: All entries retrieved:', Object.keys(allEntries).length, 'entries')
      console.log('Sample entries:', allEntries)
    } catch (allError) {
      console.error('❌ Test 3 FAILED: All operation failed:', allError)
      return { success: false, error: 'All operation failed', details: allError }
    }
    
    // Test 4: Delete the test entry
    console.log('📋 Test 4: Deleting test data...')
    try {
      const deleteResult = await db.delete(testKey)
      console.log('✅ Test 4 PASSED: Data deleted successfully, result:', deleteResult)
    } catch (deleteError) {
      console.error('❌ Test 4 FAILED: Delete operation failed:', deleteError)
      return { success: false, error: 'Delete operation failed', details: deleteError }
    }
    
    console.log('🎉 All OrbitDB tests passed successfully!')
    return { 
      success: true, 
      message: 'All OrbitDB operations working correctly',
      testHash: hash
    }
    
  } catch (error) {
    console.error('❌ OrbitDB test suite failed:', error)
    return { 
      success: false, 
      error: 'Test suite failed', 
      details: error,
      message: error.message
    }
  }
}

/**
 * Debug function to inspect current todos in console
 */
export async function debugTodos() {
  console.log('🐛 === DEBUG TODOS START ===')
  
  try {
    const db = await getTodoDatabase()
    console.log('📊 Database info:', {
      address: db.address,
      type: db.type,
      open: db.opened,
      writable: db.access.write
    })
    
    console.log('🔍 Fetching raw database content...')
    const rawData = await db.all()
    console.log('📦 Raw OrbitDB data:', rawData)
    console.log('📈 Raw data stats:', {
      type: typeof rawData,
      isArray: Array.isArray(rawData),
      keys: Object.keys(rawData || {}),
      length: Array.isArray(rawData) ? rawData.length : Object.keys(rawData || {}).length
    })
    
    console.log('🔄 Processing todos...')
    const todos = await getAllTodos()
    console.log('✅ Processed todos:', todos)
    console.log('📊 Todos stats:', {
      count: todos.length,
      sampleTodo: todos[0] || 'No todos found'
    })
    
  } catch (error) {
    console.error('❌ Debug error:', error)
  }
  
  console.log('🐛 === DEBUG TODOS END ===')
}

/**
 * Get the current OrbitDB address (or null if not open)
 */
export function getTodoDbAddress() {
  return todoDB?.address?.toString?.() || null
}

/**
 * Get the current OrbitDB name (or null if not open)
 */
export function getTodoDbName() {
  return todoDB?.dbName || null
}

/**
 * Test pubsub self-message visibility in browser
 */
export async function testPubsubSelfMessages() {
  if (!libp2p) {
    console.warn('❌ libp2p not initialized yet. Please wait for P2P initialization to complete.');
    return;
  }
  
  console.log('🧪 Testing pubsub self-message visibility...');
  
  // Enhanced diagnostics
  const pubsubService = libp2p.services.pubsub;
  const connections = libp2p.getConnections();
  
  console.log('📊 Detailed pubsub state:', {
    peerId: libp2p.peerId.toString(),
    subscriptions: Array.from(pubsubService.subscriptions),
    connectedPeers: connections.length,
    peerConnections: connections.map(c => ({
      peer: c.remotePeer.toString(),
      status: c.status,
      direction: c.stat?.direction || 'unknown',
      address: c.remoteAddr?.toString() || 'unknown'
    })),
    pubsubType: pubsubService.constructor.name,
    started: pubsubService.started,
    topics: pubsubService.getTopics ? pubsubService.getTopics() : 'N/A',
    peers: pubsubService.getPeers ? pubsubService.getPeers() : 'N/A'
  });
  
  // Check gossipsub internals if available
  try {
    if (pubsubService.mesh) {
      console.log('🕸️ Gossipsub mesh info:', {
        meshTopics: Array.from(pubsubService.mesh.keys()),
        fanout: pubsubService.fanout ? Array.from(pubsubService.fanout.keys()) : [],
        gossip: pubsubService.gossip ? Array.from(pubsubService.gossip.keys()) : []
      });
    }
  } catch (e) {
    console.log('⚠️ Could not access gossipsub internals:', e.message);
  }
  
  let messageCount = 0;
  const receivedMessages = [];
  
  // Subscribe to test topic with logging
  const testTopic = 'pubsub-self-test';
  console.log(`📡 Subscribing to topic: ${testTopic}`);
  
  const messageHandler = (msg) => {
    messageCount++;
    const raw = new TextDecoder().decode(msg.data);
    const myPeerId = libp2p.peerId.toString();
    
    console.log(`📩 [${messageCount}] Message received on ${testTopic}:`, {
      from: msg.from,
      topic: msg.topic,
      data: raw,
      isSelf: msg.from === myPeerId,
      myPeerId
    });
    
    receivedMessages.push({
      from: msg.from,
      topic: msg.topic,
      data: raw,
      isSelf: msg.from === myPeerId,
      timestamp: Date.now()
    });
    
    if (msg.from === myPeerId) {
      console.log('🎯 SELF-MESSAGE detected! emitSelf is working!');
    }
  };
  
  libp2p.services.pubsub.subscribe(testTopic, messageHandler);
  
  // Wait a moment for subscription to register
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Publish test messages
  console.log('📤 Publishing test messages...');
  
  for (let i = 1; i <= 3; i++) {
    const message = JSON.stringify({
      test: i,
      timestamp: new Date().toISOString(),
      peerId: libp2p.peerId.toString(),
      message: `Test message ${i}`
    });
    
    console.log(`📤 Publishing message ${i}...`);
    await libp2p.services.pubsub.publish(testTopic, uint8ArrayFromString(message));
    
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // Wait for message delivery
  console.log('⏳ Waiting for message delivery...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Results summary
  const selfMessages = receivedMessages.filter(m => m.isSelf);
  const otherMessages = receivedMessages.filter(m => !m.isSelf);
  
  console.log('📊 TEST RESULTS:');
  console.log(`  - Messages published: 3`);
  console.log(`  - Messages received: ${messageCount}`);
  console.log(`  - Self-messages received: ${selfMessages.length}`);
  console.log(`  - Other-messages received: ${otherMessages.length}`);
  
  if (selfMessages.length === 3) {
    console.log('✅ SUCCESS: All self-messages received! emitSelf is working correctly.');
  } else if (selfMessages.length > 0) {
    console.log('⚠️  PARTIAL: Some self-messages received, but not all.');
  } else {
    console.log('❌ PROBLEM: No self-messages received. emitSelf might not be working.');
  }
  
  // Cleanup
  libp2p.services.pubsub.unsubscribe(testTopic, messageHandler);
  console.log('🧹 Test complete, unsubscribed from test topic.');
  
  return {
    published: 3,
    received: messageCount,
    selfMessages: selfMessages.length,
    otherMessages: otherMessages.length,
    success: selfMessages.length === 3
  };
}

// Expose API for Playwright tests
if (browser && typeof window !== 'undefined') {
  window.app = {
    addTodo,
    updateTodo,
    deleteTodo,
    getAllTodos,
    getConnectedPeers,
    getMyPeerId,
    runDatabaseHealthCheck,
    runDatabaseHealthCheckAndRecover,
    forceResetDatabase,
    testOrbitDBOperations,
    debugTodos,
    testPubsubSelfMessages
  }
  
  // Also expose debug functions globally for easy console access
  window.debugTodos = debugTodos
  window.testOrbitDB = testOrbitDBOperations
  window.healthCheck = runDatabaseHealthCheck
  window.healthRecover = runDatabaseHealthCheckAndRecover
  window.resetDB = forceResetDatabase
  window.testPubsub = testPubsubSelfMessages
  window.debugPubsub = () => {
    if (!libp2p) {
      console.log('❌ libp2p not initialized');
      return;
    }
    const pubsub = libp2p.services.pubsub;
    console.log('🔍 PUBSUB DEBUG INFO:');
    console.log('  - PeerId:', libp2p.peerId.toString());
    console.log('  - Pubsub started:', pubsub.started);
    console.log('  - Subscriptions:', Array.from(pubsub.subscriptions));
    console.log('  - Connected peers:', libp2p.getConnections().length);
    console.log('  - Pubsub peers:', pubsub.getPeers ? pubsub.getPeers() : 'N/A');
    console.log('  - Topics:', pubsub.getTopics ? pubsub.getTopics() : 'N/A');
    
    if (pubsub.mesh) {
      console.log('  - Mesh topics:', Array.from(pubsub.mesh.keys()));
      console.log('  - Fanout topics:', pubsub.fanout ? Array.from(pubsub.fanout.keys()) : []);
      
      // Check mesh peers for each topic
      for (const [topic, peers] of pubsub.mesh) {
        console.log(`  - Mesh peers for '${topic}':`, peers ? Array.from(peers).map(p => p.toString()) : 'none');
      }
    }
    
    // Try to access emitSelf setting
    try {
      console.log('  - emitSelf setting:', pubsub.emitSelf);
    } catch (e) {
      console.log('  - emitSelf setting: not accessible');
    }
    
    // Try to access gossipsub configuration
    try {
      console.log('  - Gossipsub config:', {
        allowPublishToZeroTopicPeers: pubsub.allowPublishToZeroTopicPeers,
        canRelayMessage: pubsub.canRelayMessage,
        gossipIncoming: pubsub.gossipIncoming,
        fallbackToFloodsub: pubsub.fallbackToFloodsub,
        floodPublish: pubsub.floodPublish
      });
    } catch (e) {
      console.log('  - Gossipsub config: not accessible', e.message);
    }
  }
  
  // Test basic pubsub publish/subscribe without self-messages first
  window.testBasicPubsub = async () => {
    if (!libp2p) {
      console.warn('❌ libp2p not initialized yet.');
      return;
    }
    
    console.log('🧪 Testing basic pubsub (without emitSelf)...');
    const pubsub = libp2p.services.pubsub;
    const testTopic = 'basic-pubsub-test';
    let messageCount = 0;
    
    const messageHandler = (msg) => {
      messageCount++;
      const raw = new TextDecoder().decode(msg.data);
      console.log(`📩 Basic test message received:`, {
        from: msg.from,
        topic: msg.topic,
        data: raw,
        messageCount
      });
    };
    
    // Subscribe
    pubsub.subscribe(testTopic, messageHandler);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check if topic is in mesh
    console.log('🔍 Topic subscription status:');
    console.log('  - Subscribed topics:', Array.from(pubsub.subscriptions));
    console.log('  - Mesh topics:', pubsub.mesh ? Array.from(pubsub.mesh.keys()) : 'N/A');
    
    // Try publishing without emitSelf expectation
    console.log('📤 Publishing to basic test topic...');
    await pubsub.publish(testTopic, uint8ArrayFromString(JSON.stringify({
      test: 'basic-test',
      timestamp: new Date().toISOString(),
      peerId: libp2p.peerId.toString()
    })));
    
    // Wait and report
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`📊 Basic test result: ${messageCount} messages received`);
    
    // Cleanup
    pubsub.unsubscribe(testTopic, messageHandler);
    
    return { messageCount, success: messageCount > 0 };
  }
  
  // Test OrbitDB-like topic to trigger discovery
  window.testOrbitDBTopicSubscription = async () => {
    if (!libp2p) {
      console.warn('❌ libp2p not initialized yet.');
      return;
    }
    
    console.log('🧪 Testing OrbitDB-like topic subscription...');
    const pubsub = libp2p.services.pubsub;
    const orbitTopic = '/orbitdb/zdpuTest1234567890123456789012345678901234567890';
    
    console.log(`📡 Subscribing to OrbitDB-like topic: ${orbitTopic}`);
    
    const messageHandler = (msg) => {
      console.log(`📩 Message received on OrbitDB topic:`, {
        from: msg.from,
        topic: msg.topic,
        data: new TextDecoder().decode(msg.data)
      });
    };
    
    // Subscribe to OrbitDB-like topic (this should trigger discovery)
    await pubsub.subscribe(orbitTopic, messageHandler);
    
    console.log('✅ Subscribed to OrbitDB-like topic. Check console for discovery events.');
    
    return { topic: orbitTopic, subscribed: true };
  }
  
  // Check subscription change event listeners
  window.debugSubscriptionListeners = () => {
    if (!libp2p) {
      console.warn('❌ libp2p not initialized yet.');
      return;
    }
    
    const pubsub = libp2p.services.pubsub;
    console.log('🔍 SUBSCRIPTION EVENT LISTENERS DEBUG:');
    console.log('  - Pubsub instance:', pubsub);
    console.log('  - Event listeners:', pubsub.listenerCount ? pubsub.listenerCount('subscription-change') : 'Cannot check');
    
    // Try to see if events are supported
    try {
      console.log('  - Event emitter methods:', {
        addEventListener: typeof pubsub.addEventListener,
        removeEventListener: typeof pubsub.removeEventListener,
        on: typeof pubsub.on,
        emit: typeof pubsub.emit
      });
    } catch (e) {
      console.log('  - Error checking event methods:', e.message);
    }
  }
}
// Restore getTodoDatabase export
export async function getTodoDatabase() {
  if (!orbitdb) {
    await initializeP2P();
  }
  if (!todoDB) {
    // Use a fixed database address for all peers to connect to the same DB
    todoDB = await orbitdb.open('todos', {
      type: 'keyvalue',
      accessController: {
        type: 'orbitdb',
        write: ['*'] // Allow all peers to write (simplified for demo)
      }
    });
    setupDatabaseEventListeners();
  }
  return todoDB;
}
