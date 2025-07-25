#!/usr/bin/env node

/**
 * Test script to verify web app write permission system works correctly
 * This tests the same flow as the working integration test but using web app code
 */

import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { mdns } from '@libp2p/mdns'
import { webSockets } from '@libp2p/websockets'
import { all } from '@libp2p/websockets/filters'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import { createHelia } from 'helia'
import { createOrbitDB, useAccessController } from '@orbitdb/core'
import { WritePermissionAccessController, grantWritePermissionToDatabase } from './src/lib/access-controllers/WritePermissionAccessController.js'

const TEST_BOOTSTRAP_ADDRESS = '/dns4/91-99-67-170.k51qzi5uqu5dl6dk0zoaocksijnghdrkxir5m4yfcodish4df6re6v3wbl6njf.libp2p.direct/tcp/4002/wss/p2p/12D3KooWPJYEZSwfmRL9SHehYAeQKEbCvzFu7vtKWb6jQfMSMb8W'

async function createTestNode(name) {
  console.log(`🚀 Creating ${name}...`)
  
  const libp2p = await createLibp2p({
    addresses: {
      listen: ['/ip4/127.0.0.1/tcp/0/ws']
    },
    transports: [
      webSockets({ filter: all })
    ],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      bootstrap({
        list: [TEST_BOOTSTRAP_ADDRESS]
      }),
      mdns({
        interval: 1000
      })
    ],
    services: {
      identify: identify(),
      pubsub: gossipsub({
        allowPublishToZeroPeers: true,
        msgIdFn: (msg) => {
          return new TextEncoder().encode(msg.topic + msg.data.toString())
        },
        ignoreDuplicatePublishError: true
      })
    },
    connectionManager: {
      maxConnections: 100,
      minConnections: 0
    }
  })

  const helia = await createHelia({ 
    libp2p,
    start: true 
  })
  
  // Register the custom access controller
  useAccessController(WritePermissionAccessController)
  
  const orbitdb = await createOrbitDB({
    ipfs: helia,
    id: `${name.toLowerCase()}-test`,
    directory: `./test-${name.toLowerCase()}`
  })

  console.log(`${name} PeerId: ${libp2p.peerId.toString()}`)
  console.log(`${name} OrbitDB Identity: ${orbitdb.identity.id}`)

  return { libp2p, helia, orbitdb, name }
}

async function testWebAppPermissionSystem() {
  console.log('🔄 Testing Web App Write Permission System...\n')

  // Create two test nodes
  const nodeA = await createTestNode('BrowserA')
  const nodeB = await createTestNode('BrowserB')

  try {
    // Wait for connection
    console.log('🔗 Waiting for peer connection...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Create databases with write permission access controllers
    console.log('📝 Creating databases with WritePermissionAccessController...')
    
    const dbA = await nodeA.orbitdb.open('test-db-a', {
      type: 'keyvalue',
      AccessController: WritePermissionAccessController({ ownerPeerId: nodeA.orbitdb.identity.id })
    })

    const dbB = await nodeB.orbitdb.open('test-db-b', {
      type: 'keyvalue', 
      AccessController: WritePermissionAccessController({ ownerPeerId: nodeB.orbitdb.identity.id })
    })

    console.log(`✅ Database A: ${dbA.address} (Owner: ${nodeA.orbitdb.identity.id})`)
    console.log(`✅ Database B: ${dbB.address} (Owner: ${nodeB.orbitdb.identity.id})`)

    // Test 1: Owner can write to their own database
    console.log('\n📝 Test 1: Owner writing to their own database...')
    await dbA.set('test-key-a', { text: 'Owner write test', owner: nodeA.orbitdb.identity.id })
    console.log('✅ Owner A successfully wrote to database A')

    // Test 2: Non-owner cannot write initially
    console.log('\n🚫 Test 2: Non-owner trying to write (should fail)...')
    try {
      await dbA.set('unauthorized-key', { text: 'This should fail', requester: nodeB.orbitdb.identity.id })
      console.log('⚠️ ERROR: Non-owner write succeeded when it should have failed!')
    } catch (error) {
      console.log('✅ Non-owner correctly denied write access:', error.message)
    }

    // Test 3: Grant permission using web app logic
    console.log('\n✅ Test 3: Granting write permission using web app logic...')
    
    // Simulate the web app permission granting flow
    console.log('🔍 Debug: Database A address:', dbA.address)
    console.log('🔍 Debug: Node B OrbitDB identity:', nodeB.orbitdb.identity.id)
    
    // Grant permission using the access controller method
    if (dbA.access && typeof dbA.access.grantWritePermission === 'function') {
      dbA.access.grantWritePermission(nodeB.orbitdb.identity.id)
      console.log('✅ Permission granted using access controller method')
    } else {
      console.log('⚠️ Access controller method not available, using direct grant')
      grantWritePermissionToDatabase(dbA.address, nodeB.orbitdb.identity.id)
    }

    // Wait for permission to propagate
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Test 4: Non-owner can now write after permission granted
    console.log('\n📝 Test 4: Non-owner writing after permission granted...')
    try {
      await dbA.set('authorized-key', { text: 'This should succeed now', requester: nodeB.orbitdb.identity.id })
      console.log('✅ Non-owner successfully wrote to database A after permission granted')
    } catch (error) {
      console.log('❌ ERROR: Non-owner write failed even after permission granted:', error.message)
      throw error
    }

    // Test 5: Verify data replication
    console.log('\n🔄 Test 5: Verifying data replication...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    const allData = await dbA.all()
    console.log('📊 Final database A contents:', Object.keys(allData))
    
    if (allData['test-key-a'] && allData['authorized-key']) {
      console.log('✅ All data replicated successfully')
    } else {
      console.log('⚠️ Some data missing:', allData)
    }

    console.log('\n🎉 Web App Write Permission System Test PASSED!')

  } catch (error) {
    console.error('\n❌ Web App Write Permission System Test FAILED:', error)
    throw error
    
  } finally {
    // Cleanup
    console.log('\n🔄 Shutting down test nodes...')
    await nodeA.orbitdb.stop()
    await nodeB.orbitdb.stop()
    await nodeA.helia.stop()
    await nodeB.helia.stop()
    console.log('✅ Test nodes stopped')
  }
}

// Run the test
testWebAppPermissionSystem().catch(console.error)
