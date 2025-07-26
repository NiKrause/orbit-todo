import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { createHelia } from 'helia'
import PQueue from 'p-queue'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'

export class PinningService {
  constructor(options = {}) {
    this.allowedIdentities = new Set()
    this.pinnedDatabases = new Map() // Map of dbAddress -> { db, metadata }
    this.syncQueue = new PQueue({ concurrency: 2 })
    this.updateTimers = new Map() // Debouncing timers for update events
    this.metrics = {
      totalPinned: 0,
      syncOperations: 0,
      failedSyncs: 0
    }
    
    // Logging configuration
    this.logLevel = options.logLevel || 'info' // 'debug', 'info', 'warn', 'error'
    this.verboseLogging = options.verboseLogging || false
    
    // Load allowed identities from environment
    this.loadAllowedIdentities()
    
    this.log('📌 PinningService initialized', 'info')
    if (this.allowedIdentities.size > 0) {
      this.log(`   - Allowed identities: ${this.allowedIdentities.size}`, 'info')
    }
  }

  /**
   * Load allowed identity IDs from environment variables
   */
  loadAllowedIdentities() {
    // Support multiple environment variable formats
    const identityVars = [
      'PINNING_ALLOWED_IDENTITIES',
      'ORBITDB_ALLOWED_IDENTITIES', 
      'ALLOWED_PEER_IDS',
      'PINNING_IDENTITY_FILTER'
    ]
    
    for (const varName of identityVars) {
      const envValue = process.env[varName]
      if (envValue) {
        const identities = envValue.split(',').map(id => id.trim()).filter(Boolean)
        identities.forEach(id => this.allowedIdentities.add(id))
        this.log(`📋 Loaded ${identities.length} identities from ${varName}`, 'debug')
      }
    }
    
    // If no specific pinning identities are configured, warn the user
    if (this.allowedIdentities.size === 0) {
      this.log('⚠️  No identity filters configured. All OrbitDB databases will be pinned!', 'warn')
      this.log('   Set PINNING_ALLOWED_IDENTITIES in .env to filter by identity IDs', 'warn')
    }
  }

  /**
   * Initialize the pinning service with libp2p and IPFS
   */
  async initialize(libp2p, datastore, blockstore) {
    this.libp2p = libp2p
    
    // Create Helia (IPFS) instance
    this.helia = await createHelia({ 
      libp2p, 
      datastore, 
      blockstore 
    })
    
    // Create OrbitDB instance with access controllers registered
    this.orbitdb = await createOrbitDB({ 
      ipfs: this.helia,
    })
    
    this.log('✅ PinningService initialized with OrbitDB', 'info')
  }

  /**
   * Check if a database identity should be pinned
   */
  shouldPinDatabase(identityId) {
    // If no filters configured, pin everything (with warning)
    if (this.allowedIdentities.size === 0) {
      return true
    }
    
    return this.allowedIdentities.has(identityId)
  }

  /**
   * Enhanced record counting for OrbitDB 3.0
   */
  async getRecordCount(db) {
    try {
      const dbType = this.getDatabaseType(db)
      this.log(`🔍 Counting records for ${db.name}`, 'debug')
      
      // For events databases, use iterator approach
      if (dbType === 'events' && typeof db.iterator === 'function') {
        try {
          let count = 0
          const iterator = db.iterator()
          for await (const entry of iterator) {
            count++
            // Limit to prevent infinite loops
            if (count > 10000) {
              this.log(`⚠️  Reached count limit of 10000 for ${db.name}`, 'warn')
              break
            }
          }
          this.log(`📊 ${db.name}: ${count} entries`, 'debug')
          return count
        } catch (iterError) {
          this.log(`⚠️  Iterator failed for ${db.name}, trying all() method`, 'debug')
        }
      }
      
      // Try the all() method as fallback or for other database types
      const records = await db.all()
      
      // Handle different return types from all()
      if (Array.isArray(records)) {
        this.log(`📊 ${db.name}: ${records.length} items`, 'debug')
        return records.length
      } else if (records && typeof records === 'object') {
        // For key-value stores or object-based returns
        const keyCount = Object.keys(records).length
        this.log(`📊 ${db.name}: ${keyCount} keys`, 'debug')
        return keyCount
      } else if (records === null || records === undefined) {
        this.log(`📊 ${db.name}: empty`, 'debug')
        return 0
      } else {
        // Check if it's an iterator or has Symbol.iterator
        if (records && typeof records[Symbol.iterator] === 'function') {
          try {
            let count = 0
            for (const entry of records) {
              count++
              if (count > 10000) break // Safety limit
            }
            this.log(`📊 ${db.name}: ${count} items`, 'debug')
            return count
          } catch (iterError) {
            this.log(`⚠️  Failed to iterate over records for ${db.name}`, 'debug')
          }
        }
        
        this.log(`⚠️  Unexpected records structure for ${db.name}: ${typeof records}`, 'debug')
        return 0
      }
    } catch (error) {
      this.log(`❌ Error counting records for ${db.name}: ${error.message}`, 'error')
      return 0
    }
  }

  /**
   * Enhanced database type detection for OrbitDB 3.0
   */
  getDatabaseType(db) {
    try {
      // Check multiple properties to determine type
      if (db.type) {
        return db.type
      }
      return 'unknown'
    } catch (error) {
      this.log(`❌ Error detecting database type for ${db.name}: ${error.message}`, 'error')
      return 'unknown'
    }
  }

  /**
   * Get full identity information
   */
  getIdentityInfo(db) {
    try {
      const identity = db.identity
      if (!identity) {
        return { id: null, fullId: null, publicKey: null, type: null }
      }
      
      return {
        id: identity.id,
        fullId: identity.id, // Full ID without truncation
        publicKey: identity.publicKey ? identity.publicKey.toString() : null,
        type: identity.type || 'unknown',
        hash: identity.hash || null
      }
    } catch (error) {
      this.log(`❌ Error extracting identity info: ${error.message}`, 'error')
      return { id: null, fullId: null, publicKey: null, type: null }
    }
  }

  /**
   * Enhanced database inspection for debugging
   */
  async inspectDatabase(db) {
    const inspection = {
      name: db.name,
      address: db.address,
      opened: db.opened || false,
      writable: db.access?.write || false,
      methods: Object.getOwnPropertyNames(db).filter(prop => typeof db[prop] === 'function'),
      protoMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(db)).filter(prop => typeof db[prop] === 'function'),
      properties: Object.getOwnPropertyNames(db).filter(prop => typeof db[prop] !== 'function')
    }
    
    if (this.verboseLogging) {
      this.log(`🔍 Database inspection for ${db.name}:`, 'debug')
      this.log(`   - Methods: ${inspection.methods.join(', ')}`, 'debug')
      this.log(`   - Properties: ${inspection.properties.join(', ')}`, 'debug')
    }
    
    return inspection
  }

  /**
   * Wait for database to be ready and potentially for peers to join
   */
  async waitForDatabaseReady(db, timeoutMs = 3000) {
    const startTime = Date.now()
    const dbType = this.getDatabaseType(db)
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.log(`⏰ Timeout waiting for database ${db.name} to be ready`, 'debug')
        resolve(false) // Don't reject, just indicate it's not ready
      }, timeoutMs)
      
      // For keyvalue databases that are already opened, they might be ready immediately
      if (dbType === 'keyvalue' && db.opened) {
        this.log(`📋 Keyvalue database ${db.name} is already opened`, 'debug')
        // Give a short grace period for potential peer connections
        setTimeout(() => {
          if (db.peers?.length > 0) {
            this.log(`✅ Database ${db.name} found peers: ${db.peers.length}`, 'debug')
            clearTimeout(timeout)
            resolve(true)
          } else {
            this.log(`🔄 Database ${db.name} has no peers but is opened - proceeding`, 'debug')
            clearTimeout(timeout)
            resolve(true)
          }
        }, 500) // 500ms grace period
        return
      }
      
      // If database already has peers, resolve immediately
      if (db.peers?.length > 0) {
        this.log(`✅ Database ${db.name} already has ${db.peers.length} peers`, 'debug')
        clearTimeout(timeout)
        resolve(true)
        return
      }
      
      let hasResolved = false
      
      // Listen for ready event
      const onReady = () => {
        if (hasResolved) return
        hasResolved = true
        const elapsed = Date.now() - startTime
        this.log(`🎯 Database ${db.name} ready after ${elapsed}ms`, 'debug')
        db.events.off('ready', onReady)
        db.events.off('update', onUpdate)
        db.events.off('join', onJoin)
        clearTimeout(timeout)
        resolve(true)
      }
      
      // Listen for update events (might indicate activity)
      const onUpdate = () => {
        if (hasResolved) return
        hasResolved = true
        const elapsed = Date.now() - startTime
        this.log(`📝 Database ${db.name} update after ${elapsed}ms`, 'debug')
        db.events.off('ready', onReady)
        db.events.off('update', onUpdate)
        db.events.off('join', onJoin)
        clearTimeout(timeout)
        resolve(true)
      }
      
      // Listen for peer joins
      const onJoin = (peer) => {
        if (hasResolved) return
        hasResolved = true
        const elapsed = Date.now() - startTime
        const peerStr = typeof peer === 'string' ? peer : peer?.toString() || 'unknown'
        this.log(`👤 Peer joined ${db.name} after ${elapsed}ms: ${peerStr.slice(0, 8)}...`, 'debug')
        
        db.events.off('ready', onReady)
        db.events.off('update', onUpdate)
        db.events.off('join', onJoin)
        clearTimeout(timeout)
        resolve(true)
      }
      
      db.events.on('ready', onReady)
      db.events.on('update', onUpdate)
      db.events.on('join', onJoin)
    })
  }

  /**
   * Sync and pin an OrbitDB database
   */
  async syncAndPinDatabase(dbAddress) {
    this.log(`🔄 Starting sync for database: ${dbAddress}`, 'info')
    this.metrics.syncOperations++
    
    try {
      // Open the database with proper access controller configuration
      const db = await this.orbitdb.open(dbAddress)
      
      this.log(`📂 Database opened: ${db.name}`, 'debug')
      
      // Get basic database information first
      const identityInfo = this.getIdentityInfo(db)
      const dbType = this.getDatabaseType(db)
      
      // Enhanced identity logging with full ID
      if (!identityInfo.id) {
        this.log(`⚠️  Database ${db.name} has no identity ID, skipping`, 'warn')
        await db.close()
        return
      }
      
      if (!this.shouldPinDatabase(identityInfo.id)) {
        this.log(`🚫 Database ${db.name} identity ${identityInfo.id.slice(0, 8)}... not in allowed list, skipping`, 'debug')
        await db.close()
        return
      }
      
      // Wait for database to be ready and for potential peer joins
      this.log(`⏳ Waiting for database ${db.name} to be ready...`, 'debug')
      const isReady = await this.waitForDatabaseReady(db, 3000)
      
      if (isReady) {
        this.log(`✅ Database ${db.name} is ready`, 'debug')
      } else {
        this.log(`⚠️  Database ${db.name} readiness timeout, but proceeding`, 'debug')
      }
      
      // Now count records after waiting for readiness
      const recordCount = await this.getRecordCount(db)
      
      // Create enhanced database metadata
      const metadata = {
        name: db.name,
        type: dbType,
        address: dbAddress,
        identityId: identityInfo.id,
        fullIdentityId: identityInfo.fullId,
        identityType: identityInfo.type,
        publicKey: identityInfo.publicKey,
        recordCount,
        lastSynced: new Date().toISOString(),
        syncCount: 1,
        opened: db.opened || false,
        writable: db.access?.write || false
      }
      
      // Store database reference and metadata
      if (this.pinnedDatabases.has(dbAddress)) {
        const existing = this.pinnedDatabases.get(dbAddress)
        metadata.syncCount = (existing.metadata?.syncCount || 0) + 1
        // Close previous instance if it exists
        if (existing.db && existing.db !== db) {
          try {
            await existing.db.close()
          } catch (error) {
            this.log(`⚠️  Error closing previous database instance: ${error.message}`, 'warn')
          }
        }
      } else {
        this.metrics.totalPinned++
      }
      
      this.pinnedDatabases.set(dbAddress, { db, metadata })
      
      // Set up event listeners for future updates
      this.setupDatabaseListeners(db, dbAddress, metadata)
      
      // Enhanced logging with full information
      this.log(`✅ Pinned database: ${db.name}`, 'info')
      this.log(`   - Identity: ${identityInfo.id.slice(0, 8)}...`, 'debug')
      this.log(`   - Records: ${recordCount}`, 'debug')
      this.log(`   - Type: ${dbType}`, 'debug')
      this.log(`   - Sync count: ${metadata.syncCount}`, 'debug')
      
      return metadata
      
    } catch (error) {
      this.metrics.failedSyncs++
      this.log(`❌ Error syncing database ${dbAddress}: ${error.message}`, 'error')
      throw error
    }
  }

  /**
   * Set up event listeners for a database
   */
  setupDatabaseListeners(db, dbAddress, metadata) {
    // Handle database updates with debouncing
    db.events.on('update', async () => {
      this.log(`🔄 Database updated: ${db.name}`, 'debug')
      
      // Clear existing timer if it exists
      if (this.updateTimers.has(dbAddress)) {
        clearTimeout(this.updateTimers.get(dbAddress))
      }
      
      // Set a new timer to debounce multiple rapid updates
      const timer = setTimeout(async () => {
        try {
          // Use enhanced record counting
          const newRecordCount = await this.getRecordCount(db)
          metadata.recordCount = newRecordCount
          metadata.lastSynced = new Date().toISOString()
          metadata.syncCount++
          
          this.log(`📊 Database ${db.name} updated: ${newRecordCount} records (sync #${metadata.syncCount})`, 'debug')
          
          // Clean up the timer
          this.updateTimers.delete(dbAddress)
        } catch (error) {
          this.log(`❌ Error processing update for ${db.name}: ${error.message}`, 'error')
        }
      }, 500) // 500ms debounce delay
      
      this.updateTimers.set(dbAddress, timer)
    })
    
    // Handle database errors
    db.events.on('error', async (error) => {
      this.log(`❌ Database error in ${db.name}: ${error.message}`, 'error')
    })
    
    // Handle peer joins with enhanced logging  
    db.events.on('join', async (peer) => {
      const peerStr = typeof peer === 'string' ? peer : peer?.toString() || 'unknown'
      this.log(`👤 Peer joined ${db.name}: ${peerStr.slice(0, 8)}...`, 'debug')
    })

    db.events.on('write', async (address, entry) => {
      this.log(`✍️  Write event in ${db.name}: ${address}`, 'debug')
    })
  }

  /**
   * Handle subscription change events
   */
  async handleSubscriptionChange(topic) {
    if (!topic || !topic.startsWith('/orbitdb/')) {
      return
    }
    
    this.log(`📡 Subscription change detected: ${topic}`, 'debug')
    
    // Queue the sync operation
    this.syncQueue.add(() => this.syncAndPinDatabase(topic))
  }

  /**
   * Handle pubsub message events
   */
  async handlePubsubMessage(message) {
    const topic = message.topic
    if (!topic || !topic.startsWith('/orbitdb/')) {
      return
    }
    
    this.log(`💬 OrbitDB message received on topic: ${topic}`, 'debug')
    await this.handleSubscriptionChange(topic)
  }

  /**
   * Get pinning statistics
   */
  getStats() {
    return {
      totalPinned: this.metrics.totalPinned,
      syncOperations: this.metrics.syncOperations,
      failedSyncs: this.metrics.failedSyncs,
      allowedIdentities: this.allowedIdentities.size,
      queueSize: this.syncQueue.size,
      queuePending: this.syncQueue.pending
    }
  }

  /**
   * Get list of pinned databases
   */
  getPinnedDatabases() {
    const databases = []
    for (const [address, { metadata }] of this.pinnedDatabases) {
      databases.push({
        address,
        ...metadata
      })
    }
    return databases
  }

  /**
   * Cleanup and close all pinned databases
   */
  async cleanup() {
    this.log('🧹 Cleaning up PinningService...', 'info')
    
    // Clear all update timers
    for (const timer of this.updateTimers.values()) {
      clearTimeout(timer)
    }
    this.updateTimers.clear()
    
    // Close all pinned databases
    const closePromises = []
    for (const [address, { db }] of this.pinnedDatabases) {
      if (db) {
        closePromises.push(
          db.close().catch(error => 
            this.log(`⚠️  Error closing database ${address}: ${error.message}`, 'warn')
          )
        )
      }
    }
    
    await Promise.allSettled(closePromises)
    this.pinnedDatabases.clear()
    
    // Close OrbitDB and Helia
    if (this.orbitdb) {
      try {
        await this.orbitdb.stop()
      } catch (error) {
        this.log(`⚠️  Error stopping OrbitDB: ${error.message}`, 'warn')
      }
    }
    
    if (this.helia) {
      try {
        await this.helia.stop()
      } catch (error) {
        this.log(`⚠️  Error stopping Helia: ${error.message}`, 'warn')
      }
    }
    
    this.log('✅ PinningService cleanup completed', 'info')
  }

  /**
   * Manual database sync for testing
   */
  async manualSync(dbAddress) {
    this.log(`🔧 Manual sync requested for: ${dbAddress}`, 'info')
    try {
      const result = await this.syncAndPinDatabase(dbAddress)
      this.log(`✅ Manual sync completed for: ${dbAddress}`, 'info')
      return result
    } catch (error) {
      this.log(`❌ Manual sync failed for ${dbAddress}: ${error.message}`, 'error')
      throw error
    }
  }

  /**
   * Get detailed database information
   */
  async getDatabaseInfo(dbAddress) {
    const pinnedDB = this.pinnedDatabases.get(dbAddress)
    if (!pinnedDB) {
      return { error: 'Database not pinned' }
    }

    const { db, metadata } = pinnedDB
    const currentRecordCount = await this.getRecordCount(db)
    const identityInfo = this.getIdentityInfo(db)
    const inspection = await this.inspectDatabase(db)

    return {
      ...metadata,
      currentRecordCount,
      identityInfo,
      inspection,
      isOpen: db.opened || false,
      lastChecked: new Date().toISOString()
    }
  }

  /**
   * List all available databases from OrbitDB directory (if accessible)
   */
  async listAvailableDatabases() {
    try {
      // This might not be available in OrbitDB 3.0, but worth trying
      if (this.orbitdb && typeof this.orbitdb.directory === 'function') {
        const databases = await this.orbitdb.directory()
        this.log(`📋 Found ${databases.length} databases in OrbitDB directory`, 'debug')
        return databases
      } else {
        this.log(`⚠️  OrbitDB directory method not available`, 'debug')
        return []
      }
    } catch (error) {
      this.log(`❌ Error listing available databases: ${error.message}`, 'error')
      return []
    }
  }

  /**
   * Force refresh all pinned databases
   */
  async refreshAllDatabases() {
    this.log(`🔄 Refreshing all ${this.pinnedDatabases.size} pinned databases...`, 'info')
    const refreshPromises = []
    
    for (const [dbAddress, { metadata }] of this.pinnedDatabases) {
      refreshPromises.push(
        this.syncAndPinDatabase(dbAddress)
          .then(result => ({ address: dbAddress, success: true, result }))
          .catch(error => ({ address: dbAddress, success: false, error: error.message }))
      )
    }
    
    const results = await Promise.allSettled(refreshPromises)
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
    const failed = results.length - successful
    
    this.log(`✅ Refresh completed: ${successful} successful, ${failed} failed`, 'info')
    return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason })
  }

  /**
   * Get comprehensive service status
   */
  getDetailedStats() {
    const basicStats = this.getStats()
    const databases = this.getPinnedDatabases()
    
    return {
      ...basicStats,
      databases,
      systemInfo: {
        nodeEnv: process.env.NODE_ENV,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        pid: process.pid
      },
      orbitdbInfo: {
        initialized: !!this.orbitdb,
        heliaInitialized: !!this.helia
      },
      queueInfo: {
        size: this.syncQueue.size,
        pending: this.syncQueue.pending,
        isPaused: this.syncQueue.isPaused
      },
      timers: {
        activeUpdateTimers: this.updateTimers.size
      }
    }
  }

  /**
   * Enhanced logging method with levels
   */
  log(message, level = 'info') {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 }
    const currentLevel = levels[this.logLevel] || 1
    
    if (levels[level] >= currentLevel) {
      const timestamp = new Date().toISOString()
      const prefix = level === 'error' ? '❌' : 
                    level === 'warn' ? '⚠️' : 
                    level === 'info' ? 'ℹ️' : '📌'
      console.log(`[${timestamp}] [PinningService] ${prefix} ${message}`)
    }
  }
}
