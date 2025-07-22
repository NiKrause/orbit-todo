import { createLibp2p } from 'libp2p'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import { multiaddr } from '@multiformats/multiaddr'
import * as filters from '@libp2p/websockets/filters'
import { ping } from '@libp2p/ping'

// Relay address - Make sure your relay is running first
const RELAY_ADDR = '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE'

async function createNode() {
  console.log('🚀 Creating libp2p node...')
  
  const libp2p = await createLibp2p({
    addresses: {
      listen: ['/p2p-circuit','/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE']
    },
    transports: [
      webSockets({
        filter: filters.all
      }),
      circuitRelayTransport({
        discoverRelays: 1
      })
    ],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping(),
      pubsub: gossipsub({
        emitSelf: true,  // This is key for seeing our own messages
        allowPublishToZeroTopicPeers: true,
        canRelayMessage: true,
        gossipIncoming: true,
        fallbackToFloodsub: true,
        floodPublish: true,
        // Disable peer scoring to avoid any blocking
        scoreParams: {
          gossipThreshold: -Infinity,
          publishThreshold: -Infinity,
          graylistThreshold: -Infinity,
          acceptPXThreshold: 0,
          opportunisticGraftThreshold: 0
        },
        // Enable direct peers for testing
        directPeers: [],
        // Ensure mesh maintenance doesn't interfere
        heartbeatInterval: 1000
      })
    }
  })

  console.log('✅ Node created with PeerId:', libp2p.peerId.toString())
  return libp2p
}

async function testPubsubVisibility() {
  const node = await createNode()

  try {
    // Connect to relay
    console.log('🔗 Connecting to relay...')
    await node.dial(multiaddr(RELAY_ADDR))
    console.log('✅ Connected to relay')

    // Set up message listener BEFORE subscribing
    let messageCount = 0
    const messageHandler = (msg) => {
      messageCount++
      try {
        const raw = new TextDecoder().decode(msg.data)
        console.log(`📩 [Message ${messageCount}] Received:`, raw)
        
        // Check if this is our own message
        if (msg.from === node.peerId.toString()) {
          console.log('🎯 [SELF-MESSAGE] This is our own message!')
        } else {
          console.log('👤 [OTHER-MESSAGE] From peer:', msg.from)
        }
        
        console.log('📊 Message details:', {
          from: msg.from,
          topic: msg.topic,
          sequenceNumber: msg.sequenceNumber,
          dataLength: msg.data.length
        })
      } catch (e) {
        console.warn('❌ Failed to decode message:', e)
      }
    }

    // Subscribe to the orbitdb-address topic
    console.log('📡 Subscribing to orbitdb-address topic...')
    node.services.pubsub.subscribe('orbitdb-address', messageHandler)
    
    // Add detailed diagnostics
    console.log('🔍 Gossipsub diagnostic info:')
    console.log('  - emitSelf enabled:', true)
    console.log('  - allowPublishToZeroTopicPeers:', true)
    console.log('  - canRelayMessage:', true)
    
    // Wait a moment for subscription to propagate
    console.log('⏳ Waiting for subscription to propagate...')
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Check initial state
    console.log('🔍 Initial state check:')
    const initialSubscriptions = node.services.pubsub.subscriptions
    const initialPeers = node.services.pubsub.peers
    console.log('  - Subscriptions:', Array.from(initialSubscriptions))
    console.log('  - Pubsub peers:', Array.from(initialPeers))
    console.log('  - Connected peers:', node.getConnections().length)
    
    // Check mesh status for our topic
    try {
      const meshPeers = node.services.pubsub.getMeshPeers('orbitdb-address')
      console.log('  - Mesh peers for orbitdb-address:', meshPeers)
    } catch (e) {
      console.log('  - No mesh peers available yet (expected for single node)')  
    }

    // Test publishing our own message
    console.log('📤 Publishing test message...')
    const testMessage = JSON.stringify({
      peerId: node.peerId.toString(),
      dbAddress: '/orbitdb/test-address',
      timestamp: new Date().toISOString(),
      test: true
    })

    await node.services.pubsub.publish('orbitdb-address', Buffer.from(testMessage))
    console.log('✅ Test message published')

    // Wait to see if we receive our own message
    console.log('⏳ Waiting to see if we receive our own message...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Publish a few more messages to test
    for (let i = 1; i <= 3; i++) {
      console.log(`📤 Publishing message ${i}...`)
      const msg = JSON.stringify({
        peerId: node.peerId.toString(),
        dbAddress: `/orbitdb/test-address-${i}`,
        timestamp: new Date().toISOString(),
        messageNumber: i
      })
      
      await node.services.pubsub.publish('orbitdb-address', Buffer.from(msg))
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    // Wait a bit more
    console.log('⏳ Waiting for any additional messages...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    console.log(`📊 Total messages received: ${messageCount}`)
    
    // Check subscription status
    const subscriptions = node.services.pubsub.subscriptions
    console.log('📋 Current subscriptions:', Array.from(subscriptions))
    
    const peers = node.services.pubsub.peers
    console.log('👥 Pubsub peers:', Array.from(peers))

  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    console.log('🛑 Stopping node...')
    await node.stop()
    console.log('✅ Node stopped')
  }
}

console.log('🧪 Testing pubsub self-message visibility...')
console.log('Make sure your relay server is running first!')
console.log('Expected behavior: We should see our own messages when emitSelf: true')
console.log('=' .repeat(60))

testPubsubVisibility().catch(console.error)
