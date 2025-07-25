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
import { discoverRelay } from '../utils/relay-discovery.js'
import { 
  requestWritePermission,
  grantWritePermission,
  denyWritePermission,
  getMyWritePermissionRequests,
  getMyOutgoingWritePermissionRequests,
  hasWritePermission,
  writePermissionRequestsStore,
  getWritePermissionDatabaseStatus,
  testWritePermissionDatabaseConnection,
  ensureWritePermissionDatabaseOpen
} from './write-permissions.js'

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
  getRelayDiscoveryStatus,
  discoverRelay,
  requestWritePermission,
  grantWritePermission,
  denyWritePermission,
  getMyWritePermissionRequests,
  getMyOutgoingWritePermissionRequests,
  hasWritePermission,
  writePermissionRequestsStore,
  getWritePermissionDatabaseStatus,
  testWritePermissionDatabaseConnection,
  ensureWritePermissionDatabaseOpen
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
  
  // Open the default database
  await getTodoDatabase(helia)
  
  console.log('✅ P2P system initialized successfully')
  return libp2p
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
    formatPeerId,
    // Diagnostic functions
    getWritePermissionDatabaseStatus,
    testWritePermissionDatabaseConnection,
    ensureWritePermissionDatabaseOpen
  }
}
