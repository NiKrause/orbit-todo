import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'
import * as filters from '@libp2p/websockets/filters'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { tcp } from '@libp2p/tcp'
import { ping } from '@libp2p/ping'
import { dcutr } from '@libp2p/dcutr'
import { autoNAT } from '@libp2p/autonat'
import { keychain } from '@libp2p/keychain'
import { autoTLS } from '@ipshipyard/libp2p-auto-tls'
import { config } from 'dotenv'
import express from 'express'
import { tls } from '@libp2p/tls'
import { uPnPNAT } from '@libp2p/upnp-nat'
import { prometheusMetrics } from '@libp2p/prometheus-metrics'
import { initializeStorage, closeStorage } from './services/storage.js'

// Load environment variables
config()

console.log('🚀 Starting enhanced relay server...')

// Determine if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
const fixedPrivateKey = process.env.RELAY_PRIV_KEY

// Initialize storage with persistent datastore, blockstore, and private key management
const storage = await initializeStorage(
  process.env.DATASTORE_PATH || './relay-datastore',
  isDevelopment,
  fixedPrivateKey
)
const { datastore, blockstore, privateKey } = storage

// Enhanced port configuration
const wsPort = process.env.RELAY_WS_PORT || 4001
const tcpPort = process.env.RELAY_TCP_PORT || 4002
const webrtcPort = process.env.RELAY_WEBRTC_PORT || 4003
const webrtcDirectPort = process.env.RELAY_WEBRTC_DIRECT_PORT || 4006
const httpPort = process.env.HTTP_PORT || 3000

// Environment-aware announce addresses
const appendAnnounce = (
  process.env.NODE_ENV === 'development'
    ? process.env.VITE_APPEND_ANNOUNCE_DEV
    : process.env.VITE_APPEND_ANNOUNCE
) || ''

const appendAnnounceArray = appendAnnounce
  .split(',')
  .map(addr => addr.trim())
  .filter(Boolean)

// AutoTLS configuration check
const autoTLSEnabled = !process.env.DISABLE_AUTO_TLS && process.env.NODE_ENV === 'production'
const stagingMode = process.env.STAGING === 'true'

console.log('🔧 Configuration:')
console.log(`  - WebSocket port: ${wsPort}`)
console.log(`  - TCP port: ${tcpPort}`)
console.log(`  - WebRTC port: ${webrtcPort}`)
console.log(`  - WebRTC Direct port: ${webrtcDirectPort}`)
console.log(`  - HTTP port: ${httpPort}`)
console.log(`  - Datastore: ${process.env.DATASTORE_PATH || './relay-datastore'}`)
console.log(`  - Environment: ${process.env.NODE_ENV || 'development'}`)
if (appendAnnounceArray.length > 0) {
  console.log(`  - Additional announce addresses: ${appendAnnounceArray.join(', ')}`)
}
console.log(`  - AutoTLS: ${autoTLSEnabled ? (stagingMode ? 'enabled (staging)' : 'enabled (production)') : 'disabled'}`)

const libp2pOptions = {
  // Include private key and datastore
  ...(privateKey && { privateKey }),
  datastore,
  metrics: prometheusMetrics(),
  addresses: {
    listen: [
      `/ip4/0.0.0.0/tcp/${tcpPort}`,              // Direct TCP
      `/ip4/0.0.0.0/tcp/${wsPort}/ws`,            // WebSocket for browsers
      `/ip4/0.0.0.0/udp/${webrtcPort}/webrtc`,              // WebRTC for NAT traversal
      `/ip4/0.0.0.0/udp/${webrtcDirectPort}/webrtc-direct`, // WebRTC Direct
      `/ip6/::/tcp/${tcpPort}`,                                 // IPv6 TCP
      `/ip6/::/tcp/${wsPort}/ws`,                               // IPv6 WebSocket
      `/ip6/::/udp/${webrtcPort}/webrtc`,                       // IPv6 WebRTC Direct
      `/ip6/::/udp/${webrtcDirectPort}/webrtc-direct`,          // IPv6 WebRTC Direct
      '/p2p-circuit'                             // Circuit relay
    ],
    // Enhanced announce addresses with environment-aware configuration
    ...(appendAnnounceArray.length > 0 && { appendAnnounce: appendAnnounceArray }),
  },
  transports: [
    tcp(),
    circuitRelayTransport({
      discoverRelays: 1
    }),
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
      interval: 5000, // Check every 5 seconds (more frequent than original)
      topics: ['todo._peer-discovery._p2p._pubsub'],
      listenOnly: false,
      emitSelf: true
    })
  ],
  connectionEncrypters: [tls(), noise()],
  connectionManager: {
    // Enhanced connection management from the reference
    inboundStreamProtocolNegotiationTimeout: 30000,
    inboundUpgradeTimeout: 30000,
    outboundStreamProtocolNegotiationTimeout: 30000,
    outboundUpgradeTimeout: 30000,
    maxConnections: 1000,
    maxIncomingPendingConnections: 100,
    maxPeerAddrsToDial: 100,
    dialTimeout: 30000
  },
  connectionGater: {
    denyDialMultiaddr: () => false
  },
  streamMuxers: [yamux()],
  services: {
    ping: ping(),
    autonat: autoNAT(),
    dcutr: dcutr(),
    identify: identify(),
    identifyPush: identifyPush(), // Add identify push service
    
    // Enhanced Kademlia DHT with better configuration
    aminoDHT: kadDHT({
      protocol: '/ipfs/kad/1.0.0',
      peerInfoMapper: removePrivateAddressesMapper
    }),
    
    // Enhanced gossipsub configuration
    pubsub: gossipsub({
      emitSelf: true,
      allowPublishToZeroTopicPeers: true,
      canRelayMessage: true,
      gossipIncoming: true,
      fallbackToFloodsub: true,
      floodPublish: true,
      // Disable peer scoring to avoid blocking during development
      scoreParams: {
        gossipThreshold: -Infinity,
        publishThreshold: -Infinity,
        graylistThreshold: -Infinity,
        acceptPXThreshold: 0,
        opportunisticGraftThreshold: 0
      },
      // Enhanced mesh maintenance
      heartbeatInterval: 1000
    }),
    
    // UPnP NAT traversal
    uPnPNAT: uPnPNAT(),
    
    // Enhanced circuit relay server configuration
    relay: circuitRelayServer({
      // Production-ready relay configuration based on reference
      hopTimeout: 30000, // 30 seconds
      reservations: {
        maxReservations: 1000, // Increased from 5000 to reasonable production limit
        reservationTtl: 2 * 60 * 60 * 1000, // 2 hours (matches reference)
        defaultDataLimit: BigInt(1024 * 1024 * 1024), // 1GB
        defaultDurationLimit: 2 * 60 * 1000 // 2 minutes
      }
    }),
    
    // Add keychain service for secure key management
    keychain: keychain(),
    
    // AutoTLS service for automatic SSL/TLS certificate management
    // Only enabled when not explicitly disabled and in production
    ...(!process.env.DISABLE_AUTO_TLS && process.env.NODE_ENV === 'production' && {
      autoTLS: autoTLS({
        autoConfirmAddress: true,
        // Use Let's Encrypt staging directory if STAGING is true
        ...(process.env.STAGING === 'true' && {
          acmeDirectory: 'https://acme-staging-v02.api.letsencrypt.org/directory'
        })
      })
    })
  }
}

// Use the options object
const server = await createLibp2p(libp2pOptions)

// Add the certificate:provision event listener here
const certificateHandler = () => {
  console.log('A TLS certificate was provisioned')

  const interval = setInterval(() => {
    const mas = server
      .getMultiaddrs()
      .filter(ma => ma.toString().includes('/wss/') && ma.toString().includes('/sni/'))
      .map(ma => ma.toString())

    if (mas.length > 0) {
      console.log('addresses:')
      console.log(mas.join('\n'))
      clearInterval(interval)
    }
  }, 1_000)
}
server.addEventListener('certificate:provision', certificateHandler)

// Datastore diagnostic function (from reference)
async function listDatastoreKeys() {
  try {
    const query = datastore.query({})
    let keyCount = 0
    for await (const entry of query) {
      try {
        const keyStr = entry.key.toString()
        keyCount++
        if (process.argv.includes('--verbose')) {
          console.log(`📋 Datastore key: ${keyStr}`)
        }
      } catch (err) {
        console.warn('⚠️ Invalid datastore entry:', err.message)
        // Auto-cleanup invalid keys
        if (entry && entry.key) {
          try {
            await datastore.delete(entry.key)
            console.log('🧹 Cleaned up invalid key:', entry.key.toString())
          } catch (deleteErr) {
            console.error('❌ Failed to delete invalid key:', deleteErr.message)
          }
        }
      }
    }
    console.log(`📊 Datastore contains ${keyCount} keys`)
  } catch (err) {
    console.warn('⚠️ Datastore diagnostic failed:', err.message)
  }
}

// Start the server
console.log('⏳ Starting libp2p node...')
await server.start()
console.log('✅ Libp2p node started successfully')

// Run datastore diagnostics
console.log('🔍 Running datastore diagnostics...')
await listDatastoreKeys()

// Enhanced peer tracking with more detailed metrics
let connectedPeers = new Map()
const peerStats = {
  totalConnections: 0,
  connectionsByTransport: {},
  peakConnections: 0
}

server.addEventListener('peer:discovery', async (event) => {
  const { id: peerId, multiaddrs } = event.detail
  console.log('🔍 Peer discovered:', peerId.toString().slice(0, 12) + '...', 
              'Addresses:', multiaddrs.length)
  
  if (process.argv.includes('--verbose')) {
    multiaddrs.forEach(addr => console.log(`    - ${addr.toString()}`))
  }
})

server.addEventListener('peer:connect', async event => {
  const { remotePeer, remoteAddr } = event.detail
  if (!remotePeer) return

  const peerId = remotePeer.toString()
  const peerIdShort = `${peerId.slice(0, 8)}...`
  const addr = remoteAddr?.toString() || 'unknown'
  
  // Enhanced transport detection
  let transport = 'unknown'
  if (addr.includes('/ws')) transport = 'websocket'
  else if (addr.includes('/webrtc-direct')) transport = 'webrtc-direct'
  else if (addr.includes('/webrtc')) transport = 'webrtc'
  else if (addr.includes('/tcp') && !addr.includes('/ws')) transport = 'tcp'
  else if (addr.includes('/p2p-circuit')) transport = 'circuit-relay'
  else if (addr.includes('/udp')) transport = 'udp'
  
  // Update statistics
  peerStats.totalConnections++
  peerStats.connectionsByTransport[transport] = (peerStats.connectionsByTransport[transport] || 0) + 1
  if (connectedPeers.size + 1 > peerStats.peakConnections) {
    peerStats.peakConnections = connectedPeers.size + 1
  }
  
  // Store enhanced connection details
  connectedPeers.set(peerId, {
    peerId,
    peerIdShort,
    address: addr,
    transport,
    connectedAt: new Date().toISOString(),
    connectionCount: (connectedPeers.get(peerId)?.connectionCount || 0) + 1
  })
  
  console.log(`🤝 [CONNECT] ${peerIdShort} via ${transport.toUpperCase()} | ` +
              `Total: ${connectedPeers.size} | Peak: ${peerStats.peakConnections}`)
  
  // Structured logging for monitoring
  if (process.env.STRUCTURED_LOGS === 'true') {
    console.log(JSON.stringify({
      event: 'peer_connect',
      timestamp: new Date().toISOString(),
      peerId: peerIdShort,
      fullPeerId: peerId,
      address: addr,
      transport,
      totalConnectedPeers: connectedPeers.size,
      peakConnections: peerStats.peakConnections
    }))
  }
})

server.addEventListener('peer:disconnect', async event => {
  const { remotePeer } = event.detail
  if (!remotePeer) return

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
  
  connectedPeers.delete(peerId)
  
  console.log(`👋 [DISCONNECT] ${peerIdShort} | Duration: ${duration} | ` +
              `Transport: ${connectionInfo?.transport || 'unknown'} | Remaining: ${connectedPeers.size}`)
  
  // Structured logging for monitoring
  if (process.env.STRUCTURED_LOGS === 'true') {
    console.log(JSON.stringify({
      event: 'peer_disconnect',
      timestamp: new Date().toISOString(),
      peerId: peerIdShort,
      fullPeerId: peerId,
      duration,
      transport: connectionInfo?.transport,
      totalConnectedPeers: connectedPeers.size
    }))
  }
})

// Enhanced logging
console.log('\n🎯 Relay Server Information:')
console.log('  Relay PeerId:', server.peerId.toString())
console.log('  Multiaddrs:')
server.getMultiaddrs().forEach(ma => console.log(`    ${ma.toString()}`))

// Create enhanced HTTP API server
const app = express()

// Enhanced CORS configuration
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
  next()
})

app.use(express.json())

// Enhanced multiaddrs endpoint with more information
app.get('/multiaddrs', (req, res) => {
  const multiaddrs = server.getMultiaddrs().map(ma => ma.toString())
  const webrtcAddrs = multiaddrs.filter(ma => ma.includes('webrtc'))
  const tcpAddrs = multiaddrs.filter(ma => ma.includes('/tcp/') && !ma.includes('/ws'))
  const wsAddrs = multiaddrs.filter(ma => ma.includes('/ws'))
  
  res.json({
    peerId: server.peerId.toString(),
    all: multiaddrs,
    byTransport: {
      webrtc: webrtcAddrs,
      tcp: tcpAddrs,
      websocket: wsAddrs
    },
    timestamp: new Date().toISOString()
  })
})

// Enhanced health check with system information
app.get('/health', (req, res) => {
  const connections = server.getConnections()
  const uptime = process.uptime()
  
  res.json({
    status: 'ok',
    peerId: server.peerId.toString(),
    uptime: Math.round(uptime),
    connections: {
      active: connections.length,
      peak: peerStats.peakConnections,
      total: peerStats.totalConnections
    },
    transports: peerStats.connectionsByTransport,
    multiaddrs: server.getMultiaddrs().length,
    timestamp: new Date().toISOString()
  })
})

// Enhanced peers endpoint with detailed statistics
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
    peakConnections: peerStats.peakConnections,
    totalConnectionsEver: peerStats.totalConnections,
    transportStats: peerStats.connectionsByTransport,
    peers,
    timestamp: new Date().toISOString()
  })
})

// Enhanced metrics endpoint (Prometheus-compatible if enabled)
app.get('/metrics', (req, res) => {
  if (server.metrics) {
    res.set('Content-Type', 'text/plain')
    res.send(server.metrics.toString())
  } else {
    res.json({ error: 'Metrics not enabled' })
  }
})

// Test pubsub endpoint (existing)
app.post('/test-pubsub', express.json(), async (req, res) => {
  const testMsg = req.body?.msg || JSON.stringify({
    peerId: 'test-peer',
    dbAddress: 'test-address',
    timestamp: new Date().toISOString()
  })
  
  try {
    await server.services.pubsub.publish(
      'orbitdb-address',
      Buffer.from(typeof testMsg === 'string' ? testMsg : JSON.stringify(testMsg))
    )
    res.json({ success: true, sent: testMsg })
    console.log('[relay] Sent test pubsub message:', testMsg)
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
    console.error('[relay] Failed to send test pubsub message:', e)
  }
})

// Start HTTP server
app.listen(httpPort, () => {
  console.log(`\n🌐 HTTP API Server:`)
  console.log(`  - Running on port: ${httpPort}`)
  console.log(`  - Multiaddrs: http://localhost:${httpPort}/multiaddrs`)
  console.log(`  - Health check: http://localhost:${httpPort}/health`)
  console.log(`  - Connected peers: http://localhost:${httpPort}/peers`)
  console.log(`  - Metrics: http://localhost:${httpPort}/metrics`)
  console.log(`  - Test pubsub: POST http://localhost:${httpPort}/test-pubsub`)
  
  console.log(`\n✨ Enhanced Relay Server Ready!`)
  console.log(`   Peer ID: ${server.peerId.toString()}`)
  console.log(`   Use --verbose flag for detailed logging`)
  console.log(`   Use STRUCTURED_LOGS=true for JSON logging`)
})

// Enhanced graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)
  
  try {
    console.log('⏳ Closing HTTP server...')
    
    console.log('⏳ Stopping libp2p node...')
    await server.stop()
    
    console.log('⏳ Closing storage...')
    await closeStorage(storage)
    
    console.log('✅ Graceful shutdown completed')
  } catch (error) {
    console.error('❌ Error during shutdown:', error)
  }
  
  process.exit(0)
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

// Periodic status logging (every 5 minutes)
setInterval(() => {
  console.log(`📊 Status: ${connectedPeers.size} peers connected, ` +
              `${peerStats.totalConnections} total connections, ` +
              `${Math.round(process.uptime())}s uptime`)
}, 5 * 60 * 1000)
