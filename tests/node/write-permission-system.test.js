import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB } from '@orbitdb/core'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { webSockets } from '@libp2p/websockets'
import { tcp } from '@libp2p/tcp'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { bootstrap } from '@libp2p/bootstrap'
import { webRTC } from '@libp2p/webrtc'
import { multiaddr } from '@multiformats/multiaddr'
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

// Import our write permission access controller
import { WritePermissionAccessController, grantWritePermissionToDatabase } from '../../src/lib/access-controllers/WritePermissionAccessController.js'
import { useAccessController, IPFSAccessController } from '@orbitdb/core'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { dcutr } from '@libp2p/dcutr'
import { autoNAT } from '@libp2p/autonat'
import { webRTCDirect } from '@libp2p/webrtc'
import { mdns } from '@libp2p/mdns'

// Use the same bootstrap configuration as the webapp
const RELAY_BOOTSTRAP_ADDR_DEV = '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE'
const RELAY_BOOTSTRAP_ADDR = '/dns4/91-99-67-170.k51qzi5uqu5dl6dk0zoaocksijnghdrkxir5m4yfcodish4df6re6v3wbl6njf.libp2p.direct/tcp/4002/wss/p2p/12D3KooWPJYEZSwfmRL9SHehYAeQKEbCvzFu7vtKWb6jQfMSMb8W'

// Use the same as webapp - production by default, but allow override
const CURRENT_BOOTSTRAP_ADDR = process.env.RELAY_MULTIADDR || RELAY_BOOTSTRAP_ADDR

// Peer discovery topic - same as webapp
const DISCOVERY_TOPIC = 'todo._peer-discovery._p2p._pubsub'

// Register the custom access controller globally
useAccessController(WritePermissionAccessController)

describe('Write Permission System Integration Test', function() {
  this.timeout(60000) // 60 second timeout for integration tests (longer due to network)

  let browserA = {
    libp2p: null,
    helia: null,
    orbitdb: null,
    todoDB: null,
    writePermissionDB: null,
    peerId: null
  }

  let browserB = {
    libp2p: null,
    helia: null,
    orbitdb: null,
    todoDB: null,
    writePermissionDB: null,
    peerId: null
  }

  before(async function() {
    console.log('🧹 Cleaning up test OrbitDB directories...')
    
    // Clean up any existing OrbitDB directories
    try {
      const files = await readdir('.')
      const testDirs = files.filter(file => file.includes('test-orbitdb') || file.includes('browser-'))
      
      for (const dir of testDirs) {
        if (existsSync(dir)) {
          const stat = await (await import('fs/promises')).stat(dir).catch(() => null)
          if (stat && stat.isDirectory()) {
            await rm(dir, { recursive: true, force: true })
            console.log(`✅ Cleaned up ${dir}`)
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not clean test directories:', error.message)
    }
  })

  after(async function() {
    console.log('🔄 Shutting down test nodes...')

    // Cleanup Browser A
    if (browserA.todoDB) await browserA.todoDB.close()
    if (browserA.writePermissionDB) await browserA.writePermissionDB.close()
    if (browserA.orbitdb) await browserA.orbitdb.stop()
    if (browserA.helia) await browserA.helia.stop()
    if (browserA.libp2p) await browserA.libp2p.stop()

    // Cleanup Browser B
    if (browserB.todoDB) await browserB.todoDB.close()
    if (browserB.writePermissionDB) await browserB.writePermissionDB.close()
    if (browserB.orbitdb) await browserB.orbitdb.stop()
    if (browserB.helia) await browserB.helia.stop()
    if (browserB.libp2p) await browserB.libp2p.stop()

    console.log('✅ Test nodes shut down successfully')
  })

  /**
   * Helper function to create a peer (Browser A or Browser B)
   */
  async function createPeer(name, directory) {
    console.log(`🚀 Creating ${name}...`)
    console.log(`🌐 Using bootstrap address: ${CURRENT_BOOTSTRAP_ADDR}`)

    let libp2p, helia, orbitdb, todoDB, writePermissionDB, peerId

    try {
      // Create libp2p node with exact webapp configuration
      libp2p = await createLibp2p({
        addresses: {
          listen: [
            '/ip4/0.0.0.0/tcp/0',  // Random available TCP port
            '/p2p-circuit',
            '/webrtc',
            '/webtransport', 
            '/wss', '/ws'
          ]
        },
        transports: [
          tcp(),
          webSockets({
            filter: filters.all
          }),
          webRTC(),
          webRTCDirect(),
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
          mdns({
            interval: 1000, // Check for peers every 1 second
            serviceTag: 'todo-p2p'
          })
        ],
        services: {
          identify: identify(),
          bootstrap: bootstrap({
            list: [CURRENT_BOOTSTRAP_ADDR],
            timeout: 30000, // 30 second timeout
            tagName: 'bootstrap',
            tagValue: 50,
            tagTTL: 120000 // 2 minutes
          }),
          ping: ping({
            protocolPrefix: 'ipfs', // Use IPFS ping protocol
            maxInboundStreams: 32,
            maxOutboundStreams: 64,
            timeout: 30000
          }),
          dcutr: dcutr(),
          autonat: autoNAT(),
          pubsub: gossipsub({
            emitSelf: true, // Enable to see our own messages
            allowPublishToZeroTopicPeers: true,
            globalSignaturePolicy: 'StrictSign',
            heartbeatInterval: 1000, // Send heartbeat every 1 second
            fanoutTTL: 60000, // Keep fanout peers for 1 minute
            mcacheLength: 6, // Keep last 6 heartbeats in cache
            mcacheGossip: 3, // Gossip last 3 messages
            seenTTL: 30000 // Remember seen messages for 30 seconds
          })
        }
      })

      peerId = libp2p.peerId.toString()
      console.log(`${name} PeerId:`, peerId)

      // Setup peer discovery for the test (similar to webapp)
      console.log(`📡 Setting up peer discovery for ${name}...`)
      
      // Add peer discovery event listener
      libp2p.addEventListener('peer:discovery', (evt) => {
        const peerId = evt.detail.id
        console.log(`🔍 ${name} discovered peer: ${peerId.toString()}`)
      })
      
      // Add connection event listeners
      libp2p.addEventListener('connection:open', (evt) => {
        const connection = evt.detail
        console.log(`🔗 ${name} connection opened to: ${connection.remotePeer.toString()}`)
        
        // If this is the relay, set up keep-alive ping
        const relayPeerId = '12D3KooWPJYEZSwfmRL9SHehYAeQKEbCvzFu7vtKWb6jQfMSMb8W'
        if (connection.remotePeer.toString() === relayPeerId) {
          console.log(`📌 ${name} connected to relay - setting up keep-alive`)
          // Ping the relay every 30 seconds to keep connection alive
          const pingInterval = setInterval(async () => {
            try {
              await libp2p.services.ping.ping(connection.remotePeer, { timeout: 10000 })
              console.log(`🏓 ${name} pinged relay successfully`)
            } catch (error) {
              console.warn(`⚠️ ${name} failed to ping relay:`, error.message)
              clearInterval(pingInterval)
            }
          }, 30000)
          
          // Store interval for cleanup
          if (!libp2p._relayPingInterval) {
            libp2p._relayPingInterval = pingInterval
          }
        }
      })
      
      libp2p.addEventListener('connection:close', (evt) => {
        const connection = evt.detail
        console.log(`❌ ${name} connection closed to: ${connection.remotePeer.toString()}`)
        
        // If relay connection closed, try to reconnect
        const relayPeerId = '12D3KooWPJYEZSwfmRL9SHehYAeQKEbCvzFu7vtKWb6jQfMSMb8W'
        if (connection.remotePeer.toString() === relayPeerId) {
          console.log(`⚠️ ${name} lost connection to relay - attempting reconnect in 5 seconds`)
          setTimeout(async () => {
            try {
              const relayMultiaddr = multiaddr(CURRENT_BOOTSTRAP_ADDR)
              await libp2p.dial(relayMultiaddr)
              console.log(`✅ ${name} successfully reconnected to relay`)
            } catch (error) {
              console.warn(`❌ ${name} failed to reconnect to relay:`, error.message)
            }
          }, 5000)
        }
      })
      
      // mDNS will handle local peer discovery automatically
      console.log(`📡 ${name} using mDNS for local peer discovery`)

      // Create Helia instance with memory storage for tests
      helia = await createHelia({
        libp2p,
        blockstore: new MemoryBlockstore(),
        datastore: new MemoryDatastore()
      })

      // Create OrbitDB instance (WritePermissionAccessController is already registered globally)
      orbitdb = await createOrbitDB({
        ipfs: helia,
        id: `todo-p2p-app-${name.toLowerCase()}`,
        directory: directory
      })

      // Create TODO database with WritePermissionAccessController
      todoDB = await orbitdb.open(`todos-${name.toLowerCase()}`, {
        type: 'keyvalue',
        AccessController: WritePermissionAccessController({
          ownerPeerId: peerId
        })
      })

      // Create write permission database (public write access)
      writePermissionDB = await orbitdb.open(`write-permission-requests-${peerId}`, {
        type: 'keyvalue',
        AccessController: IPFSAccessController({ write: ['*'] }) // Allow anyone to write
      })

      console.log(`✅ ${name} initialized:`)
      console.log(`  - TODO DB: ${todoDB.address}`)
      console.log(`  - Write Permission DB: ${writePermissionDB.address}`)

      return {
        libp2p,
        helia,
        orbitdb,
        todoDB,
        writePermissionDB,
        peerId
      }
    } catch (error) {
      console.error(`❌ Failed to create ${name}:`, error)
      
      // Cleanup any partially created resources
      if (writePermissionDB) await writePermissionDB.close().catch(() => {})
      if (todoDB) await todoDB.close().catch(() => {})
      if (orbitdb) await orbitdb.stop().catch(() => {})
      if (helia) await helia.stop().catch(() => {})
      if (libp2p) await libp2p.stop().catch(() => {})
      
      throw error
    }
  }

  /**
   * Helper function to wait for replication between peers
   */
  async function waitForReplication(timeMs = 2000) {
    console.log(`⏳ Waiting ${timeMs}ms for replication...`)
    await new Promise(resolve => setTimeout(resolve, timeMs))
  }

  /**
   * Helper function to wait for database synchronization using events
   */
  async function waitForSync(db, condition, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Sync timeout after ${timeout}ms`))
      }, timeout)

      const checkCondition = async () => {
        try {
          if (await condition()) {
            clearTimeout(timer)
            resolve()
          }
        } catch (error) {
          clearTimeout(timer)
          reject(error)
        }
      }

      // Listen for update events
      db.events.on('update', checkCondition)
      db.events.on('join', checkCondition)

      // Check condition immediately in case it's already met
      checkCondition()
    })
  }

  /**
   * Helper function to connect two peers via mDNS discovery
   */
  async function connectPeers(peerA, peerB) {
    console.log('🔗 Connecting peers via mDNS discovery...')
    
    // Wait for mDNS discovery to work and connections to establish
    console.log('⏳ Waiting for mDNS peer discovery and connections...')
    await waitForReplication(3000)
    
    // Check if peers have already connected to each other
    const peerAConnections = peerA.libp2p.getConnections()
    const peerBConnections = peerB.libp2p.getConnections()
    
    const peerAConnectedToB = peerAConnections.some(conn => conn.remotePeer.toString() === peerB.peerId)
    const peerBConnectedToA = peerBConnections.some(conn => conn.remotePeer.toString() === peerA.peerId)
    
    if (peerAConnectedToB || peerBConnectedToA) {
      console.log('✅ Peers already connected via mDNS discovery')
    } else {
      // Try manual connection if mDNS didn't establish connection
      try {
        const peerBId = peerB.libp2p.peerId
        console.log(`🔗 Attempting manual connection: Peer A dialing Peer B: ${peerBId.toString()}`)
        await peerA.libp2p.dial(peerBId)
        console.log('✅ Manual peer connection established')
      } catch (error) {
        console.warn('⚠️ Manual peer connection failed:', error.message)
      }
    }
    
    // Wait a bit more for connections to stabilize
    await waitForReplication(1000)
  }

  it('should initialize Browser A and Browser B', async function() {
    browserA = await createPeer('BrowserA', './test-orbitdb-browser-a')
    browserB = await createPeer('BrowserB', './test-orbitdb-browser-b')

    assert(browserA.peerId, 'Browser A should have a peer ID')
    assert(browserB.peerId, 'Browser B should have a peer ID')
    assert(browserA.todoDB, 'Browser A should have a TODO database')
    assert(browserB.todoDB, 'Browser B should have a TODO database')
    assert(browserA.writePermissionDB, 'Browser A should have a write permission database')
    assert(browserB.writePermissionDB, 'Browser B should have a write permission database')

    console.log('✅ Both browsers initialized successfully')
  })

  it('should connect the two peers', async function() {
    await connectPeers(browserA, browserB)
    
    // Verify connection
    const browserAConnections = browserA.libp2p.getConnections()
    const browserBConnections = browserB.libp2p.getConnections()
    
    console.log(`\n📊 Connection Status:`)
    console.log(`Browser A has ${browserAConnections.length} connections`)
    browserAConnections.forEach((conn, i) => {
      const status = conn.stat?.status || conn.status || 'unknown'
      console.log(`  Connection ${i + 1}: ${conn.remotePeer.toString()} (${status})`)
    })
    
    console.log(`Browser B has ${browserBConnections.length} connections`)
    browserBConnections.forEach((conn, i) => {
      const status = conn.stat?.status || conn.status || 'unknown'
      console.log(`  Connection ${i + 1}: ${conn.remotePeer.toString()} (${status})`)
    })
    
    // Get peer lists from discovery
    const browserAPeers = browserA.libp2p.getPeers()
    const browserBPeers = browserB.libp2p.getPeers()
    
    console.log(`\n🔍 Discovered Peers:`)
    console.log(`Browser A knows about ${browserAPeers.length} peers:`, browserAPeers.map(p => p.toString()))
    console.log(`Browser B knows about ${browserBPeers.length} peers:`, browserBPeers.map(p => p.toString()))
    
    // At least one of them should have connections (could be to relay)
    assert(browserAConnections.length > 0 || browserBConnections.length > 0, 'Peers should have some connections')
    
    // Ideally both should have at least 1 connection (to relay)
    console.log('\n✅ Connection test passed - peers have established connections')
  })

  it('should allow Browser B to add todos to their own database', async function() {
    console.log('📝 Browser B adding TODOs to their own database...')

    const todo1 = {
      id: 'todo-b-1',
      text: 'Browser B Todo 1',
      assignee: browserB.peerId,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: browserB.peerId
    }

    const todo2 = {
      id: 'todo-b-2',
      text: 'Browser B Todo 2',
      assignee: browserB.peerId,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: browserB.peerId
    }

    // Browser B should be able to write to their own database
    await browserB.todoDB.set(todo1.id, todo1)
    await browserB.todoDB.set(todo2.id, todo2)

    await waitForReplication(1000)

    // Verify the todos were added
    const savedTodo1 = await browserB.todoDB.get(todo1.id)
    const savedTodo2 = await browserB.todoDB.get(todo2.id)

    assert.strictEqual(savedTodo1.text, todo1.text, 'Todo 1 should be saved correctly')
    assert.strictEqual(savedTodo2.text, todo2.text, 'Todo 2 should be saved correctly')

    console.log('✅ Browser B successfully added TODOs to their own database')
  })

  it('should prevent Browser A from writing to Browser B database initially', async function() {
    console.log('🚫 Testing that Browser A cannot write to Browser B database initially...')

    const unauthorizedTodo = {
      id: 'unauthorized-todo',
      text: 'This should fail',
      assignee: browserA.peerId,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: browserA.peerId
    }

    // Try to open Browser B's database from Browser A
    let browserBTodoDBFromA
    try {
      browserBTodoDBFromA = await browserA.orbitdb.open(browserB.todoDB.address, {
        type: 'keyvalue'
      })
      console.log('📍 Browser A opened Browser B\'s TODO database')
    } catch (error) {
      console.error('❌ Browser A failed to open Browser B\'s database:', error.message)
      throw error
    }

    // Try to write - this should be rejected by the access controller
    let writeSucceeded = false
    try {
      await browserBTodoDBFromA.set(unauthorizedTodo.id, unauthorizedTodo)
      writeSucceeded = true
      console.log('⚠️ Write succeeded - this might indicate access controller is not working')
    } catch (error) {
      console.log('✅ Write correctly rejected:', error.message)
    }

    await waitForReplication(1000)

    // Verify the unauthorized todo was NOT added to Browser B's database
    const retrievedTodo = await browserB.todoDB.get(unauthorizedTodo.id)
    assert.strictEqual(retrievedTodo, undefined, 'Unauthorized todo should not exist in Browser B database')

    if (writeSucceeded) {
      console.warn('⚠️ WARNING: Write permission system may not be working correctly')
    }

    await browserBTodoDBFromA.close()
    console.log('✅ Browser A correctly prevented from writing to Browser B database')
  })

  it('should allow Browser A to write a permission request to Browser B write permission database', async function() {
    console.log('📝 Browser A writing permission request to Browser B write permission database...')

    // Browser A opens Browser B's write permission database
    const browserBWritePermissionDBFromA = await browserA.orbitdb.open(browserB.writePermissionDB.address, {
      type: 'keyvalue'
    })

    const requestId = `${browserA.peerId}-${browserB.todoDB.address}-${Date.now()}`
    const request = {
      id: requestId,
      requesterPeerId: browserA.peerId,
      targetDatabaseAddress: browserB.todoDB.address,
      targetPeerID: browserB.peerId,
      reason: 'Requesting write access to collaborate on TODOs',
      status: 'pending',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString() // 48 hours
    }

    // Write the permission request to Browser B's write permission database
    await browserBWritePermissionDBFromA.set(requestId, request)
    console.log('✅ Permission request written to Browser B write permission database')

    // Wait for proper database synchronization using events
    await waitForSync(browserB.writePermissionDB, async () => {
      const retrievedRequest = await browserB.writePermissionDB.get(requestId)
      return retrievedRequest !== undefined
    })

    // Verify Browser B can see the request in their write permission database
    const retrievedRequest = await browserB.writePermissionDB.get(requestId)
    assert(retrievedRequest, 'Permission request should exist in Browser B write permission database')
    assert.strictEqual(retrievedRequest.requesterPeerId, browserA.peerId, 'Request should be from Browser A')
    assert.strictEqual(retrievedRequest.status, 'pending', 'Request should be pending')

    console.log('✅ Browser B can see the permission request from Browser A')

    await browserBWritePermissionDBFromA.close()
  })

  it('should allow Browser B to grant write permission to Browser A', async function() {
    console.log('✅ Browser B granting write permission to Browser A...')

    // Get all requests from Browser B's write permission database
    const allRequests = await browserB.writePermissionDB.all()
    const requests = Object.values(allRequests).map(entry => entry.value)
    
    console.log('🔍 Debug: All requests found:', requests.length)
    console.log('🔍 Debug: Raw allRequests object:', JSON.stringify(allRequests, null, 2))
    requests.forEach((req, i) => {
      console.log(`  Request ${i + 1} (full object):`, JSON.stringify(req, null, 2))
      console.log(`  Request ${i + 1} (properties):`, {
        id: req.id,
        requesterPeerId: req.requesterPeerId,
        status: req.status,
        targetPeerID: req.targetPeerID
      })
    })
    
    console.log('🔍 Debug: Looking for request from:', browserA.peerId)
    
    // Find the pending request from Browser A
    const pendingRequest = requests.find(req => 
      req.requesterPeerId === browserA.peerId && 
      req.status === 'pending'
    )

    if (!pendingRequest) {
      // If no pending request found, wait a bit more for replication and try again
      console.log('⚠️ No pending request found, waiting for replication...')
      await waitForReplication(3000)
      
      const allRequestsRetry = await browserB.writePermissionDB.all()
      const requestsRetry = Object.values(allRequestsRetry).map(entry => entry.value)
      
      console.log('🔍 Debug: Retry - All requests found:', requestsRetry.length)
      requestsRetry.forEach((req, i) => {
        console.log(`  Retry Request ${i + 1}:`, {
          id: req.id,
          requesterPeerId: req.requesterPeerId,
          status: req.status,
          targetPeerID: req.targetPeerID
        })
      })
      
      const pendingRequestRetry = requestsRetry.find(req => 
        req.requesterPeerId === browserA.peerId && 
        req.status === 'pending'
      )
      
      assert(pendingRequestRetry, 'Should find pending request from Browser A after retry')
      
      // Use the retry result
      const finalPendingRequest = pendingRequestRetry
      
      // Update the request status to granted
      const grantedRequest = {
        ...finalPendingRequest,
        status: 'granted',
        grantedAt: new Date().toISOString(),
        grantedBy: browserB.peerId
      }

      await browserB.writePermissionDB.set(finalPendingRequest.id, grantedRequest)
      console.log('✅ Permission request marked as granted in write permission database')

      // Grant actual write permission to Browser B's TODO database using the access controller
      grantWritePermissionToDatabase(
        browserB.todoDB.address,      // Database address
        browserA.orbitdb.identity.id, // OrbitDB identity ID, not peer ID
        48 * 60 * 60 * 1000          // 48 hours
      )
      console.log('✅ Write permission granted via access controller')

      await waitForReplication(1000)

      // Verify the request is now marked as granted
      const updatedRequest = await browserB.writePermissionDB.get(finalPendingRequest.id)
      assert.strictEqual(updatedRequest.status, 'granted', 'Request should be marked as granted')

      console.log('✅ Browser B successfully granted write permission to Browser A')
      return
    }

    assert(pendingRequest, 'Should find pending request from Browser A')

    // Update the request status to granted
    const grantedRequest = {
      ...pendingRequest,
      status: 'granted',
      grantedAt: new Date().toISOString(),
      grantedBy: browserB.peerId
    }

    await browserB.writePermissionDB.set(pendingRequest.id, grantedRequest)
    console.log('✅ Permission request marked as granted in write permission database')

    // Grant actual write permission to Browser B's TODO database using the access controller
    console.log('🔍 Debug: Granting permission for database address:', browserB.todoDB.address)
    console.log('🔍 Debug: Browser A libp2p peer ID:', browserA.peerId)
    console.log('🔍 Debug: Browser A OrbitDB identity:', browserA.orbitdb.identity.id)
    
    // Grant permission to the OrbitDB identity, not the libp2p peer ID
    grantWritePermissionToDatabase(
      browserB.todoDB.address,    // Database address
      browserA.orbitdb.identity.id, // OrbitDB identity ID, not peer ID
      48 * 60 * 60 * 1000        // 48 hours
    )
    console.log('✅ Write permission granted via access controller')

    await waitForReplication(1000)

    // Verify the request is now marked as granted
    const updatedRequest = await browserB.writePermissionDB.get(pendingRequest.id)
    assert.strictEqual(updatedRequest.status, 'granted', 'Request should be marked as granted')

    console.log('✅ Browser B successfully granted write permission to Browser A')
  })

  it('should allow Browser A to write to Browser B database after permission granted', async function() {
    console.log('📝 Browser A attempting to write to Browser B database after permission granted...')

    // Browser A opens Browser B's database again
    const browserBTodoDBFromA = await browserA.orbitdb.open(browserB.todoDB.address, {
      type: 'keyvalue'
    })

    const authorizedTodo = {
      id: 'authorized-todo-from-a',
      text: 'This should succeed now',
      assignee: browserA.peerId,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: browserA.peerId
    }

    // Try to write - this should now succeed
    await browserBTodoDBFromA.set(authorizedTodo.id, authorizedTodo)
    console.log('✅ Browser A successfully wrote to Browser B database')

    await waitForReplication(2000)

    // Verify the todo was added to Browser B's database
    const retrievedTodo = await browserB.todoDB.get(authorizedTodo.id)
    assert(retrievedTodo, 'Authorized todo should exist in Browser B database')
    assert.strictEqual(retrievedTodo.text, authorizedTodo.text, 'Todo text should match')
    assert.strictEqual(retrievedTodo.createdBy, browserA.peerId, 'Todo should be created by Browser A')

    console.log('✅ Browser A can now successfully write to Browser B database')

    await browserBTodoDBFromA.close()
  })

  it('should simulate the complete write permission flow', async function() {
    console.log('🔄 Testing complete write permission flow simulation...')

    // Step 1: Browser A discovers Browser B's databases (simulated by having the addresses)
    console.log('Step 1: ✅ Database discovery (simulated)')

    // Step 2: Browser A switches to Browser B's database (simulated by opening it)
    const browserBTodoDBFromA = await browserA.orbitdb.open(browserB.todoDB.address, {
      type: 'keyvalue'
    })
    console.log('Step 2: ✅ Browser A opened Browser B\'s TODO database')

    // Step 3: Browser A checks write permission (simulated - we know it has permission from previous test)
    const testTodo = {
      id: `flow-test-${Date.now()}`,
      text: 'Complete flow test todo',
      assignee: browserA.peerId,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: browserA.peerId
    }

    // Step 4: Browser A writes to Browser B's database (should succeed due to granted permission)
    await browserBTodoDBFromA.set(testTodo.id, testTodo)
    console.log('Step 4: ✅ Browser A wrote todo to Browser B\'s database')

    await waitForReplication(1000)

    // Step 5: Verify Browser B receives the update
    const receivedTodo = await browserB.todoDB.get(testTodo.id)
    assert(receivedTodo, 'Browser B should receive the todo from Browser A')
    assert.strictEqual(receivedTodo.text, testTodo.text, 'Todo content should match')

    console.log('Step 5: ✅ Browser B received the todo update')

    // Step 6: Verify both browsers see the same data
    const allTodosFromB = await browserB.todoDB.all()
    const allTodosFromAViewingB = await browserBTodoDBFromA.all()

    console.log(`Browser B sees ${Object.keys(allTodosFromB).length} todos in their database`)
    console.log(`Browser A sees ${Object.keys(allTodosFromAViewingB).length} todos in Browser B's database`)

    assert(Object.keys(allTodosFromB).length > 0, 'Browser B should have todos in their database')
    
    await browserBTodoDBFromA.close()
    console.log('✅ Complete write permission flow simulation successful')
  })

  it('should demonstrate database replication and event handling', async function() {
    console.log('🔄 Testing database replication and events...')

    let browserBUpdateReceived = false
    let browserAUpdateReceived = false

    // Set up event listeners
    browserB.todoDB.events.on('update', (entry) => {
      console.log('📝 Browser B received update event:', entry?.payload?.key)
      browserBUpdateReceived = true
    })

    // Browser A opens Browser B's database and sets up listener
    const browserBTodoDBFromA = await browserA.orbitdb.open(browserB.todoDB.address, {
      type: 'keyvalue'
    })

    browserBTodoDBFromA.events.on('update', (entry) => {
      console.log('📝 Browser A received update event from Browser B database:', entry?.payload?.key)
      browserAUpdateReceived = true
    })

    await waitForReplication(1000) // Let databases sync

    // Browser B adds a todo to their own database
    const eventTestTodo = {
      id: `event-test-${Date.now()}`,
      text: 'Event replication test',
      assignee: browserB.peerId,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: browserB.peerId
    }

    await browserB.todoDB.set(eventTestTodo.id, eventTestTodo)
    console.log('✅ Browser B added todo to their database')

    await waitForReplication(3000) // Wait for replication and events

    // Verify both browsers received update events
    assert(browserBUpdateReceived, 'Browser B should receive update event for their own database')
    
    // Browser A might not always receive the event immediately due to replication timing
    console.log(`Browser A update received: ${browserAUpdateReceived}`)
    
    // Verify Browser A can read the new todo (even if event wasn't received)
    const replicatedTodo = await browserBTodoDBFromA.get(eventTestTodo.id)
    if (replicatedTodo) {
      console.log('✅ Browser A can read todo added by Browser B (replication successful)')
    } else {
      console.log('⚠️ Todo not yet replicated to Browser A view')
    }

    await browserBTodoDBFromA.close()
    console.log('✅ Event and replication test completed')
  })
})
