/**
 * Database Health Check and Recovery Utility
 * Diagnoses and repairs corrupted Helia/OrbitDB instances
 */

import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { createHelia } from 'helia'
import { createOrbitDB } from '@orbitdb/core'

export class DatabaseHealthChecker {
    constructor() {
        this.healthChecks = []
        this.recoveryActions = []
    }

    /**
     * Comprehensive database health check
     * @param {Object} options - Check options
     * @returns {Promise<Object>} Health report
     */
    async checkDatabaseHealth(options = {}) {
        const {
            libp2p = null,
            helia = null,
            orbitdb = null,
            todoDB = null,
            verbose = true
        } = options

        const report = {
            timestamp: new Date().toISOString(),
            overall: 'unknown',
            checks: {},
            recommendations: [],
            errors: []
        }

        if (verbose) console.log('🏥 Starting comprehensive database health check...')

        // Check 1: LibP2P Health
        report.checks.libp2p = await this.checkLibP2PHealth(libp2p)

        // Check 2: Helia Health  
        report.checks.helia = await this.checkHeliaHealth(helia)

        // Check 3: OrbitDB Health
        report.checks.orbitdb = await this.checkOrbitDBHealth(orbitdb)

        // Check 4: Todo Database Health
        report.checks.todoDB = await this.checkTodoDBHealth(todoDB)

        // Check 5: Storage Health
        report.checks.storage = await this.checkStorageHealth()

        // Check 6: Memory Health
        report.checks.memory = await this.checkMemoryHealth()

        // Generate overall status and recommendations
        this.generateOverallStatus(report)
        this.generateRecommendations(report)

        if (verbose) {
            console.log('🏥 Health check complete:', {
                overall: report.overall,
                issues: report.errors.length,
                recommendations: report.recommendations.length
            })
        }

        return report
    }

    /**
     * Check LibP2P node health
     */
    async checkLibP2PHealth(libp2p) {
        const check = {
            status: 'unknown',
            details: {},
            errors: []
        }

        try {
            if (!libp2p) {
                check.status = 'missing'
                check.errors.push('LibP2P instance is null or undefined')
                return check
            }

            // Check if node is started
            if (!libp2p.isStarted()) {
                check.status = 'stopped'
                check.errors.push('LibP2P node is not started')
                return check
            }

            // Check peer connections
            const peers = libp2p.getPeers()
            check.details.connectedPeers = peers.length
            check.details.peerId = libp2p.peerId.toString()

            // Check services
            const services = Object.keys(libp2p.services || {})
            check.details.services = services

            // Check addresses
            const multiaddrs = libp2p.getMultiaddrs()
            check.details.addresses = multiaddrs.map(addr => addr.toString())

            check.status = 'healthy'
            
        } catch (error) {
            check.status = 'error'
            check.errors.push(`LibP2P error: ${error.message}`)
        }

        return check
    }

    /**
     * Check Helia IPFS health
     */
    async checkHeliaHealth(helia) {
        const check = {
            status: 'unknown',
            details: {},
            errors: []
        }

        try {
            if (!helia) {
                check.status = 'missing'
                check.errors.push('Helia instance is null or undefined')
                return check
            }

            // Check if Helia is started
            if (!helia.libp2p.isStarted()) {
                check.status = 'stopped'
                check.errors.push('Helia libp2p is not started')
                return check
            }

            // Test basic operations
            const testData = new TextEncoder().encode('health-check-test')
            try {
                const cid = await helia.blockstore.put(testData)
                const retrieved = await helia.blockstore.get(cid)
                
                if (!retrieved || retrieved.length !== testData.length) {
                    throw new Error('Blockstore read/write test failed')
                }
                
                check.details.blockstoreTest = 'passed'
            } catch (blockError) {
                check.errors.push(`Blockstore test failed: ${blockError.message}`)
            }

            // Check datastore
            try {
                const testKey = '/health-check-test'
                const testValue = new TextEncoder().encode('test-value')
                
                await helia.datastore.put(testKey, testValue)
                const retrievedValue = await helia.datastore.get(testKey)
                
                if (!retrievedValue || retrievedValue.length !== testValue.length) {
                    throw new Error('Datastore read/write test failed')
                }
                
                await helia.datastore.delete(testKey)
                check.details.datastoreTest = 'passed'
            } catch (dataError) {
                check.errors.push(`Datastore test failed: ${dataError.message}`)
            }

            check.status = check.errors.length === 0 ? 'healthy' : 'degraded'
            
        } catch (error) {
            check.status = 'error'
            check.errors.push(`Helia error: ${error.message}`)
        }

        return check
    }

    /**
     * Check OrbitDB health
     */
    async checkOrbitDBHealth(orbitdb) {
        const check = {
            status: 'unknown',
            details: {},
            errors: []
        }

        try {
            if (!orbitdb) {
                check.status = 'missing'
                check.errors.push('OrbitDB instance is null or undefined')
                return check
            }

            // Check basic properties
            check.details.id = orbitdb.id
            check.details.directory = orbitdb.directory

            // List open databases
            try {
                const openDatabases = Object.keys(orbitdb.databases || {})
                check.details.openDatabases = openDatabases
                check.details.databaseCount = openDatabases.length
            } catch (listError) {
                check.errors.push(`Failed to list databases: ${listError.message}`)
            }

            check.status = check.errors.length === 0 ? 'healthy' : 'degraded'
            
        } catch (error) {
            check.status = 'error'
            check.errors.push(`OrbitDB error: ${error.message}`)
        }

        return check
    }

    /**
     * Check specific Todo database health
     */
    async checkTodoDBHealth(todoDB) {
        const check = {
            status: 'unknown',
            details: {},
            errors: []
        }

        try {
            if (!todoDB) {
                check.status = 'missing'
                check.errors.push('Todo database is null or undefined')
                return check
            }

            // Check database properties
            check.details.address = todoDB.address
            check.details.type = todoDB.type
            check.details.identity = todoDB.identity?.id

            // Test basic operations
            try {
                // Try to read all entries
                const allEntries = await todoDB.all()
                check.details.entryCount = Object.keys(allEntries || {}).length
                check.details.readTest = 'passed'
            } catch (readError) {
                check.errors.push(`Database read test failed: ${readError.message}`)
            }

            try {
                // Try to write a test entry
                const testKey = `health-check-${Date.now()}`
                const testValue = { test: true, timestamp: new Date().toISOString() }
                
                await todoDB.set(testKey, testValue)
                const retrieved = await todoDB.get(testKey)
                
                if (!retrieved || retrieved.test !== true) {
                    throw new Error('Test entry was not properly stored/retrieved')
                }
                
                // Clean up test entry
                await todoDB.delete(testKey)
                check.details.writeTest = 'passed'
            } catch (writeError) {
                check.errors.push(`Database write test failed: ${writeError.message}`)
            }

            check.status = check.errors.length === 0 ? 'healthy' : 'degraded'
            
        } catch (error) {
            check.status = 'error'
            check.errors.push(`Todo database error: ${error.message}`)
        }

        return check
    }

    /**
     * Check storage health
     */
    async checkStorageHealth() {
        const check = {
            status: 'unknown',
            details: {},
            errors: []
        }

        try {
            // Check localStorage availability
            if (typeof window !== 'undefined' && window.localStorage) {
                try {
                    const testKey = 'health-check-storage'
                    const testValue = JSON.stringify({ timestamp: Date.now() })
                    
                    localStorage.setItem(testKey, testValue)
                    const retrieved = localStorage.getItem(testKey)
                    localStorage.removeItem(testKey)
                    
                    if (retrieved !== testValue) {
                        throw new Error('localStorage read/write test failed')
                    }
                    
                    check.details.localStorage = 'available'
                } catch (storageError) {
                    check.errors.push(`localStorage error: ${storageError.message}`)
                }
            } else {
                check.details.localStorage = 'not available'
            }

            // Check IndexedDB availability
            if (typeof window !== 'undefined' && window.indexedDB) {
                check.details.indexedDB = 'available'
            } else {
                check.details.indexedDB = 'not available'
            }

            check.status = check.errors.length === 0 ? 'healthy' : 'degraded'
            
        } catch (error) {
            check.status = 'error'
            check.errors.push(`Storage error: ${error.message}`)
        }

        return check
    }

    /**
     * Check memory health
     */
    async checkMemoryHealth() {
        const check = {
            status: 'healthy',
            details: {},
            errors: []
        }

        try {
            // Check memory usage if available
            if (typeof performance !== 'undefined' && performance.memory) {
                const memory = performance.memory
                check.details.usedJSHeapSize = memory.usedJSHeapSize
                check.details.totalJSHeapSize = memory.totalJSHeapSize
                check.details.jsHeapSizeLimit = memory.jsHeapSizeLimit
                check.details.memoryPressure = (memory.usedJSHeapSize / memory.jsHeapSizeLimit * 100).toFixed(2) + '%'
                
                // Warn if memory usage is high
                if (memory.usedJSHeapSize / memory.jsHeapSizeLimit > 0.9) {
                    check.errors.push('High memory pressure detected')
                    check.status = 'warning'
                }
            } else {
                check.details.memoryInfo = 'not available'
            }
        } catch (error) {
            check.errors.push(`Memory check error: ${error.message}`)
        }

        return check
    }

    /**
     * Generate overall health status
     */
    generateOverallStatus(report) {
        const checks = Object.values(report.checks)
        const hasErrors = checks.some(check => check.status === 'error')
        const hasDegraded = checks.some(check => check.status === 'degraded' || check.status === 'warning')
        const hasMissing = checks.some(check => check.status === 'missing')

        if (hasErrors || hasMissing) {
            report.overall = 'critical'
        } else if (hasDegraded) {
            report.overall = 'degraded'
        } else {
            report.overall = 'healthy'
        }

        // Collect all errors
        checks.forEach(check => {
            report.errors.push(...check.errors)
        })
    }

    /**
     * Generate recovery recommendations
     */
    generateRecommendations(report) {
        const recommendations = []

        // Check for missing components
        if (report.checks.libp2p?.status === 'missing') {
            recommendations.push('Initialize LibP2P node')
        }
        if (report.checks.helia?.status === 'missing') {
            recommendations.push('Initialize Helia IPFS node')
        }
        if (report.checks.orbitdb?.status === 'missing') {
            recommendations.push('Initialize OrbitDB instance')
        }
        if (report.checks.todoDB?.status === 'missing') {
            recommendations.push('Open Todo database')
        }

        // Check for stopped services
        if (report.checks.libp2p?.status === 'stopped') {
            recommendations.push('Start LibP2P node')
        }
        if (report.checks.helia?.status === 'stopped') {
            recommendations.push('Start Helia IPFS node')
        }

        // Check for storage issues
        if (report.checks.storage?.errors?.length > 0) {
            recommendations.push('Clear browser storage and restart application')
        }

        // Check for memory issues
        if (report.checks.memory?.status === 'warning') {
            recommendations.push('Refresh page to free memory')
        }

        // Check for database corruption
        if (report.checks.todoDB?.errors?.some(err => err.includes('read test failed'))) {
            recommendations.push('Database may be corrupted - consider clearing OrbitDB directory')
        }

        if (report.checks.todoDB?.errors?.some(err => err.includes('write test failed'))) {
            recommendations.push('Database write access blocked - check permissions and storage')
        }

        // Add generic recommendations for critical state
        if (report.overall === 'critical') {
            recommendations.push('Consider full application reset and database recreation')
        }

        report.recommendations = recommendations
    }

    /**
     * Attempt automatic recovery
     */
    async attemptRecovery(report, options = {}) {
        const { aggressive = false, verbose = true } = options
        const actions = []

        if (verbose) console.log('🔧 Attempting automatic recovery...')

        try {
            // Clear corrupted storage
            if (report.checks.storage?.errors?.length > 0) {
                this.clearBrowserStorage()
                actions.push('Cleared browser storage')
            }

            // Clear OrbitDB cache if database is corrupted
            if (report.checks.todoDB?.errors?.some(err => err.includes('failed'))) {
                this.clearOrbitDBCache()
                actions.push('Cleared OrbitDB cache')
            }

            // Force garbage collection if memory pressure is high
            if (report.checks.memory?.status === 'warning' && typeof window !== 'undefined' && window.gc) {
                window.gc()
                actions.push('Triggered garbage collection')
            }

            if (verbose && actions.length > 0) {
                console.log('🔧 Recovery actions taken:', actions)
            }

        } catch (error) {
            console.error('❌ Recovery attempt failed:', error)
        }

        return actions
    }

    /**
     * Clear browser storage
     */
    clearBrowserStorage() {
        if (typeof window === 'undefined') return

        try {
            // Clear localStorage
            if (window.localStorage) {
                window.localStorage.clear()
            }
            
            // Clear sessionStorage
            if (window.sessionStorage) {
                window.sessionStorage.clear()
            }
            
            console.log('🧹 Cleared browser storage')
        } catch (error) {
            console.warn('Failed to clear storage:', error)
        }
    }

    /**
     * Clear OrbitDB-specific cache
     */
    clearOrbitDBCache() {
        if (typeof window === 'undefined' || !window.localStorage) return

        try {
            const keys = Object.keys(window.localStorage)
            const orbitKeys = keys.filter(key => 
                key.includes('orbitdb') || 
                key.includes('libp2p') || 
                key.includes('helia')
            )
            
            orbitKeys.forEach(key => {
                window.localStorage.removeItem(key)
            })
            
            console.log('🧹 Cleared OrbitDB cache keys:', orbitKeys.length)
        } catch (error) {
            console.warn('Failed to clear OrbitDB cache:', error)
        }
    }
}

// Export singleton instance
export const dbHealthChecker = new DatabaseHealthChecker()

// Convenience functions
export async function runHealthCheck(components = {}) {
    return dbHealthChecker.checkDatabaseHealth(components)
}

export async function runHealthCheckAndRecover(components = {}, recoveryOptions = {}) {
    const report = await dbHealthChecker.checkDatabaseHealth(components)
    const actions = await dbHealthChecker.attemptRecovery(report, recoveryOptions)
    
    return {
        healthReport: report,
        recoveryActions: actions,
        needsFullReset: report.overall === 'critical'
    }
}
