#!/usr/bin/env node

import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { webSockets } from '@libp2p/websockets'
import { identify } from '@libp2p/identify'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { LevelDatastore } from 'datastore-level'
import { LevelBlockstore } from 'blockstore-level'
import { PinningService } from './relay/services/pinning.js'
import { unixfs } from '@helia/unixfs'
import { CID } from 'multiformats/cid'
import * as filters from '@libp2p/websockets/filters'

console.log('🧪 Testing OrbitDB CID Pinning Service')

async function testCIDPinning() {
  let libp2p, helia, orbitdb, documentsDB, pinningService
  
  try {
    // 1. Create libp2p node
    console.log('📡 Creating libp2p node...')
    libp2p = await createLibp2p({
      addresses: {
        listen: ['/ip4/127.0.0.1/tcp/0/ws']
      },
      transports: [
        webSockets({
          filter: filters.all
        })
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        pubsub: gossipsub({
          emitSelf: true,
          allowPublishToZeroTopicPeers: true
        })
      }
    })
    
    // 2. Create Helia (IPFS) instance
    console.log('📁 Creating Helia instance...')
    const blockstore = new LevelBlockstore('./test-helia-blocks')
    const datastore = new LevelDatastore('./test-helia-data')
    helia = await createHelia({ libp2p, blockstore, datastore })
    
    // 3. Create OrbitDB instance
    console.log('🛰️ Creating OrbitDB instance...')
    orbitdb = await createOrbitDB({
      ipfs: helia,
      id: 'cid-pinning-test',
      directory: './test-orbitdb-data'
    })
    
    // 4. Create a documents database
    console.log('📄 Creating documents database...')
    documentsDB = await orbitdb.open('test-documents', {
      type: 'documents',
      AccessController: IPFSAccessController({ write: ['*'] })
    })
    
    // 5. Initialize PinningService with the existing Helia instance
    console.log('📌 Initializing PinningService...')
    pinningService = new PinningService({ 
      logLevel: 'debug',
      verboseLogging: true 
    })
    // Pass the existing helia instance instead of creating a new one
    pinningService.libp2p = libp2p
    pinningService.helia = helia
    pinningService.orbitdb = orbitdb
    
    // 6. Add some test content to IPFS first
    console.log('📦 Adding test content to IPFS...')
    const fs = unixfs(helia)
    const testContent1 = new TextEncoder().encode('Hello, this is test content 1!')
    const testContent2 = new TextEncoder().encode('Hello, this is test content 2!')
    
    const cid1 = await fs.addBytes(testContent1)
    const cid2 = await fs.addBytes(testContent2)
    
    console.log(`✅ Test content added:`)
    console.log(`   - CID1: ${cid1.toString()}`)
    console.log(`   - CID2: ${cid2.toString()}`)
    
    // 7. Set up listeners for the documents database to simulate discovery
    await pinningService.syncAndPinDatabase(documentsDB.address)
    
    console.log('⏳ Waiting a moment for setup to complete...')
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // 8. Add documents with CID fields
    console.log('📝 Adding documents with CID fields...')
    
    const doc1 = {
      _id: 'doc1',
      title: 'Document with CID 1',
      cid: cid1.toString(),
      content: 'This document references content stored in IPFS',
      timestamp: new Date().toISOString()
    }
    
    const doc2 = {
      _id: 'doc2', 
      title: 'Document with CID 2',
      CID: cid2.toString(), // Test uppercase CID field
      content: 'This document also references IPFS content',
      timestamp: new Date().toISOString()
    }
    
    await documentsDB.put(doc1)
    console.log('📄 Added document 1 with CID field')
    
    await documentsDB.put(doc2)
    console.log('📄 Added document 2 with CID field')
    
    // 9. Wait for pinning operations to complete
    console.log('⏳ Waiting for pinning operations...')
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // 10. Check if CIDs are pinned
    console.log('🔍 Checking pinned CIDs...')
    try {
      const pinnedCids = []
      for await (const { cid } of helia.pins.ls()) {
        pinnedCids.push(cid.toString())
      }
      console.log(`📌 Currently pinned CIDs: ${pinnedCids.length}`)
      pinnedCids.forEach(cidStr => {
        console.log(`   - ${cidStr}`)
        if (cidStr === cid1.toString()) console.log('     ✅ CID1 is pinned!')
        if (cidStr === cid2.toString()) console.log('     ✅ CID2 is pinned!')
      })
    } catch (error) {
      console.error('❌ Error checking pinned CIDs:', error)
    }
    
    // 11. Test deletion (unpinning)
    console.log('🗑️ Testing document deletion and unpinning...')
    await documentsDB.del('doc1')
    console.log('📄 Deleted document 1')
    
    // Wait for unpinning
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // 12. Check pinned CIDs again
    console.log('🔍 Checking pinned CIDs after deletion...')
    try {
      const pinnedCids = []
      for await (const { cid } of helia.pins.ls()) {
        pinnedCids.push(cid.toString())
      }
      console.log(`📌 Currently pinned CIDs: ${pinnedCids.length}`)
      pinnedCids.forEach(cidStr => {
        console.log(`   - ${cidStr}`)
        if (cidStr === cid1.toString()) console.log('     ⚠️ CID1 is still pinned (should be unpinned)')
        if (cidStr === cid2.toString()) console.log('     ✅ CID2 is still pinned (correct)')
      })
    } catch (error) {
      console.error('❌ Error checking pinned CIDs:', error)
    }
    
    console.log('🎉 CID pinning test completed!')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    // Cleanup
    console.log('🧹 Cleaning up...')
    
    if (pinningService) {
      await pinningService.cleanup()
    }
    
    if (documentsDB) {
      try {
        await documentsDB.close()
      } catch (error) {
        console.warn('Warning: Error closing documents DB:', error.message)
      }
    }
    
    if (orbitdb) {
      try {
        await orbitdb.stop()
      } catch (error) {
        console.warn('Warning: Error stopping OrbitDB:', error.message)
      }
    }
    
    if (helia) {
      try {
        await helia.stop()
      } catch (error) {
        console.warn('Warning: Error stopping Helia:', error.message)
      }
    }
    
    if (libp2p) {
      try {
        await libp2p.stop()
      } catch (error) {
        console.warn('Warning: Error stopping libp2p:', error.message)
      }
    }
    
    console.log('✅ Cleanup completed')
    process.exit(0)
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down...')
  process.exit(0)
})

testCIDPinning().catch(console.error)
