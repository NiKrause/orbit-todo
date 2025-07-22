import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'

async function testEmitSelfStandalone() {
  console.log('🧪 Testing emitSelf in standalone mode...')
  
  // Create a simple libp2p node with gossipsub
  const node = await createLibp2p({
    addresses: {
      listen: []  // No listening addresses needed for this test
    },
    transports: [],  // No transports needed for local testing
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      pubsub: gossipsub({
        emitSelf: true,  // Key setting we're testing
        allowPublishToZeroTopicPeers: true,  // Allow publishing even with no peers
        canRelayMessage: true
      })
    }
  })

  console.log('✅ Created standalone node:', node.peerId.toString())

  let messageCount = 0
  const receivedMessages = []

  // Set up message listener
  const messageHandler = (msg) => {
    messageCount++
    const raw = new TextDecoder().decode(msg.data)
    
    console.log(`📩 [${messageCount}] Message received:`)
    console.log(`  - From: ${msg.from}`)
    console.log(`  - Topic: ${msg.topic}`)
    console.log(`  - Data: ${raw}`)
    console.log(`  - Is self-message: ${msg.from === node.peerId.toString()}`)
    
    receivedMessages.push({
      from: msg.from,
      topic: msg.topic,
      data: raw,
      isSelf: msg.from === node.peerId.toString()
    })
  }

  // Subscribe to test topic
  console.log('📡 Subscribing to test-topic...')
  node.services.pubsub.subscribe('test-topic', messageHandler)

  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 100))

  // Publish test messages
  console.log('📤 Publishing test messages...')
  
  for (let i = 1; i <= 5; i++) {
    const message = JSON.stringify({
      test: i,
      timestamp: new Date().toISOString(),
      peerId: node.peerId.toString()
    })
    
    console.log(`📤 Publishing message ${i}...`)
    await node.services.pubsub.publish('test-topic', Buffer.from(message))
    
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Wait for any async message delivery
  console.log('⏳ Waiting for message delivery...')
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Summary
  console.log('\n📊 RESULTS SUMMARY:')
  console.log(`  - Total messages sent: 5`)
  console.log(`  - Total messages received: ${messageCount}`)
  console.log(`  - Self-messages received: ${receivedMessages.filter(m => m.isSelf).length}`)
  console.log(`  - Other-messages received: ${receivedMessages.filter(m => !m.isSelf).length}`)

  if (messageCount === 0) {
    console.log('❌ PROBLEM: No messages received at all!')
    console.log('   This suggests emitSelf is not working or messages are being filtered.')
  } else if (receivedMessages.filter(m => m.isSelf).length === 5) {
    console.log('✅ SUCCESS: All self-messages received!')
  } else {
    console.log('⚠️  PARTIAL: Some messages received, but not all self-messages.')
  }

  // Detailed diagnostics
  console.log('\n🔍 DETAILED DIAGNOSTICS:')
  console.log(`  - Node PeerId: ${node.peerId.toString()}`)
  console.log(`  - Subscriptions: ${Array.from(node.services.pubsub.subscriptions)}`)
  console.log(`  - Connected peers: ${node.getConnections().length}`)
  
  // Try to access gossipsub internals for debugging
  try {
    const pubsub = node.services.pubsub
    console.log(`  - Gossipsub topics: ${Array.from(pubsub.topics?.keys?.() || [])}`)
    if (pubsub.mesh) {
      console.log(`  - Mesh topics: ${Array.from(pubsub.mesh.keys())}`)
    }
    if (pubsub.fanout) {
      console.log(`  - Fanout topics: ${Array.from(pubsub.fanout.keys())}`)
    }
  } catch (e) {
    console.log(`  - Could not access gossipsub internals: ${e.message}`)
  }

  await node.stop()
  console.log('✅ Test complete')
}

console.log('🧪 SIMPLE EMITSELF TEST')
console.log('This test creates a standalone libp2p node and tests if emitSelf works')
console.log('Expected: We should receive our own published messages')
console.log('=' .repeat(60))

testEmitSelfStandalone().catch(console.error)
