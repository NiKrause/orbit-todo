import { createLibp2p } from 'libp2p'
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
import { Multiaddr } from 'multiaddr'

const RELAY_BOOTSTRAP_ADDR = '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE'
const BOOTSTRAP_ADDRS = [RELAY_BOOTSTRAP_ADDR]
const BOOTSTRAP_PEER_IDS = BOOTSTRAP_ADDRS.map(addr => {
  try {
    const ma = new Multiaddr(addr)
    return ma.getPeerId()
  } catch (e) {
    return null
  }
}).filter(Boolean)

let libp2p = null

export function getLibp2p() {
  return libp2p
}

export async function createP2PNode({ testPeerId } = {}) {
  let privateKey = null
  if (testPeerId) {
    try {
      privateKey = privateKeyFromProtobuf(uint8ArrayFromString(testPeerId, 'hex'))
    } catch (error) {
      console.warn('Invalid test peer ID, generating random key:', error)
    }
  }

  libp2p = await createLibp2p({
    ...(privateKey && { privateKey }),
    addresses: {
      listen: [
        '/p2p-circuit',
        '/webrtc',
        '/webtransport',
        '/wss',
        '/ws'
      ]
    },
    transports: [
      webSockets({ filter: filters.all }),
      webRTC(),
      circuitRelayTransport({ discoverRelays: 1 })
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
        interval: 5000,
        topics: ['todo._peer-discovery._p2p._pubsub'],
        listenOnly: false,
        emitSelf: true
      })
    ],
    services: {
      identify: identify(),
      bootstrap: bootstrap({ list: [RELAY_BOOTSTRAP_ADDR] }),
      ping: ping(),
      dcutr: dcutr(),
      autonat: autoNAT(),
      pubsub: gossipsub({
        emitSelf: true,
        allowPublishToZeroTopicPeers: true
      })
    }
  })

  return libp2p
}

/**
 * Set up peer discovery event handlers and auto-dialing
 * @param {Libp2p} node
 * @param {Object} handlers - { onPeerDiscovered, onPeerConnected, onPeerDisconnected }
 */
export function setupPeerDiscoveryHandlers(node, handlers = {}) {
  const discoveredPeers = new Set()
  const connectionAttempts = new Map()
  const connectionDetails = new Map()

  node.addEventListener('peer:discovery', async (event) => {
    const { id: peerId, multiaddrs } = event.detail
    const peerIdStr = peerId?.toString()
    if (discoveredPeers.has(peerIdStr)) return
    const existingConnections = node.getConnections(peerId)
    if (existingConnections && existingConnections.length > 0) {
      discoveredPeers.add(peerIdStr)
      handlers.onPeerDiscovered?.(peerIdStr, multiaddrs)
      return
    }
    const lastAttempt = connectionAttempts.get(peerIdStr)
    if (lastAttempt && (Date.now() - lastAttempt) < 30000) return
    discoveredPeers.add(peerIdStr)
    handlers.onPeerDiscovered?.(peerIdStr, multiaddrs)
    try {
      await node.dial(peerId)
    } catch (error) {
      connectionAttempts.set(peerIdStr, Date.now())
    }
  })

  node.addEventListener('peer:connect', async (event) => {
    const peerId = event.detail?.remotePeer || event.detail || event.peerId || event
    const peerIdStr = typeof peerId.toString === 'function' ? peerId.toString() : String(peerId)
    const addr = event.detail?.remoteAddr?.toString?.() || 'unknown'
    let transport = 'unknown'
    if (addr.includes('/ws')) transport = 'websocket'
    else if (addr.includes('/webrtc')) transport = 'webrtc'
    else if (addr.includes('/tcp') && !addr.includes('/ws')) transport = 'tcp'
    else if (addr.includes('/p2p-circuit')) transport = 'circuit-relay'
    connectionDetails.set(peerIdStr, {
      peerId: peerIdStr,
      address: addr,
      transport,
      connectedAt: new Date().toISOString(),
      status: 'connected'
    })
    connectionAttempts.delete(peerIdStr)
    handlers.onPeerConnected?.(peerIdStr, addr, transport)
  })

  node.addEventListener('peer:disconnect', (event) => {
    const { remotePeer } = event.detail
    const peerIdStr = remotePeer?.toString()
    connectionDetails.delete(peerIdStr)
    discoveredPeers.delete(peerIdStr)
    handlers.onPeerDisconnected?.(peerIdStr)
  })
}

export function getConnectionDetails(node) {
  const currentPeers = node.getPeers()
  const details = []
  for (const peerId of currentPeers) {
    const peerIdStr = peerId.toString()
    const connections = node.getConnections(peerId)
    if (connections && connections.length > 0) {
      const connection = connections[0]
      const addr = connection.remoteAddr?.toString() || 'unknown'
      let transport = 'unknown'
      if (addr.includes('/ws')) transport = 'websocket'
      else if (addr.includes('/webrtc')) transport = 'webrtc'
      else if (addr.includes('/tcp') && !addr.includes('/ws')) transport = 'tcp'
      else if (addr.includes('/p2p-circuit')) transport = 'circuit-relay'
      details.push({
        peerId: peerIdStr,
        address: addr,
        transport,
        status: connection.status,
        direction: connection.stat.direction,
        connectedAt: new Date().toISOString(),
        connectionCount: connections.length
      })
    }
  }
  return details
}

export function formatPeerId(peerId) {
  if (!peerId || typeof peerId !== 'string') return 'unknown'
  const start = peerId.slice(0, 4)
  const end = peerId.slice(-4)
  return `${start}...${end}`
}
