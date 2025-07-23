import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
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
import { LevelDatastore } from 'datastore-level'
import { LevelBlockstore } from 'blockstore-level'

import { peerDiscovery } from './peer-discovery.js'

const browser = typeof window !== 'undefined'

// Bootstrap relay addresses
const RELAY_BOOTSTRAP_ADDR_DEV = '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE'
const RELAY_BOOTSTRAP_ADDR = '/dns4/91-99-67-170.k51qzi5uqu5dl6dk0zoaocksijnghdrkxir5m4yfcodish4df6re6v3wbl6njf.libp2p.direct/tcp/4002/wss/p2p/12D3KooWPJYEZSwfmRL9SHehYAeQKEbCvzFu7vtKWb6jQfMSMb8W'

// Extract bootstrap peer ID for debugging
const BOOTSTRAP_PEER_ID = RELAY_BOOTSTRAP_ADDR.split('/').pop()

/**
 * Network state management
 */
let libp2p = null
let helia = null

/**
 * Create and configure LibP2P node
 */
async function createLibP2PNode() {
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

  console.log('🌐 Creating libp2p node...')
  const startTime = Date.now()
  
  const node = await createLibp2p({
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
  return node
}

/**
 * Create Helia instance with LibP2P node
 */
async function createHeliaNode(libp2pNode) {
  console.log('📁 Creating Helia instance...')
  const heliaStartTime = Date.now()
  
  let blockstore = new LevelBlockstore('./helia-blocks')
  let datastore = new LevelDatastore('./helia-data')
  
  const heliaNode = await createHelia({
    libp2p: libp2pNode,
    blockstore,
    datastore
  })
  
  console.log(`✅ Helia created in ${Date.now() - heliaStartTime}ms`)
  return heliaNode
}

/**
 * Initialize P2P network with timeout
 */
async function initializeP2PWithTimeout() {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('P2P initialization timed out after 30 seconds')), 30000)
  )
  
  const initPromise = async () => {
    console.log('🚀 Starting P2P initialization...')
    const startTime = Date.now()
    
    // Create LibP2P node
    libp2p = await createLibP2PNode()
    
    // Set up peer discovery event handlers
    peerDiscovery.setupHandlers(libp2p)
    
    // Add debug logging for bootstrap and relay events
    console.log('🔍 Setting up additional debug event listeners...')
    console.log('🎯 Bootstrap peer ID to watch for:', BOOTSTRAP_PEER_ID)
    
    // Debug pubsub peer discovery
    console.log('📡 Setting up pubsub peer discovery debugging...')
    const pubsubService = libp2p.services.pubsub
    
    // Subscribe to the peer discovery topic manually to ensure it's working
    const discoveryTopic = 'todo._peer-discovery._p2p._pubsub'
    try {
      await pubsubService.subscribe(discoveryTopic)
      console.log('✅ Successfully subscribed to peer discovery topic:', discoveryTopic)
      
      // Listen for messages on the discovery topic and manually dial peers
      pubsubService.addEventListener('message', (event) => {
        const { topic, data, from } = event.detail
        if (topic === discoveryTopic) {
          console.log('📢 Received peer discovery message on topic:', topic, 'from:', from.toString())
          const messageText = new TextDecoder().decode(data)
          console.log('📢 Message data:', messageText)
          
          // Manually dial the peer if we're not already connected
          const fromPeerIdStr = from.toString()
          if (fromPeerIdStr !== libp2p.peerId.toString()) {
            const existingConnection = libp2p.getConnections().find(conn => 
              conn.remotePeer.toString() === fromPeerIdStr
            )
            
            if (!existingConnection) {
              console.log('📞 Manually dialing peer from pubsub:', fromPeerIdStr.slice(0, 8) + '...')
              
              libp2p.dial(from).then(connection => {
                if (connection) {
                  console.log('✅ Successfully connected to peer from pubsub:', fromPeerIdStr.slice(0, 8) + '...')
                }
              }).catch(dialError => {
                console.warn('❌ Failed to dial peer from pubsub:', dialError.message)
              })
            }
          }
        }
      })
      // Log current subscriptions
      console.log('📊 Current pubsub subscriptions:', pubsubService.getSubscribers(discoveryTopic))
      
      // Log all pubsub events for debugging
      pubsubService.addEventListener('subscription-change', (event) => {
        const { peerId, subscriptions } = event.detail
        console.log('🔄 Subscription change from peer:', peerId.toString())
        subscriptions.forEach(sub => {
          if (sub.topic === discoveryTopic) {
            console.log(`  - ${sub.subscribe ? 'SUBSCRIBED' : 'UNSUBSCRIBED'} to discovery topic`)
          }
        })
      })
      
      // Periodically try to publish to the discovery topic to announce ourselves
      setInterval(async () => {
        try {
          const message = JSON.stringify({
            type: 'peer-announce',
            peerId: libp2p.peerId.toString(),
            timestamp: Date.now(),
            multiaddrs: libp2p.getMultiaddrs().map(ma => ma.toString())
          })
          
          await pubsubService.publish(discoveryTopic, new TextEncoder().encode(message))
          console.log('📡 Published peer announcement to discovery topic')
        } catch (error) {
          console.warn('⚠️ Failed to publish peer announcement:', error.message)
        }
      }, 10000) // Every 10 seconds
      
    } catch (error) {
      console.error('❌ Failed to subscribe to peer discovery topic:', error)
    }
    
    // Log when we connect to bootstrap peers
    libp2p.addEventListener('peer:connect', (event) => {
      const peerId = event.detail?.remotePeer?.toString()
      if (peerId === BOOTSTRAP_PEER_ID) {
        console.log('🎯 Connected to bootstrap relay server!')
      }
    })
    
    // Log relay discovery events
    libp2p.addEventListener('peer:discovery', (event) => {
      const { id: peerId } = event.detail
      const peerIdStr = peerId?.toString()
      if (peerIdStr === BOOTSTRAP_PEER_ID) {
        console.log('🎯 Discovered bootstrap relay server via peer discovery!')
      }
    })
    
    // Create Helia instance
    helia = await createHeliaNode(libp2p)
    
    console.log(`🎉 P2P initialized successfully in ${Date.now() - startTime}ms! PeerId:`, libp2p.peerId.toString())
    
    return libp2p
  }
  
  return Promise.race([initPromise(), timeout])
}

/**
 * Initialize P2P network
 */
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
    
    throw error
  }
}

/**
 * Get LibP2P instance
 */
export function getLibP2P() {
  return libp2p
}

/**
 * Get Helia instance
 */
export function getHelia() {
  return helia
}

/**
 * Stop all network components
 */
export async function stopP2P() {
  console.log('🛑 Stopping P2P network...')
  
  try {
    if (helia) {
      await helia.stop()
      helia = null
    }
    
    if (libp2p) {
      await libp2p.stop()
      libp2p = null
    }
    
    console.log('✅ P2P network stopped')
  } catch (error) {
    console.error('❌ Error stopping P2P network:', error)
    throw error
  }
}

/**
 * Get current network status
 */
export function getNetworkStatus() {
  return {
    libp2pActive: libp2p !== null,
    heliaActive: helia !== null,
    peerId: libp2p?.peerId?.toString() || null,
    connections: libp2p ? libp2p.getConnections().length : 0
  }
}
