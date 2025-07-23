// Main P2P module using refactored architecture
import { writable } from 'svelte/store'
import { OrbitDBTopicDiscovery } from './orbit-discovery.js'

// Import from refactored modules
import { initializeP2P as initP2PNetwork, getLibP2P, getHelia, stopP2P } from './p2p/network.js'
import { 
  initializeOrbitDB, 
  getTodoDatabase, 
  onDatabaseUpdate, 
  getTodoDbAddress, 
  getTodoDbName, 
  openTodoDatabaseForPeer, 
  getPeerOrbitDbAddresses, 
  getCurrentDatabaseInfo,
  stopOrbitDB
} from './p2p/database.js'
import { addTodo, updateTodo, deleteTodo, getAllTodos } from './p2p/todos.js'
import { 
  getConnectedPeers as getConnectedPeersFromModule, 
  formatPeerId, 
  getMyPeerId as getMyPeerIdFromModule,
  discoveredPeersStore 
} from './p2p/peer-discovery.js'
import { getRelayDiscoveryStatus } from './p2p/diagnostics.js'

// Re-export functions and stores
export { 
  discoveredPeersStore,
  getTodoDatabase,
  onDatabaseUpdate,
  getTodoDbAddress,
  getTodoDbName,
  openTodoDatabaseForPeer,
  getPeerOrbitDbAddresses,
  getCurrentDatabaseInfo,
  addTodo,
  updateTodo,
  deleteTodo,
  getAllTodos,
  formatPeerId,
  getRelayDiscoveryStatus
}

/**
 * Get my peer ID (wrapper around peer-discovery module)
 */
export function getMyPeerId() {
  const libp2p = getLibP2P()
  return getMyPeerIdFromModule(libp2p)
}

/**
 * Get connected peers (wrapper around peer-discovery module)
 */
export function getConnectedPeers() {
  const libp2p = getLibP2P()
  return getConnectedPeersFromModule(libp2p)
}

/**
 * Main P2P initialization function
 */
export async function initializeP2P() {
  console.log('🚀 Initializing P2P system...')
  
  // Initialize network layer (LibP2P + Helia)
  await initP2PNetwork()
  
  // Get network instances
  const libp2p = getLibP2P()
  const helia = getHelia()
  
  if (!libp2p || !helia) {
    throw new Error('Failed to initialize network layer')
  }
  
  // Initialize OrbitDB layer
  await initializeOrbitDB(helia)
  
  // Set up OrbitDB topic discovery
  await setupOrbitDBTopicDiscovery(helia)
  
  // Open the default database
  await getTodoDatabase(helia)
  
  console.log('✅ P2P system initialized successfully')
  return libp2p
}

/**
 * Set up OrbitDB topic discovery integration
 */
async function setupOrbitDBTopicDiscovery(helia) {
  console.log('🔍 Setting up OrbitDB topic discovery...')
  
  const discovery = new OrbitDBTopicDiscovery(helia)
  
  // Add debug listener for subscription changes
  helia.libp2p.services.pubsub.addEventListener('subscription-change', (event) => {
    const eventData = {
      peerId: event.detail.peerId.toString(),
      subscriptions: event.detail.subscriptions.map(s => ({
        topic: s.topic,
        subscribe: s.subscribe,
        isOrbitDB: s.topic.startsWith('/orbitdb/') || s.topic.includes('orbitdb')
      }))
    }
    console.log('🎯 [DEBUG] Raw subscription-change event received:', eventData)
    
    // Check if any OrbitDB topics were detected
    const orbitDBTopics = eventData.subscriptions.filter(s => s.isOrbitDB && s.subscribe)
    if (orbitDBTopics.length > 0) {
      console.log('🎯 [ORBITDB DETECTED] OrbitDB topics found:', orbitDBTopics.map(s => s.topic))
    }
  })
  
  // Start discovery and handle discovered topics
  await discovery.startDiscovery(async (topic, peerId) => {
    console.log(`🎯 [DISCOVERY] OrbitDB topic discovered: ${topic} from peer: ${peerId}`)
    
    try {
      await helia.libp2p.services.pubsub.subscribe(topic)
      console.log(`✅ Successfully subscribed to OrbitDB topic: ${topic}`)
      
      // Dispatch event for UI updates
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('orbitdb-database-discovered', {
          detail: { peerId: peerId.toString(), topic, address: topic }
        }))
      }
    } catch (error) {
      console.error(`❌ Failed to subscribe to OrbitDB topic ${topic}:`, error)
    }
  })
  
  // Enable auto-subscribe for OrbitDB messages
  await discovery.enableAutoSubscribe(async (event) => {
    const { topic, from, data } = event.detail
    console.log(`📩 [ORBITDB] Message on topic ${topic} from ${from}:`, new TextDecoder().decode(data))
  })
  
  console.log('✅ OrbitDB topic discovery configured')
}

// Expose API for browser debugging if needed
const browser = typeof window !== 'undefined'
if (browser && typeof window !== 'undefined') {
  window.p2p = {
    getMyPeerId,
    getConnectedPeers,
    getTodoDatabase,
    addTodo,
    updateTodo,
    deleteTodo,
    getAllTodos,
    getTodoDbAddress,
    getTodoDbName,
    formatPeerId
  }
}
