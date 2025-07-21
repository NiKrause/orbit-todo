import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
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
import { bootstrap } from '@libp2p/bootstrap'
import { webRTC } from '@libp2p/webrtc'
import { multiaddr } from '@multiformats/multiaddr'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import * as filters from '@libp2p/websockets/filters'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { config } from 'dotenv'
import { strict as assert } from 'assert'
import { rm } from 'fs/promises'
import { readdir } from 'fs/promises'
import { existsSync } from 'fs'

// Load environment variables
config()

describe('Bob Manual Verification Test', function() {
  this.timeout(0) // Disable timeout to wait for manual verification

  let libp2p, helia, orbitdb, todoDB
  const ALICE_PEER_ID = process.env.VITE_TEST_PEER_ID || '12D3KooWAlice123456789abcdef123456789abcdef123456789abcdef123456789abcdef'
  const BOB_PEER_ID = process.env.BOB_PEER_ID // Let it be undefined if not set properly
  const RELAY_MULTIADDR = '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE'

  before(async function() {
    console.log('🧹 Cleaning up all OrbitDB directories...')
    
    // Clean up any existing OrbitDB directories
    try {
      const files = await readdir('.')
      const orbitdbDirs = files.filter(file => file.startsWith('orbitdb-'))
      
      for (const dir of orbitdbDirs) {
        if (existsSync(dir)) {
          const stat = await (await import('fs/promises')).stat(dir).catch(() => null)
          if (stat && stat.isDirectory()) {
            await rm(dir, { recursive: true, force: true })
            console.log(`✅ Cleaned up ${dir}`)
          }
        }
      }
      
      if (orbitdbDirs.length === 0) {
        console.log('ℹ️ No OrbitDB directories found to clean')
      }
    } catch (error) {
      console.warn('⚠️ Could not clean OrbitDB directories:', error.message)
    }
    
    console.log('🚀 Initializing Bob P2P node for manual verification...')

    let privateKey
    if (BOB_PEER_ID) {
      try {
        privateKey = privateKeyFromProtobuf(uint8ArrayFromString(BOB_PEER_ID, 'hex'))
        console.log('✅ Using provided Bob peer ID')
      } catch (error) {
        console.warn('Invalid Bob peer ID, generating random key:', error.message)
      }
    } else {
      console.log('🔑 No BOB_PEER_ID provided, generating random key')
    }

    // Create libp2p node for Bob
    libp2p = await createLibp2p({
      ...(privateKey && { privateKey }),
      addresses: {
        listen: [
          '/ip4/0.0.0.0/tcp/0',
          '/webrtc',
          '/ws'
        ]
      },
      transports: [
        tcp(),
        webSockets({
          filter: filters.all
        }),
        webRTC(), // <-- Add WebRTC transport
        circuitRelayTransport()
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: 10000,
          listenOnly: false
        }),
        bootstrap({
          list: [RELAY_MULTIADDR]
        })
      ],
      services: {
        identify: identify(),
        ping: ping(),
        dcutr: dcutr(),      // <-- Already present, keep
        autonat: autoNAT(),  // <-- Already present, keep
        pubsub: gossipsub({
          allowPublishToZeroTopicPeers: true,
          canRelayMessage: true
        }),
        bootstrap: bootstrap({
          list: [RELAY_MULTIADDR]
        })
      }
    })

    // Log connecting peers
    libp2p.addEventListener('peer:connect', (evt) => {
      const connection = evt.detail
      console.log('🔗 Peer connected:', connection)
    })

    console.log('Bob PeerId:', libp2p.peerId.toString())

    // Connect to relay
    try {
      await libp2p.dial(multiaddr(RELAY_MULTIADDR))
      console.log('✅ Bob connected to relay server')
    } catch (error) {
      console.warn('⚠️ Bob could not connect to relay server:', error.message)
      console.log('ℹ️ Make sure the relay is running: npm run relay')
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
      directory: './orbitdb-bob-manual'
    })

    // Use the same access controller configuration as the browser
    todoDB = await orbitdb.open('todos', {
      type: 'keyvalue',
      AccessController: IPFSAccessController({
        write: ['*']
      })
    })

    console.log('✅ Bob connected to todo database:', todoDB.address)
  })

  after(async function() {
    console.log('🔄 Shutting down Bob P2P node...')

    if (todoDB) await todoDB.close()
    if (orbitdb) await orbitdb.stop()
    if (helia) await helia.stop()
    if (libp2p) await libp2p.stop()

    console.log('✅ Bob P2P node shut down successfully')
  })

  it('should add TODOs and wait for manual verification', async function() {
    // Add todos assigned to Alice
    const aliceTodos = [
      {
        id: `bob-${Date.now()}-1`,
        text: "Review Bob's pull request",
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
      await todoDB.set(todo.id, todo)
      console.log(`✅ Bob added todo: "${todo.text}" assigned to Alice`)
    }

    console.log('🕒 Waiting for manual verification...')
    console.log(`📋 Please open the browser and connect to Bob's peerId: ${libp2p.peerId.toString()}`)

    // Wait indefinitely for manual verification
    await new Promise(() => {})
  })
})

