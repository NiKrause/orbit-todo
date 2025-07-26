import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'
import * as filters from '@libp2p/websockets/filters'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { tcp } from '@libp2p/tcp'
import { ping } from '@libp2p/ping'
import { dcutr } from '@libp2p/dcutr'
import { autoNAT } from '@libp2p/autonat'
import { config } from 'dotenv'
import express from 'express'
import { tls } from '@libp2p/tls'
import { uPnPNAT } from '@libp2p/upnp-nat'
import { LevelDatastore } from 'datastore-level'
import { prometheusMetrics } from '@libp2p/prometheus-metrics'

// Load environment variables
config()

// Default relay private key (from orbit-blog)
const defaultRelayPrivKey = '08011240821cb6bc3d4547fcccb513e82e4d718089f8a166b23ffcd4a436754b6b0774cf07447d1693cd10ce11ef950d7517bad6e9472b41a927cd17fc3fb23f8c70cd99'

// Use env variable or default key
const relayPrivKey = process.env.RELAY_PRIV_KEY || defaultRelayPrivKey
if (!relayPrivKey) {
  console.error('RELAY_PRIV_KEY must be set!');
  process.exit(1);
}
const privateKey = privateKeyFromProtobuf(uint8ArrayFromString(relayPrivKey, 'hex'))

// Port configuration
const wsPort = process.env.RELAY_WS_PORT || 4001
const tcpPort = process.env.RELAY_TCP_PORT || 4002
const webrtcPort = process.env.RELAY_WEBRTC_PORT || 4006

const server = await createLibp2p({
  privateKey,
  addresses: {
    listen: [
      `/ip4/0.0.0.0/tcp/${wsPort}/ws`,
      `/ip4/0.0.0.0/tcp/${tcpPort}`,
      `/ip4/0.0.0.0/tcp/${webrtcPort}/webrtc`,    // Direct WebRTC for private-to-public
      '/p2p-circuit'
    ],
    announce: [
      `/ip4/127.0.0.1/tcp/${wsPort}/ws`,
      `/ip4/127.0.0.1/tcp/${tcpPort}`,
      `/ip4/127.0.0.1/tcp/${webrtcPort}/webrtc`, // Announce direct WebRTC address
      '/p2p-circuit/webrtc'
    ]
  },
  transports: [
    tcp(),
    webRTC({
      rtcConfiguration: {
        iceServers: [
          {
            urls: [
              'stun:stun.l.google.com:19302',
              'stun:global.stun.twilio.com:3478'
            ]
          }
        ]
      }
    }),
    circuitRelayTransport({
      discoverRelays: 1
    }),
    webRTCDirect({
      rtcConfiguration: {
        iceServers: [
          {
            urls: [
              'stun:stun.l.google.com:19302',
              'stun:global.stun.twilio.com:3478'
            ]
          }
        ]
      }
    }),
    webSockets({
      filter: filters.all
    })
  ],
  peerDiscovery: [
    pubsubPeerDiscovery({
      interval: 10000, // Broadcast every 10 seconds
      topics: (process.env.PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub').split(',').map(t => t.trim()), // Configurable topics
      listenOnly: false,
      emitSelf: true // Enable broadcasting even with no initial peers
    })
  ],
  connectionGater: {
      denyDialMultiaddr: () => false
  },
  connectionEncrypters: [tls(), noise()],
  streamMuxers: [yamux()],
  nat: {
    enabled: true,
    description: 'libp2p-relay'
  },
  services: {
    ping: ping(),
    autoNAT: autoNAT(),
    dcutr: dcutr(),
    identify: identify(),
    pubsub: gossipsub({
      emitSelf: true,
      listenOnly: false,
      allowPublishToZeroTopicPeers: true,
      canRelayMessage: true,
      scoreParams: {
        gossipThreshold: -Infinity,
        publishThreshold: -Infinity,
        graylistThreshold: -Infinity,
        acceptPXThreshold: 0,
        opportunisticGraftThreshold: 0
      },
    }),
    uPnPNAT: uPnPNAT(),
    relay: circuitRelayServer({
      reservations: {
        maxReservations: 5000,
        reservationTtl: 1000 * 60 * 60, // 1 hour
        defaultDataLimit: BigInt(1024 * 1024 * 1024) // 1GB
      }
    })
  }
})

// Start the server
await server.start()

// Enhanced peer connection logging
let connectedPeers = new Map() // Track connection details
server.addEventListener('peer:discovery', async (event) => {
    const { id: peerId, multiaddrs } = event.detail
    console.log('🔍 Peer discovered:', peerId.toString(), 'Addresses:', multiaddrs.map(ma => ma.toString()))
    console.log("server.services.pubsub.peers", server.services.pubsub.peers)
    server.services.pubsub.publish('orbitdb-address', Buffer.from(JSON.stringify({
      peerId: peerId.toString(),
      dbAddress: 'test-address',
      timestamp: new Date().toISOString()
    })))
})



server.addEventListener('peer:connect', async event => {
  const { remotePeer, remoteAddr } = event.detail
  // console.log("remotePeer",remotePeer)
  // console.log("remoteAddr",remoteAddr)
  if(!remotePeer) return;

  const peerId = remotePeer.toString()
  const peerIdShort = `${peerId.slice(0, 8)}...`
  const addr = remoteAddr?.toString() || 'unknown'
  
  // Determine transport type from address
  let transport = 'unknown'
  if (addr.includes('/ws')) transport = 'websocket'
  else if (addr.includes('/webrtc')) transport = 'webrtc'
  else if (addr.includes('/tcp') && !addr.includes('/ws')) transport = 'tcp'
  else if (addr.includes('/p2p-circuit')) transport = 'circuit-relay'
  
  // Store connection details
  connectedPeers.set(peerId, {
    peerId,
    peerIdShort,
    address: addr,
    transport,
    connectedAt: new Date().toISOString(),
    connectionCount: (connectedPeers.get(peerId)?.connectionCount || 0) + 1
  })
  
  console.log(`🤝 [PEER CONNECT] ${peerIdShort} via ${transport.toUpperCase()} | Address: ${addr} | Total Peers: ${connectedPeers.size}`)
  
  // Log to structured format for monitoring
  console.log(JSON.stringify({
    event: 'peer_connect',
    timestamp: new Date().toISOString(),
    peerId: peerIdShort,
    fullPeerId: peerId,
    address: addr,
    transport,
    totalConnectedPeers: connectedPeers.size
  }))
})

server.addEventListener('peer:disconnect', async event => {
  const { remotePeer } = event.detail
  console.log("peer:disconnect",event.detail)
  if(!remotePeer) return
  const peerId = remotePeer.toString()
  const connectionInfo = connectedPeers.get(peerId)
  const peerIdShort = connectionInfo?.peerIdShort || `${peerId.slice(0, 8)}...`
  
  // Calculate connection duration
  let duration = 'unknown'
  if (connectionInfo?.connectedAt) {
    const connectedTime = new Date(connectionInfo.connectedAt)
    const durationMs = Date.now() - connectedTime.getTime()
    duration = `${Math.round(durationMs / 1000)}s`
  }
  
  // Remove from tracking
  connectedPeers.delete(peerId)
  
  console.log(`👋 [PEER DISCONNECT] ${peerIdShort} | Duration: ${duration} | Transport: ${connectionInfo?.transport || 'unknown'} | Remaining Peers: ${connectedPeers.size}`)
  
  // Log to structured format for monitoring
  console.log(JSON.stringify({
    event: 'peer_disconnect',
    timestamp: new Date().toISOString(),
    peerId: peerIdShort,
    fullPeerId: peerId,
    duration,
    transport: connectionInfo?.transport,
    totalConnectedPeers: connectedPeers.size
  }))
  
  try {
    await server.peerStore.delete(event.detail)
  } catch (error) {
    console.warn(`⚠️ Failed to delete peer from store: ${error.message}`)
  }
})

console.log('Relay PeerId:', server.peerId.toString())
console.log('Relay multiaddrs:')
server.getMultiaddrs().forEach(ma => console.log(' ', ma.toString()))

// Create HTTP server for multiaddr discovery
const app = express()
const httpPort = process.env.HTTP_PORT || 3000

// Enable CORS for browser access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  next()
})

// Endpoint to get current multiaddrs
app.get('/multiaddrs', (req, res) => {
  const multiaddrs = server.getMultiaddrs().map(ma => ma.toString())
  const webrtcAddrs = multiaddrs.filter(ma => ma.includes('webrtc'))
  
  res.json({
    peerId: server.peerId.toString(),
    all: multiaddrs,
    webrtc: webrtcAddrs,
    timestamp: new Date().toISOString()
  })
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', peerId: server.peerId.toString() })
})

// Connected peers endpoint
app.get('/peers', (req, res) => {
  const peers = Array.from(connectedPeers.values()).map(peer => ({
    peerId: peer.peerIdShort,
    transport: peer.transport,
    connectedAt: peer.connectedAt,
    connectionCount: peer.connectionCount,
    duration: Math.round((Date.now() - new Date(peer.connectedAt).getTime()) / 1000) + 's'
  }))
  
  res.json({
    totalConnected: connectedPeers.size,
    peers,
    timestamp: new Date().toISOString()
  })
})

// Test pubsub endpoint
app.post('/test-pubsub', express.json(), async (req, res) => {
  const testMsg = req.body?.msg || JSON.stringify({
    peerId: 'test-peer',
    dbAddress: 'test-address',
    timestamp: new Date().toISOString()
  });
  try {
    await server.services.pubsub.publish(
      'orbitdb-address',
      Buffer.from(typeof testMsg === 'string' ? testMsg : JSON.stringify(testMsg))
    );
    res.json({ success: true, sent: testMsg });
    console.log('[relay] Sent test pubsub message:', testMsg);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
    console.error('[relay] Failed to send test pubsub message:', e);
  }
});

app.listen(httpPort, () => {
  console.log(`\nHTTP discovery server running on port ${httpPort}`)
  console.log(`WebRTC multiaddrs available at: http://localhost:${httpPort}/multiaddrs`)
  console.log(`Health check at: http://localhost:${httpPort}/health`)
  console.log(`Connected peers at: http://localhost:${httpPort}/peers`)
  console.log(`Relay PeerId: ${server.peerId.toString()}`)
})

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down relay server...')
  await server.stop()
  process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
