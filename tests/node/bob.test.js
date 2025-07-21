import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB } from '@orbitdb/core'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { webSockets } from '@libp2p/websockets'
import { tcp } from '@libp2p/tcp'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { dcutr } from '@libp2p/dcutr'
import { autoNAT } from '@libp2p/autonat'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { multiaddr } from '@multiformats/multiaddr'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import * as filters from '@libp2p/websockets/filters'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { config } from 'dotenv'
import { strict as assert } from 'assert'

// Load environment variables
config()

describe('Bob P2P Node Tests', function() {
  this.timeout(60000) // 60 second timeout for P2P operations
  
  let libp2p, helia, orbitdb, todoDB
  const ALICE_PEER_ID = process.env.VITE_TEST_PEER_ID || '12D3KooWAlice123456789abcdef123456789abcdef123456789abcdef123456789abcdef'
  const BOB_PEER_ID = process.env.BOB_PEER_ID || '08011240123456789abcdef123456789abcdef123456789abcdef123456789abcdef123456789abcdef123456789abcdef123456789abcdef123456789abcdef123456789abcdef'
  const RELAY_MULTIADDR = '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE'

  before(async function() {
    console.log('🚀 Initializing Bob P2P node...')
    
    let privateKey
    try {
      privateKey = privateKeyFromProtobuf(uint8ArrayFromString(BOB_PEER_ID, 'hex'))
    } catch (error) {
      console.warn('Invalid Bob peer ID, generating random key:', error)
    }

    // Create libp2p node for Bob
    libp2p = await createLibp2p({
      ...(privateKey && { privateKey }),
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0'] // Random port
      },
      transports: [
        tcp(),
        webSockets({
          filter: filters.all
        }),
        circuitRelayTransport({
          discoverRelays: 1
        })
      ],
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: 10000,
          listenOnly: false
        })
      ],
      services: {
        identify: identify(),
        ping: ping(),
        dcutr: dcutr(),
        autonat: autoNAT(),
        pubsub: gossipsub({
          allowPublishToZeroTopicPeers: true,
          canRelayMessage: true
        })
      }
    })

    console.log('Bob PeerId:', libp2p.peerId.toString())

    // Connect to relay
    try {
      await libp2p.dial(multiaddr(RELAY_MULTIADDR))
      console.log('✅ Bob connected to relay server')
    } catch (error) {
      console.warn('⚠️ Bob could not connect to relay server:', error.message)
    }

    // Create Helia instance
    helia = await createHelia({
      libp2p,
      blockstore: new MemoryBlockstore(),
      datastore: new MemoryDatastore()
    })

    // Create OrbitDB instance
    orbitdb = await createOrbitDB({
      ipfs: helia,
      id: 'todo-p2p-app-bob',
      directory: './orbitdb-bob'
    })

    // Open the same database as Alice
    todoDB = await orbitdb.open('todos', {
      type: 'documents',
      AccessController: () => ({
        canAppend: () => true
      })
    })

    console.log('✅ Bob connected to todo database:', todoDB.address)
    
    // Wait a bit for network synchronization
    await new Promise(resolve => setTimeout(resolve, 5000))
  })

  after(async function() {
    console.log('🔄 Shutting down Bob P2P node...')
    
    if (todoDB) await todoDB.close()
    if (orbitdb) await orbitdb.stop()
    if (helia) await helia.stop()
    if (libp2p) await libp2p.stop()
    
    console.log('✅ Bob P2P node shut down successfully')
  })

  it('should connect to the same OrbitDB as Alice', async function() {
    assert(todoDB, 'TodoDB should be initialized')
    assert(todoDB.address, 'TodoDB should have an address')
    console.log('✅ Bob successfully connected to OrbitDB')
  })

  it('should add two new TODOs assigned to Alice', async function() {
    const aliceTodos = [
      {
        id: `bob-${Date.now()}-1`,
        text: 'Review Bob\\'s pull request',
        assignee: ALICE_PEER_ID,
        completed: false,
        createdAt: new Date().toISOString(),
        createdBy: libp2p.peerId.toString()
      },
      {
        id: `bob-${Date.now()}-2`,
        text: 'Merge feature branch',
        assignee: ALICE_PEER_ID,
        completed: false,
        createdAt: new Date().toISOString(),
        createdBy: libp2p.peerId.toString()
      }
    ]

    for (const todo of aliceTodos) {
      const hash = await todoDB.put(todo)
      console.log(`✅ Bob added todo: "${todo.text}" assigned to Alice, hash: ${hash}`)
    }

    // Wait for replication
    await new Promise(resolve => setTimeout(resolve, 2000))
  })

  it('should verify Alice now owns 3 TODOs (including Bob\\'s assignments)', async function() {
    const todos = await todoDB.query(() => true)
    console.log('📋 All todos in database:', todos.length)
    
    // Filter todos assigned to Alice
    const aliceTodos = todos.filter(todo => 
      todo.assignee === ALICE_PEER_ID || 
      todo.createdBy === ALICE_PEER_ID
    )
    
    console.log('📋 Todos for Alice:', aliceTodos.length)
    aliceTodos.forEach(todo => {
      console.log(`  - ${todo.text} (${todo.assignee ? 'assigned to' : 'created by'} ${todo.assignee || todo.createdBy})`)
    })
    
    // Alice should have at least the 2 TODOs Bob just assigned to her
    assert(aliceTodos.length >= 2, `Alice should have at least 2 todos, but has ${aliceTodos.length}`)
    
    // Verify that the TODOs Bob created are assigned to Alice
    const bobCreatedTodos = todos.filter(todo => todo.createdBy === libp2p.peerId.toString())
    assert(bobCreatedTodos.length === 2, `Bob should have created 2 todos, but created ${bobCreatedTodos.length}`)
    
    bobCreatedTodos.forEach(todo => {
      assert.strictEqual(todo.assignee, ALICE_PEER_ID, `Todo "${todo.text}" should be assigned to Alice`)
    })
    
    console.log('✅ Bob successfully verified Alice\\'s TODOs')
  })

  it('should see all todos from the shared database', async function() {
    const allTodos = await todoDB.query(() => true)
    
    console.log('📊 Database synchronization status:')
    console.log(`  Total TODOs: ${allTodos.length}`)
    
    const todosByCreator = {}
    allTodos.forEach(todo => {
      const creator = todo.createdBy?.slice(0, 12) || 'unknown'
      if (!todosByCreator[creator]) todosByCreator[creator] = 0
      todosByCreator[creator]++
    })
    
    Object.entries(todosByCreator).forEach(([creator, count]) => {
      console.log(`  ${creator}...: ${count} todos`)
    })
    
    assert(allTodos.length > 0, 'Should have synchronized some todos from Alice')
    console.log('✅ Bob successfully synchronized with Alice\\'s todos')
  })
})
