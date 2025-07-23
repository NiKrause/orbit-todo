import { writable } from 'svelte/store'

export const discoveredPeersStore = writable([])

/**
 * Peer discovery state management
 */
const discoveredPeers = new Set()
const connectionAttempts = new Map() // Track failed attempts
const connectionDetails = new Map() // Track connection transport details

/**
 * Format PeerId for display - shows first 4 and last 4 characters
 */
export function formatPeerId(peerId) {
  if (!peerId || typeof peerId !== 'string') {
    return 'unknown'
  }
  const start = peerId.slice(0, 4)
  const end = peerId.slice(-4)
  return `${start}...${end}`
}

/**
 * Set up peer discovery event handlers and auto-dialing
 */
function setupPeerDiscoveryHandlers(node) {
  console.log('🔍 Setting up peer discovery event handlers...')
  
  // Handle peer discovery events
  node.addEventListener('peer:discovery', async (event) => {
    const { id: peerId, multiaddrs } = event.detail
    const peerIdStr = peerId?.toString()
    
    console.log('🎯 Peer discovered:', formatPeerId(peerIdStr), 'Addresses:', multiaddrs.map(ma => ma.toString()))
    
    // Log WebRTC addresses specifically for debugging
    const webrtcAddrs = multiaddrs.filter(ma => ma.toString().includes('/webrtc'))
    const relayAddrs = multiaddrs.filter(ma => ma.toString().includes('/p2p-circuit'))
    const wsAddrs = multiaddrs.filter(ma => ma.toString().includes('/ws'))
    
    console.log(`  📊 Address breakdown: WebRTC(${webrtcAddrs.length}), Relay(${relayAddrs.length}), WebSocket(${wsAddrs.length})`)
    if (webrtcAddrs.length > 0) {
      console.log('  🌐 WebRTC addresses:', webrtcAddrs.map(ma => ma.toString()))
    }
    
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
    const peerId = event.detail?.remotePeer || event.detail || event.peerId || event
    const peerIdStr = typeof peerId.toString === 'function' ? peerId.toString() : String(peerId)
    const addr = event.detail?.remoteAddr?.toString?.() || 'unknown'

    console.log(`🤝 [peer:connect] PeerId: ${peerIdStr} | Direct address: ${addr}`)

    // Log connection addresses
    const connections = node.getConnections(peerId)
    if (connections.length > 0) {
      connections.forEach(conn => {
        console.log(`   - Active connection address: ${conn.remoteAddr?.toString()}`)
      })
    } else {
      try {
        const peer = await node.peerStore.get(peerId)
        const addrs = peer?.addresses?.map(a => a.multiaddr.toString()) || []
        if (addrs.length > 0) {
          console.log(`   - Known addresses from peerStore:`, addrs)
        } else {
          console.log('   - No known addresses for this peer.')
        }
      } catch (err) {
        console.log('   - Could not retrieve addresses from peerStore:', err.message)
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
    
    // Dispatch browser event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('p2p-peer-connected', {
        detail: {
          peerId: peerIdStr,
          peerIdFormatted: formatPeerId(peerIdStr),
          transport,
          address: addr
        }
      }))
    }
  })
  
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

    // Dispatch browser event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('p2p-peer-disconnected', {
        detail: {
          peerId: peerIdStr
        }
      }))
    }
  })
  
  console.log('✅ Peer discovery handlers configured')
}

/**
 * Get connected peers with transport information
 */
export function getConnectedPeers(libp2p) {
  if (!libp2p) return []
  
  const connections = libp2p.getConnections()
  const peerMap = new Map()

  for (const conn of connections) {
    const peerId = conn.remotePeer.toString()
    const addr = conn.remoteAddr ? conn.remoteAddr.toString() : ''
    let type = 'unknown'
    if (addr.includes('/webrtc')) type = 'webrtc'
    else if (addr.includes('/p2p-circuit')) type = 'circuit-relay'
    else if (addr.includes('/ws')) type = 'websocket'

    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, new Set())
    }
    peerMap.get(peerId).add(type)
  }

  // Convert to array of { peerId, transports: [...] }
  return Array.from(peerMap.entries()).map(([peerId, transportsSet]) => ({
    peerId,
    transports: Array.from(transportsSet)
  }))
}

/**
 * Get detailed connection information for all connected peers
 */
export function getConnectionDetails(libp2p) {
  if (!libp2p) return []
  
  const currentPeers = libp2p.getPeers()
  const details = []
  
  for (const peerId of currentPeers) {
    const peerIdStr = peerId.toString()
    const connections = libp2p.getConnections(peerId)
    
    // Get stored details if available
    const storedDetails = connectionDetails.get(peerIdStr)
    
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
 * Get my peer ID
 */
export function getMyPeerId(libp2p) {
  return libp2p?.peerId?.toString() || null
}

/**
 * Get formatted version of my peer ID
 */
export function getFormattedMyPeerId(libp2p) {
  const peerId = getMyPeerId(libp2p)
  return formatPeerId(peerId)
}

// Export the main peer discovery object
export const peerDiscovery = {
  setupHandlers: setupPeerDiscoveryHandlers,
  getConnectedPeers,
  getConnectionDetails,
  getMyPeerId,
  getFormattedMyPeerId,
  formatPeerId
}
