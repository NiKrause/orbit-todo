#!/usr/bin/env node

/**
 * Example demonstrating how to use the storage pattern from the orbit-blog reference
 * in your own applications for persistent private key management
 */

import { initializeStorage, closeStorage } from '../relay/services/storage.js'
import { config } from 'dotenv'

// Load environment variables
config()

async function main() {
  console.log('🧪 Storage Pattern Example')
  console.log('========================\n')
  
  try {
    // Example 1: Development mode with fixed private key
    console.log('1️⃣ Development Mode (with fixed private key)')
    const devStorage = await initializeStorage(
      './example-dev-storage',
      true, // isDevMode = true
      process.env.VITE_TEST_PEER_ID // Use the same key as browser for consistency
    )
    console.log('   Peer ID:', devStorage.privateKey.publicKey.toString())
    console.log('   Storage dir: ./example-dev-storage\n')
    
    // Clean up
    await closeStorage(devStorage)
    
    // Example 2: Production mode with persistent auto-generated key
    console.log('2️⃣ Production Mode (persistent auto-generated key)')
    const prodStorage = await initializeStorage(
      './example-prod-storage',
      false // isDevMode = false, no fixed key provided
    )
    console.log('   Peer ID:', prodStorage.privateKey.publicKey.toString())
    console.log('   Storage dir: ./example-prod-storage')
    console.log('   (This key will be the same every time you run this example)\n')
    
    // Clean up
    await closeStorage(prodStorage)
    
    console.log('✅ Storage pattern examples completed successfully!')
    console.log('\nKey Benefits:')
    console.log('- 🔐 Persistent identity across restarts')
    console.log('- 🛠️ Fixed keys in development for predictable testing') 
    console.log('- 🗄️ Persistent datastore and blockstore')
    console.log('- 🧹 Graceful shutdown handling')
    
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Example interrupted')
  process.exit(0)
})

main().catch(console.error)
