import { RelayDiscovery, setRelayDiscovery } from '../../utils/relay-discovery.js'
import { runHealthCheck, runHealthCheckAndRecover } from '../../utils/db-health-check.js'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { getLibP2P, getHelia, stopP2P, getBootstrapConfig } from './network.js'
import { getOrbitDB, getCurrentTodoDB, stopOrbitDB } from './database.js'
import { getTodoDatabase } from './database.js'

let relayDiscovery = null

/**
 * Get relay discovery status
 */
export async function getRelayDiscoveryStatus() {
  if (!relayDiscovery) {
    // Use the correct relay HTTP server URL based on the actual bootstrap configuration
    const bootstrapConfig = getBootstrapConfig()
    const isDevelopment = bootstrapConfig.isDevelopment
    const relayHttpUrl = isDevelopment 
      ? 'http://127.0.0.1:3000'  // Development relay HTTP server
      : 'http://91-99-67-170.k51qzi5uqu5dl6dk0zoaocksijnghdrkxir5m4yfcodish4df6re6v3wbl6njf.libp2p.direct:4000'  // Production relay HTTP server
    
    console.log('🔧 Creating RelayDiscovery with HTTP URL:', relayHttpUrl, '(based on bootstrap:', bootstrapConfig.currentBootstrapAddr, ')')
    relayDiscovery = new RelayDiscovery(relayHttpUrl)
    
    // Set this as the global singleton instance
    setRelayDiscovery(relayDiscovery)
  }
  
  try {
    const isHealthy = await relayDiscovery.isRelayHealthy()
    const addresses = relayDiscovery.cachedAddrs
    const lastFetch = relayDiscovery.lastFetch
    const bootstrapConfig = getBootstrapConfig()
    
    return {
      healthy: isHealthy,
      addresses: addresses,
      lastFetch: lastFetch,
      cacheAge: lastFetch ? Date.now() - lastFetch : null,
      cacheValid: addresses && lastFetch && (Date.now() - lastFetch) < relayDiscovery.cacheTTL,
      relayHttpUrl: relayDiscovery.relayHttpUrl,
      bootstrapConfig: bootstrapConfig
    }
  } catch (error) {
    const bootstrapConfig = getBootstrapConfig()
    return {
      healthy: false,
      error: error.message,
      addresses: null,
      lastFetch: null,
      cacheAge: null,
      cacheValid: false,
      relayHttpUrl: relayDiscovery?.relayHttpUrl || 'unknown',
      bootstrapConfig: bootstrapConfig
    }
  }
}

/**
 * Run comprehensive database health check
 */
export async function runDatabaseHealthCheck() {
  console.log('🏥 Running database health check...')
  
  const components = {
    libp2p: getLibP2P(),
    helia: getHelia(),
    orbitdb: getOrbitDB(),
    todoDB: getCurrentTodoDB(),
    verbose: true
  }
  
  const healthReport = await runHealthCheck(components)
  
  console.log('🏥 Health check results:', {
    overall: healthReport.overall,
    errors: healthReport.errors,
    recommendations: healthReport.recommendations
  })
  
  return healthReport
}

/**
 * Run health check and attempt automatic recovery
 */
export async function runDatabaseHealthCheckAndRecover(options = {}) {
  console.log('🔧 Running database health check with recovery...')
  
  const components = {
    libp2p: getLibP2P(),
    helia: getHelia(),
    orbitdb: getOrbitDB(),
    todoDB: getCurrentTodoDB(),
    verbose: true
  }
  
  const result = await runHealthCheckAndRecover(components, options)
  
  console.log('🔧 Health check and recovery complete:', {
    overall: result.healthReport.overall,
    recoveryActions: result.recoveryActions,
    needsFullReset: result.needsFullReset
  })
  
  // If full reset is needed, clear the global variables
  if (result.needsFullReset) {
    console.warn('⚠️ Critical database issues detected - full reset recommended')
    await forceResetDatabase()
  }
  
  return result
}

/**
 * Force reset all database components
 */
export async function forceResetDatabase() {
  console.log('🔄 Force resetting all database components...')
  
  try {
    // Stop OrbitDB first
    await stopOrbitDB()
    
    // Stop network components
    await stopP2P()
    
    // Reset relay discovery
    relayDiscovery = null
    
    console.log('✅ Database reset complete')
  } catch (error) {
    console.error('❌ Error during database reset:', error)
    throw error
  }
}

/**
 * Clear all OrbitDB data from the browser
 */
export async function clearAllOrbitDBData() {
  console.log('🧹 Starting complete OrbitDB data cleanup...')
  
  const report = {
    success: true,
    actions: [],
    errors: []
  }
  
  try {
    // First, stop all running components
    console.log('1️⃣ Stopping all P2P components...')
    await forceResetDatabase()
    report.actions.push('Stopped P2P components')
    
    // Clear browser storage (IndexedDB)
    if (typeof window !== 'undefined' && window.indexedDB) {
      console.log('3️⃣ Clearing IndexedDB databases...')
      
      try {
        // Get list of all databases
        const databases = await indexedDB.databases()
        console.log('Found IndexedDB databases:', databases.map(db => db.name))
        
        for (const dbInfo of databases) {
          // Delete OrbitDB-related databases
          if (dbInfo.name && (
            dbInfo.name.includes('orbitdb') ||
            dbInfo.name.includes('helia') ||
            dbInfo.name.includes('ipfs') ||
            dbInfo.name.includes('libp2p') ||
            dbInfo.name.includes('keystore') ||
            dbInfo.name.includes('blockstore') ||
            dbInfo.name.includes('datastore')
          )) {
            console.log(`  - Deleting database: ${dbInfo.name}`)
            const deleteRequest = indexedDB.deleteDatabase(dbInfo.name)
            
            await new Promise((resolve, reject) => {
              deleteRequest.onsuccess = () => {
                console.log(`    ✅ Deleted ${dbInfo.name}`)
                resolve()
              }
              deleteRequest.onerror = () => {
                console.warn(`    ⚠️ Failed to delete ${dbInfo.name}:`, deleteRequest.error)
                report.errors.push(`Failed to delete ${dbInfo.name}: ${deleteRequest.error}`)
                resolve() // Continue with other databases
              }
              deleteRequest.onblocked = () => {
                console.warn(`    ⏳ Deletion of ${dbInfo.name} is blocked`)
                // Try to resolve anyway after a timeout
                setTimeout(resolve, 1000)
              }
            })
          }
        }
        
        report.actions.push('Cleared IndexedDB databases')
      } catch (error) {
        console.error('Error clearing IndexedDB:', error)
        report.errors.push(`IndexedDB cleanup error: ${error.message}`)
      }
    }
    
    // Clear localStorage and sessionStorage
    const storageTypes = [
      { storage: 'localStorage', name: 'localStorage' },
      { storage: 'sessionStorage', name: 'sessionStorage' }
    ]
    
    for (const { storage, name } of storageTypes) {
      if (typeof window !== 'undefined' && window[storage]) {
        console.log(`4️⃣ Clearing ${name}...`)
        
        try {
          const keysToRemove = []
          const storageObj = window[storage]
          
          for (let i = 0; i < storageObj.length; i++) {
            const key = storageObj.key(i)
            if (key && (
              key.includes('orbitdb') ||
              key.includes('helia') ||
              key.includes('ipfs') ||
              key.includes('libp2p') ||
              key.includes('keystore') ||
              key.includes('peer') ||
              key.includes('identity')
            )) {
              keysToRemove.push(key)
            }
          }
          
          keysToRemove.forEach(key => {
            console.log(`  - Removing ${name} key: ${key}`)
            storageObj.removeItem(key)
          })
          
          if (keysToRemove.length > 0) {
            report.actions.push(`Cleared ${keysToRemove.length} ${name} keys`)
          } else {
            report.actions.push(`No relevant ${name} keys found`)
          }
        } catch (error) {
          console.error(`Error clearing ${name}:`, error)
          report.errors.push(`${name} cleanup error: ${error.message}`)
        }
      }
    }
    
    console.log('🎉 OrbitDB data cleanup completed!')
    
    if (report.errors.length > 0) {
      console.warn('⚠️ Cleanup completed with some errors:', report.errors)
      report.success = false
    }
    
  } catch (error) {
    console.error('❌ Fatal error during OrbitDB cleanup:', error)
    report.success = false
    report.errors.push(`Fatal error: ${error.message}`)
  }
  
  return report
}

/**
 * Test OrbitDB operations directly for diagnostics
 */
export async function testOrbitDBOperations(helia) {
  console.log('🧪 Starting OrbitDB operations test...')
  
  try {
    const db = await getTodoDatabase(helia)
    console.log('✅ Database obtained:', db.address)
    
    // Test 1: Simple key-value storage
    const testKey = `test-${Date.now()}`
    const testValue = {
      message: 'Hello OrbitDB',
      timestamp: new Date().toISOString(),
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      nested: { key: 'value' }
    }
    
    console.log('📋 Test 1: Storing test data...', { key: testKey, value: testValue })
    
    let hash
    try {
      hash = await db.set(testKey, testValue)
      console.log('✅ Test 1 PASSED: Data stored successfully, hash:', hash)
    } catch (setError) {
      console.error('❌ Test 1 FAILED: Set operation failed:', setError)
      return { success: false, error: 'Set operation failed', details: setError }
    }
    
    // Test 2: Retrieve the data
    console.log('📋 Test 2: Retrieving test data...')
    try {
      const retrieved = await db.get(testKey)
      console.log('✅ Test 2 PASSED: Data retrieved successfully:', retrieved)
      
      // Verify data integrity
      if (JSON.stringify(retrieved) === JSON.stringify(testValue)) {
        console.log('✅ Test 2a PASSED: Data integrity verified')
      } else {
        console.warn('⚠️ Test 2a WARNING: Data integrity mismatch', {
          expected: testValue,
          actual: retrieved
        })
      }
    } catch (getError) {
      console.error('❌ Test 2 FAILED: Get operation failed:', getError)
      return { success: false, error: 'Get operation failed', details: getError }
    }
    
    // Test 3: List all entries
    console.log('📋 Test 3: Listing all entries...')
    try {
      const allEntries = await db.all()
      console.log('✅ Test 3 PASSED: All entries retrieved:', Object.keys(allEntries).length, 'entries')
      console.log('Sample entries:', allEntries)
    } catch (allError) {
      console.error('❌ Test 3 FAILED: All operation failed:', allError)
      return { success: false, error: 'All operation failed', details: allError }
    }
    
    // Test 4: Delete the test entry
    console.log('📋 Test 4: Deleting test data...')
    try {
      let deleteResult
      if (typeof db.delete === 'function') {
        deleteResult = await db.delete(testKey)
      } else if (typeof db.del === 'function') {
        deleteResult = await db.del(testKey)
      } else if (typeof db.remove === 'function') {
        deleteResult = await db.remove(testKey)
      } else if (typeof db.set === 'function') {
        deleteResult = await db.set(testKey, null)
        console.log('ℹ️ Using set(key, null) for deletion')
      } else {
        console.log('🔍 Available database methods:', Object.getOwnPropertyNames(db).filter(prop => typeof db[prop] === 'function'))
        console.log('🔍 Database prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(db)).filter(prop => typeof db[prop] === 'function'))
        throw new Error('No delete method found on database object')
      }
      console.log('✅ Test 4 PASSED: Data deleted successfully, result:', deleteResult)
    } catch (deleteError) {
      console.error('❌ Test 4 FAILED: Delete operation failed:', deleteError)
      return { success: false, error: 'Delete operation failed', details: deleteError }
    }
    
    console.log('🎉 All OrbitDB tests passed successfully!')
    return { 
      success: true, 
      message: 'All OrbitDB operations working correctly',
      testHash: hash
    }
    
  } catch (error) {
    console.error('❌ OrbitDB test suite failed:', error)
    return { 
      success: false, 
      error: 'Test suite failed', 
      details: error,
      message: error.message
    }
  }
}

/**
 * Test pubsub self-message visibility
 */
export async function testPubsubSelfMessages() {
  const libp2p = getLibP2P()
  
  if (!libp2p) {
    console.warn('❌ libp2p not initialized yet. Please wait for P2P initialization to complete.')
    return
  }
  
  console.log('🧪 Testing pubsub self-message visibility...')
  
  // Enhanced diagnostics
  const pubsubService = libp2p.services.pubsub
  const connections = libp2p.getConnections()
  
  console.log('📊 Detailed pubsub state:', {
    peerId: libp2p.peerId.toString(),
    subscriptions: Array.from(pubsubService.subscriptions),
    connectedPeers: connections.length,
    peerConnections: connections.map(c => ({
      peer: c.remotePeer.toString(),
      status: c.status,
      direction: c.stat?.direction || 'unknown',
      address: c.remoteAddr?.toString() || 'unknown'
    })),
    pubsubType: pubsubService.constructor.name,
    started: pubsubService.started,
    topics: pubsubService.getTopics ? pubsubService.getTopics() : 'N/A',
    peers: pubsubService.getPeers ? pubsubService.getPeers() : 'N/A'
  })
  
  // Check gossipsub internals if available
  try {
    if (pubsubService.mesh) {
      console.log('🕸️ Gossipsub mesh info:', {
        meshTopics: Array.from(pubsubService.mesh.keys()),
        fanout: pubsubService.fanout ? Array.from(pubsubService.fanout.keys()) : [],
        gossip: pubsubService.gossip ? Array.from(pubsubService.gossip.keys()) : []
      })
    }
  } catch (e) {
    console.log('⚠️ Could not access gossipsub internals:', e.message)
  }
  
  let messageCount = 0
  const receivedMessages = []
  
  // Subscribe to test topic with logging
  const testTopic = 'pubsub-self-test'
  console.log(`📡 Subscribing to topic: ${testTopic}`)
  
  const messageHandler = (msg) => {
    messageCount++
    const raw = new TextDecoder().decode(msg.data)
    const myPeerId = libp2p.peerId.toString()
    
    console.log(`📩 [${messageCount}] Message received on ${testTopic}:`, {
      from: msg.from,
      topic: msg.topic,
      data: raw,
      isSelf: msg.from === myPeerId,
      myPeerId
    })
    
    receivedMessages.push({
      from: msg.from,
      topic: msg.topic,
      data: raw,
      isSelf: msg.from === myPeerId,
      timestamp: Date.now()
    })
    
    if (msg.from === myPeerId) {
      console.log('🎯 SELF-MESSAGE detected! emitSelf is working!')
    }
  }
  
  libp2p.services.pubsub.subscribe(testTopic, messageHandler)
  
  // Wait a moment for subscription to register
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Publish test messages
  console.log('📤 Publishing test messages...')
  
  for (let i = 1; i <= 3; i++) {
    const message = JSON.stringify({
      test: i,
      timestamp: new Date().toISOString(),
      peerId: libp2p.peerId.toString(),
      message: `Test message ${i}`
    })
    
    console.log(`📤 Publishing message ${i}...`)
    await libp2p.services.pubsub.publish(testTopic, uint8ArrayFromString(message))
    
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  
  // Wait for message delivery
  console.log('⏳ Waiting for message delivery...')
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  // Results summary
  const selfMessages = receivedMessages.filter(m => m.isSelf)
  const otherMessages = receivedMessages.filter(m => !m.isSelf)
  
  console.log('📊 TEST RESULTS:')
  console.log(`  - Messages published: 3`)
  console.log(`  - Messages received: ${messageCount}`)
  console.log(`  - Self-messages received: ${selfMessages.length}`)
  console.log(`  - Other-messages received: ${otherMessages.length}`)
  
  if (selfMessages.length === 3) {
    console.log('✅ SUCCESS: All self-messages received! emitSelf is working correctly.')
  } else if (selfMessages.length > 0) {
    console.log('⚠️  PARTIAL: Some self-messages received, but not all.')
  } else {
    console.log('❌ PROBLEM: No self-messages received. emitSelf might not be working.')
  }
  
  // Cleanup
  libp2p.services.pubsub.unsubscribe(testTopic, messageHandler)
  console.log('🧹 Test complete, unsubscribed from test topic.')
  
  return {
    published: 3,
    received: messageCount,
    selfMessages: selfMessages.length,
    otherMessages: otherMessages.length,
    success: selfMessages.length === 3
  }
}
