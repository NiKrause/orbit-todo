/**
 * DatabaseManager - Manages browser database operations
 * Handles IndexedDB database analysis, viewing, and deletion operations
 */
export class DatabaseManager {
  constructor(toastService, formatBytes) {
    this.toastService = toastService;
    this.formatBytes = formatBytes;
  }

  /**
   * Refresh and analyze all P2P-related databases
   * @param {Function} getTodoDbAddress - Get current todo database address
   * @param {Function} getTodoDbName - Get current todo database name
   * @returns {Promise<Object>} Database analysis results
   */
  async refreshDatabases(getTodoDbAddress, getTodoDbName) {
    try {
      console.log('🔄 Refreshing databases...');

      if (!indexedDB.databases) {
        console.warn('indexedDB.databases() not supported in this browser');
        this.toastService.show('Database enumeration not supported in this browser');
        return { browserDatabases: [], storageUsage: null };
      }

      // Get storage information
      const storageInfo = await this.getStorageInfo();

      // Get all databases
      const allDatabases = await indexedDB.databases();
      console.log('📊 All databases found:', allDatabases);

      // Get currently active database information
      const currentDbAddress = getTodoDbAddress();
      const currentDbName = getTodoDbName();

      console.log('🎯 Current active databases:', {
        orbitDbAddress: currentDbAddress,
        orbitDbName: currentDbName
      });

      // Filter P2P-related databases
      const p2pDatabases = this.filterP2PDatabases(allDatabases);

      // Enhance databases with metadata
      const enhancedDatabases = await this.enhanceDatabases(p2pDatabases, currentDbAddress, currentDbName);

      // Sort databases: active ones first, then by name
      enhancedDatabases.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return a.name.localeCompare(b.name);
      });

      // Calculate storage usage summary
      const storageUsage = this.calculateStorageUsage(enhancedDatabases, storageInfo);

      console.log('🗄️ Enhanced P2P databases with size analysis:', {
        total: enhancedDatabases.length,
        active: storageUsage.p2pDatabases.active,
        inactive: storageUsage.p2pDatabases.inactive,
        totalEstimatedSize: this.formatBytes(storageUsage.p2pDatabases.totalSize),
        storageUsage
      });

      this.toastService.show(
        `Found ${enhancedDatabases.length} P2P database(s) (${storageUsage.p2pDatabases.active} active) - ${this.formatBytes(storageUsage.p2pDatabases.totalSize)}`
      );

      return { browserDatabases: enhancedDatabases, storageUsage };

    } catch (error) {
      console.error('❌ Error refreshing databases:', error);
      this.toastService.show('Failed to refresh databases');
      return { browserDatabases: [], storageUsage: null };
    }
  }

  /**
   * Get storage information from navigator
   * @returns {Promise<Object|null>} Storage info or null
   */
  async getStorageInfo() {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const storageInfo = await navigator.storage.estimate();
        console.log('💾 Storage usage info:', storageInfo);
        return storageInfo;
      }
    } catch (error) {
      console.warn('⚠️ Could not get storage usage info:', error);
    }
    return null;
  }

  /**
   * Filter databases that are P2P-related
   * @param {Array} allDatabases - All available databases
   * @returns {Array} Filtered P2P databases
   */
  filterP2PDatabases(allDatabases) {
    return allDatabases.filter(db => {
      const name = db.name.toLowerCase();
      return name.includes('libp2p') ||
             name.includes('helia') ||
             name.includes('orbitdb') ||
             name.includes('datastore') ||
             name.includes('blockstore') ||
             name.includes('ipfs') ||
             name.includes('keystore') ||
             name.includes('peer') ||
             name.includes('gossipsub') ||
             name.includes('dht') ||
             name.includes('kademlia') ||
             name.includes('pubsub') ||
             name.includes('bootstrap') ||
             name.includes('identity') ||
             name.includes('autonat') ||
             name.includes('dcutr') ||
             name.includes('circuit') ||
             name.includes('relay') ||
             name.startsWith('/'); // OrbitDB addresses start with /
    });
  }

  /**
   * Enhance databases with additional metadata
   * @param {Array} databases - Database list to enhance
   * @param {string} currentDbAddress - Current database address
   * @param {string} currentDbName - Current database name
   * @returns {Promise<Array>} Enhanced databases
   */
  async enhanceDatabases(databases, currentDbAddress, currentDbName) {
    return Promise.all(
      databases.map(async (db) => {
        const enhanced = { ...db };

        // Determine if this database is currently active
        enhanced.isActive = false;
        enhanced.activeType = null;

        // Check if this is the current OrbitDB
        if (
          (currentDbAddress && db.name === currentDbAddress) ||
          (currentDbName && db.name === currentDbName) ||
          (currentDbAddress && db.name.includes(currentDbAddress.split('/').pop()))
        ) {
          enhanced.isActive = true;
          enhanced.activeType = 'orbitdb';
          console.log('🎯 Found active OrbitDB:', db.name);
        }

        // Check for Helia/IPFS datastore
        if (!enhanced.isActive && this.isHeliaDatabase(db.name)) {
          const isActive = await this.checkHeliaActivity(db.name);
          if (isActive) {
            enhanced.isActive = true;
            enhanced.activeType = 'helia';
            console.log('🎯 Found active Helia/IPFS database:', db.name);
          }
        }

        // Check for Libp2p datastore
        if (!enhanced.isActive && this.isLibp2pDatabase(db.name)) {
          enhanced.isActive = true;
          enhanced.activeType = 'libp2p';
          console.log('🎯 Found active Libp2p database:', db.name);
        }

        // Check if this is a keystore database
        if (db.name.toLowerCase().endsWith('keystore')) {
          enhanced.isKeystore = true;
          enhanced.keystoreKeys = await this.analyzeKeystore(db.name);
        }

        // Get general database metadata
        const metadata = await this.getDatabaseMetadata(db.name);
        Object.assign(enhanced, metadata);

        return enhanced;
      })
    );
  }

  /**
   * Check if database name suggests it's a Helia database
   * @param {string} dbName - Database name
   * @returns {boolean} True if likely Helia database
   */
  isHeliaDatabase(dbName) {
    const name = dbName.toLowerCase();
    return name.includes('helia') ||
           name.includes('blockstore') ||
           name.includes('datastore');
  }

  /**
   * Check if database name suggests it's a Libp2p database
   * @param {string} dbName - Database name
   * @returns {boolean} True if likely Libp2p database
   */
  isLibp2pDatabase(dbName) {
    const name = dbName.toLowerCase();
    return name.includes('libp2p') ||
           name.includes('keystore') ||
           name.endsWith('-keystore') ||
           name.includes('peer-');
  }

  /**
   * Check if Helia database has typical activity patterns
   * @param {string} dbName - Database name
   * @returns {Promise<boolean>} True if appears active
   */
  async checkHeliaActivity(dbName) {
    try {
      const request = indexedDB.open(dbName);
      const dbInstance = await new Promise((resolve, reject) => {
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = () => reject(request.error);
      });

      const storeNames = Array.from(dbInstance.objectStoreNames);
      const isActive = storeNames.some(name =>
        name.includes('blocks') ||
        name.includes('data') ||
        name.includes('pins') ||
        name.includes('metadata')
      );

      dbInstance.close();
      return isActive;
    } catch (err) {
      return false;
    }
  }

  /**
   * Analyze keystore database
   * @param {string} dbName - Database name
   * @returns {Promise<Array>} Keystore analysis results
   */
  async analyzeKeystore(dbName) {
    try {
      const request = indexedDB.open(dbName);
      const dbInstance = await new Promise((resolve, reject) => {
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = () => reject(request.error);
      });

      const storeNames = Array.from(dbInstance.objectStoreNames);
      console.log('🔑 Keystore database stores:', storeNames);

      const keystoreKeys = [];

      for (const storeName of storeNames) {
        try {
          const keys = await this.getKeystoreStoreKeys(dbInstance, storeName);
          if (keys.keyCount > 0) {
            keystoreKeys.push(keys);
          }
        } catch (err) {
          console.warn('Error reading keystore store:', storeName, err);
        }
      }

      dbInstance.close();
      console.log('🔑 Keystore analysis complete:', keystoreKeys);
      return keystoreKeys;

    } catch (err) {
      console.warn('Error analyzing keystore database:', dbName, err);
      return [];
    }
  }

  /**
   * Get keys from a keystore object store
   * @param {IDBDatabase} dbInstance - Database instance
   * @param {string} storeName - Store name
   * @returns {Promise<Object>} Store key information
   */
  async getKeystoreStoreKeys(dbInstance, storeName) {
    const transaction = dbInstance.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);

    // Get all keys from the store
    const getAllKeysRequest = store.getAllKeys();
    const rawKeys = await new Promise((resolve) => {
      getAllKeysRequest.onsuccess = () => resolve(getAllKeysRequest.result || []);
      getAllKeysRequest.onerror = () => resolve([]);
    });

    // Convert keys to readable format
    const keys = rawKeys.map(key => this.formatKey(key));

    // Get sample records
    const getAllRequest = store.getAll(10);
    const records = await new Promise((resolve) => {
      getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
      getAllRequest.onerror = () => resolve([]);
    });

    return {
      storeName,
      keyCount: keys.length,
      keys: keys.slice(0, 20),
      sampleRecords: records.map(record => this.extractRecordInfo(record))
    };
  }

  /**
   * Format a key for display
   * @param {*} key - Raw key
   * @returns {string} Formatted key
   */
  formatKey(key) {
    if (key instanceof ArrayBuffer) {
      const uint8Array = new Uint8Array(key);
      
      // Try UTF-8 decode first
      try {
        let isValidString = true;
        for (let i = 0; i < uint8Array.length; i++) {
          const byte = uint8Array[i];
          if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
            if (byte === 0 && i === uint8Array.length - 1) continue;
            isValidString = false;
            break;
          }
          if (byte > 126 && byte < 128) {
            isValidString = false;
            break;
          }
        }

        if (isValidString && uint8Array.length > 0) {
          const decoder = new TextDecoder('utf-8', { fatal: false });
          const decoded = decoder.decode(uint8Array).replace(/\0+$/, '');
          if (decoded.length > 0 && /^[\x20-\x7E\s]*$/.test(decoded)) {
            return `"${decoded}" (string)`;
          }
        }
      } catch (e) {
        // Fall through to hex
      }

      // Hex representation
      const hexString = Array.from(uint8Array)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');

      if (hexString.length > 64) {
        return `${hexString.substring(0, 32)}...${hexString.substring(hexString.length - 16)} (hex, ${uint8Array.length} bytes)`;
      } else {
        return `${hexString} (hex, ${uint8Array.length} bytes)`;
      }
    } else if (key && typeof key === 'object' && key.constructor === Object) {
      return JSON.stringify(key);
    } else if (typeof key === 'string') {
      return key;
    } else {
      return String(key);
    }
  }

  /**
   * Extract meaningful info from a record
   * @param {*} record - Database record
   * @returns {Object} Record information
   */
  extractRecordInfo(record) {
    if (typeof record === 'object' && record !== null) {
      const info = { type: typeof record };

      // Look for common key properties
      if ('id' in record) info.id = record.id;
      if ('name' in record) info.name = record.name;
      if ('type' in record) info.keyType = record.type;
      if ('algorithm' in record) info.algorithm = record.algorithm;
      if ('publicKey' in record) info.hasPublicKey = true;
      if ('privateKey' in record) info.hasPrivateKey = true;
      if ('extractable' in record) info.extractable = record.extractable;
      if ('usages' in record) info.usages = record.usages;

      // For Buffer/Uint8Array data, show length
      if (record instanceof Uint8Array || (record.data && record.data instanceof Uint8Array)) {
        info.dataLength = record instanceof Uint8Array ? record.length : record.data.length;
      }

      return info;
    }
    return { type: typeof record, value: String(record).substring(0, 100) };
  }

  /**
   * Get general database metadata
   * @param {string} dbName - Database name
   * @returns {Promise<Object>} Database metadata
   */
  async getDatabaseMetadata(dbName) {
    try {
      const request = indexedDB.open(dbName);
      const dbInstance = await new Promise((resolve, reject) => {
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = () => reject(request.error);
      });

      const storeNames = Array.from(dbInstance.objectStoreNames);
      let totalRecords = 0;

      if (storeNames.length > 0) {
        const transaction = dbInstance.transaction(storeNames, 'readonly');

        for (const storeName of storeNames) {
          try {
            const store = transaction.objectStore(storeName);
            const countRequest = store.count();
            const count = await new Promise((resolve) => {
              countRequest.onsuccess = () => resolve(countRequest.result || 0);
              countRequest.onerror = () => resolve(0);
            });
            totalRecords += count;
          } catch (err) {
            // Ignore errors for individual stores
          }
        }
      }

      const estimatedSize = await this.estimateDatabaseSize(dbName);

      dbInstance.close();

      return {
        storeNames,
        totalRecords,
        lastAccessed: new Date().toISOString(),
        estimatedSize
      };

    } catch (error) {
      console.warn(`Could not access metadata for database: ${dbName}`, error);
      return {
        storeNames: [],
        totalRecords: 0,
        lastAccessed: null,
        estimatedSize: 0
      };
    }
  }

  /**
   * Estimate database size
   * @param {string} dbName - Database name
   * @returns {Promise<number>} Estimated size in bytes
   */
  async estimateDatabaseSize(dbName) {
    try {
      const request = indexedDB.open(dbName);
      const dbInstance = await new Promise((resolve, reject) => {
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = () => reject(request.error);
      });

      const storeNames = Array.from(dbInstance.objectStoreNames);
      let totalSize = 0;

      for (const storeName of storeNames) {
        try {
          const transaction = dbInstance.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);

          const getAllRequest = store.getAll();
          const records = await new Promise((resolve) => {
            getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
            getAllRequest.onerror = () => resolve([]);
          });

          if (records.length > 0) {
            const sampleSize = Math.min(10, records.length);
            let sampleTotalSize = 0;

            for (let i = 0; i < sampleSize; i++) {
              try {
                const serialized = JSON.stringify(records[i]);
                sampleTotalSize += serialized.length * 2; // UTF-16 encoding
              } catch (e) {
                sampleTotalSize += 1024; // Default 1KB estimate
              }
            }

            const averageRecordSize = sampleTotalSize / sampleSize;
            totalSize += averageRecordSize * records.length;
          }
        } catch (err) {
          console.warn('Error estimating size for store:', storeName, err);
        }
      }

      dbInstance.close();
      return Math.round(totalSize);
    } catch (err) {
      console.warn('Error estimating database size:', dbName, err);
      return 0;
    }
  }

  /**
   * Calculate storage usage summary
   * @param {Array} databases - Enhanced databases
   * @param {Object} storageInfo - Storage information
   * @returns {Object} Storage usage summary
   */
  calculateStorageUsage(databases, storageInfo) {
    const activeCount = databases.filter(db => db.isActive).length;
    const totalEstimatedSize = databases.reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
    const activeDatabasesSize = databases.filter(db => db.isActive).reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
    const inactiveDatabasesSize = databases.filter(db => !db.isActive).reduce((sum, db) => sum + (db.estimatedSize || 0), 0);

    // Group by type
    const orbitDbSize = databases.filter(db => db.activeType === 'orbitdb').reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
    const heliaSize = databases.filter(db => db.activeType === 'helia').reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
    const libp2pSize = databases.filter(db => db.activeType === 'libp2p').reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
    const otherSize = databases.filter(db => !db.activeType).reduce((sum, db) => sum + (db.estimatedSize || 0), 0);

    return {
      used: storageInfo?.usage || 0,
      quota: storageInfo?.quota || 0,
      p2pDatabases: {
        total: databases.length,
        active: activeCount,
        inactive: databases.length - activeCount,
        totalSize: totalEstimatedSize,
        activeDatabasesSize,
        inactiveDatabasesSize,
        byType: {
          orbitdb: { count: databases.filter(db => db.activeType === 'orbitdb').length, size: orbitDbSize },
          helia: { count: databases.filter(db => db.activeType === 'helia').length, size: heliaSize },
          libp2p: { count: databases.filter(db => db.activeType === 'libp2p').length, size: libp2pSize },
          other: { count: databases.filter(db => !db.activeType).length, size: otherSize }
        }
      }
    };
  }

  /**
   * View database contents with state management
   * @param {string} dbName - Database name
   * @param {string} currentViewingDatabase - Currently viewing database
   * @returns {Promise<Object>} View state updates
   */
  async viewDatabaseContents(dbName, currentViewingDatabase) {
    try {
      if (currentViewingDatabase === dbName) {
        // Hide if already viewing
        return {
          viewingDatabase: null,
          databaseContents: {}
        };
      }
      
      const storeContents = await this.getDatabaseContents(dbName);
      
      return {
        viewingDatabase: dbName,
        databaseContents: {
          [dbName]: storeContents
        }
      };
      
    } catch (error) {
      console.error('❌ Error viewing database contents:', error);
      this.toastService.show('Failed to view database contents');
      return null;
    }
  }

  /**
   * Get database contents (internal method)
   * @param {string} dbName - Database name
   * @returns {Promise<Array>} Store contents
   */
  async getDatabaseContents(dbName) {
    try {
      console.log('👀 Viewing database contents:', dbName);
      this.toastService.show('Loading database contents...');

      const request = indexedDB.open(dbName);

      return new Promise((resolve, reject) => {
        request.onsuccess = async (event) => {
          const db = event.target.result;
          const storeNames = Array.from(db.objectStoreNames);
          const storeContents = [];

          try {
            for (const storeName of storeNames) {
              const transaction = db.transaction(storeName, 'readonly');
              const store = transaction.objectStore(storeName);

              // Get count
              const countRequest = store.count();
              const count = await new Promise((resolve, reject) => {
                countRequest.onsuccess = () => resolve(countRequest.result);
                countRequest.onerror = () => reject(countRequest.error);
              });

              // Get records (limit to first 20 for performance)
              const getAllRequest = store.getAll(20);
              const records = await new Promise((resolve, reject) => {
                getAllRequest.onsuccess = () => resolve(getAllRequest.result);
                getAllRequest.onerror = () => reject(getAllRequest.error);
              });

              storeContents.push({
                name: storeName,
                count,
                records
              });
            }

            this.toastService.show(`Loaded contents for ${dbName}`);
            resolve(storeContents);
          } catch (error) {
            console.error('Error reading store contents:', error);
            this.toastService.show('Failed to read database contents');
            reject(error);
          } finally {
            db.close();
          }
        };

        request.onerror = () => {
          console.error('Error opening database:', request.error);
          this.toastService.show('Failed to open database');
          reject(request.error);
        };
      });

    } catch (error) {
      console.error('❌ Error viewing database contents:', error);
      this.toastService.show('Failed to view database contents');
      throw error;
    }
  }

  /**
   * Delete a single database with state management
   * @param {string} dbName - Database name
   * @param {Array} browserDatabases - Current database list
   * @param {Object} storageUsage - Current storage usage
   * @param {string} viewingDatabase - Currently viewing database
   * @param {Object} databaseContents - Current database contents
   * @returns {Promise<Object|null>} State updates or null
   */
  async deleteSingleDatabase(dbName, browserDatabases, storageUsage, viewingDatabase, databaseContents) {
    const success = await this.deleteDatabase(dbName);
    
    if (success) {
      // Find the deleted database to get its size
      const deletedDb = browserDatabases.find(db => db.name === dbName);
      const deletedSize = deletedDb?.estimatedSize || 0;
      
      // Remove from database list
      const updatedDatabases = browserDatabases.filter(db => db.name !== dbName);
      
      // Update storage usage if it exists
      let updatedStorageUsage = storageUsage;
      if (storageUsage && deletedDb) {
        updatedStorageUsage = { ...storageUsage };
        
        // Update total size
        updatedStorageUsage.p2pDatabases.totalSize -= deletedSize;
        
        // Update active/inactive sizes
        if (deletedDb.isActive) {
          updatedStorageUsage.p2pDatabases.activeDatabasesSize -= deletedSize;
          updatedStorageUsage.p2pDatabases.active -= 1;
        } else {
          updatedStorageUsage.p2pDatabases.inactiveDatabasesSize -= deletedSize;
          updatedStorageUsage.p2pDatabases.inactive -= 1;
        }
        
        // Update by type
        if (deletedDb.activeType) {
          const typeKey = deletedDb.activeType;
          if (updatedStorageUsage.p2pDatabases.byType[typeKey]) {
            updatedStorageUsage.p2pDatabases.byType[typeKey].size -= deletedSize;
            updatedStorageUsage.p2pDatabases.byType[typeKey].count -= 1;
          }
        } else {
          updatedStorageUsage.p2pDatabases.byType.other.size -= deletedSize;
          updatedStorageUsage.p2pDatabases.byType.other.count -= 1;
        }
        
        // Update total count
        updatedStorageUsage.p2pDatabases.total -= 1;
      }
      
      // Clear viewing state if we were viewing this database
      let updatedViewingDatabase = viewingDatabase;
      let updatedDatabaseContents = { ...databaseContents };
      if (viewingDatabase === dbName) {
        updatedViewingDatabase = null;
        delete updatedDatabaseContents[dbName];
      }
      
      return {
        browserDatabases: updatedDatabases,
        storageUsage: updatedStorageUsage,
        viewingDatabase: updatedViewingDatabase,
        databaseContents: updatedDatabaseContents
      };
    }
    
    return null;
  }

  /**
   * Delete a single database (core method)
   * @param {string} dbName - Database name
   * @returns {Promise<boolean>} Success status
   */
  async deleteSingleDatabaseCore(dbName) {
    if (!confirm(`Are you sure you want to delete the database "${dbName}"? This action cannot be undone.`)) {
      return false;
    }

    try {
      console.log('🗑️ Deleting database:', dbName);

      return new Promise((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase(dbName);

        deleteRequest.onsuccess = () => {
          console.log('✅ Database deleted:', dbName);
          this.toastService.show(`Database "${dbName}" deleted`);
          resolve(true);
        };

        deleteRequest.onerror = () => {
          console.error('❌ Error deleting database:', deleteRequest.error);
          this.toastService.show(`Failed to delete database "${dbName}"`);
          resolve(false);
        };

        deleteRequest.onblocked = () => {
          console.warn('⚠️ Database deletion blocked - close all tabs and try again');
          this.toastService.show('Database deletion blocked - close other tabs and try again');
          resolve(false);
        };
      });

    } catch (error) {
      console.error('❌ Error deleting database:', error);
      this.toastService.show('Failed to delete database');
      return false;
    }
  }

  /**
   * Delete all inactive databases with state management
   * @param {Array} browserDatabases - All databases
   * @param {string} viewingDatabase - Currently viewing database
   * @param {Object} databaseContents - Current database contents
   * @returns {Promise<Object|null>} State updates or null
   */
  async deleteAllInactiveDatabases(browserDatabases, viewingDatabase, databaseContents) {
    const inactiveDatabases = browserDatabases.filter(db => !db.isActive);
    
    if (inactiveDatabases.length === 0) {
      this.toastService.show('No inactive databases to delete');
      return null;
    }
    
    if (!confirm(`Are you sure you want to delete ${inactiveDatabases.length} inactive P2P databases? This action cannot be undone.`)) {
      return null;
    }
    
    try {
      console.log('🗑️ Deleting inactive databases:', inactiveDatabases.length);
      this.toastService.show('Deleting inactive databases...');
      
      let deletedCount = 0;
      let failedCount = 0;
      
      for (const db of inactiveDatabases) {
        try {
          const success = await this.deleteDatabase(db.name);
          if (success) {
            deletedCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          console.error('Error deleting inactive database:', db.name, error);
          failedCount++;
        }
      }
      
      // Update database list - remove deleted databases
      const updatedDatabases = browserDatabases.filter(db => 
        db.isActive || !inactiveDatabases.some(deleted => deleted.name === db.name)
      );
      
      // Clear viewing state if we were viewing a deleted database
      let updatedViewingDatabase = viewingDatabase;
      let updatedDatabaseContents = { ...databaseContents };
      if (viewingDatabase && inactiveDatabases.some(db => db.name === viewingDatabase)) {
        updatedViewingDatabase = null;
        delete updatedDatabaseContents[viewingDatabase];
      }
      
      if (failedCount === 0) {
        this.toastService.show(`✅ Successfully deleted ${deletedCount} inactive databases`);
      } else {
        this.toastService.show(`⚠️ Deleted ${deletedCount} inactive databases, failed to delete ${failedCount}`);
      }
      
      console.log(`🧹 Inactive database cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);
      
      return {
        browserDatabases: updatedDatabases,
        viewingDatabase: updatedViewingDatabase,
        databaseContents: updatedDatabaseContents
      };
      
    } catch (error) {
      console.error('❌ Error during inactive database deletion:', error);
      this.toastService.show('Failed to delete inactive databases');
      return null;
    }
  }

  /**
   * Delete all inactive databases (core method)
   * @param {Array} databases - All databases
   * @returns {Promise<Object>} Deletion results
   */
  async deleteAllInactiveDatabasesCore(databases) {
    const inactiveDatabases = databases.filter(db => !db.isActive);

    if (inactiveDatabases.length === 0) {
      this.toastService.show('No inactive databases to delete');
      return { deletedCount: 0, failedCount: 0 };
    }

    if (!confirm(`Are you sure you want to delete ${inactiveDatabases.length} inactive P2P databases? This action cannot be undone.`)) {
      return { deletedCount: 0, failedCount: 0 };
    }

    try {
      console.log('🗑️ Deleting inactive databases:', inactiveDatabases.length);
      this.toastService.show('Deleting inactive databases...');

      let deletedCount = 0;
      let failedCount = 0;

      for (const db of inactiveDatabases) {
        try {
          const success = await this.deleteDatabase(db.name);
          if (success) {
            deletedCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          console.error('Error deleting inactive database:', db.name, error);
          failedCount++;
        }
      }

      if (failedCount === 0) {
        this.toastService.show(`✅ Successfully deleted ${deletedCount} inactive databases`);
      } else {
        this.toastService.show(`⚠️ Deleted ${deletedCount} inactive databases, failed to delete ${failedCount}`);
      }

      console.log(`🧹 Inactive database cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);
      return { deletedCount, failedCount };

    } catch (error) {
      console.error('❌ Error during inactive database deletion:', error);
      this.toastService.show('Failed to delete inactive databases');
      return { deletedCount: 0, failedCount: inactiveDatabases.length };
    }
  }

  /**
   * Delete all databases with state management
   * @param {Array} browserDatabases - All databases
   * @returns {Promise<Object|null>} State updates or null
   */
  async deleteAllDatabases(browserDatabases) {
    if (!confirm(`Are you sure you want to delete ALL ${browserDatabases.length} P2P databases? This action cannot be undone and will reset all your P2P data.`)) {
      return null;
    }
    
    const secondConfirm = confirm('This will delete all Libp2p, Helia, and OrbitDB data. Are you absolutely sure?');
    if (!secondConfirm) {
      return null;
    }
    
    try {
      console.log('🗑️ Deleting all databases:', browserDatabases.length);
      this.toastService.show('Deleting all databases...');
      
      let deletedCount = 0;
      let failedCount = 0;
      
      for (const db of browserDatabases) {
        try {
          const success = await this.deleteDatabase(db.name);
          if (success) {
            deletedCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          console.error('Error deleting database:', db.name, error);
          failedCount++;
        }
      }
      
      if (failedCount === 0) {
        this.toastService.show(`✅ Successfully deleted all ${deletedCount} databases`);
      } else {
        this.toastService.show(`⚠️ Deleted ${deletedCount} databases, failed to delete ${failedCount}`);
      }
      
      console.log(`🧹 Database cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);
      
      // Return cleared state
      return {
        browserDatabases: [],
        viewingDatabase: null,
        databaseContents: {}
      };
      
    } catch (error) {
      console.error('❌ Error during bulk database deletion:', error);
      this.toastService.show('Failed to delete all databases');
      return null;
    }
  }

  /**
   * Delete all databases (core method)
   * @param {Array} databases - All databases
   * @returns {Promise<Object>} Deletion results
   */
  async deleteAllDatabasesCore(databases) {
    if (!confirm(`Are you sure you want to delete ALL ${databases.length} P2P databases? This action cannot be undone and will reset all your P2P data.`)) {
      return { deletedCount: 0, failedCount: 0 };
    }

    const secondConfirm = confirm('This will delete all Libp2p, Helia, and OrbitDB data. Are you absolutely sure?');
    if (!secondConfirm) {
      return { deletedCount: 0, failedCount: 0 };
    }

    try {
      console.log('🗑️ Deleting all databases:', databases.length);
      this.toastService.show('Deleting all databases...');

      let deletedCount = 0;
      let failedCount = 0;

      for (const db of databases) {
        try {
          const success = await this.deleteDatabase(db.name);
          if (success) {
            deletedCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          console.error('Error deleting database:', db.name, error);
          failedCount++;
        }
      }

      if (failedCount === 0) {
        this.toastService.show(`✅ Successfully deleted all ${deletedCount} databases`);
      } else {
        this.toastService.show(`⚠️ Deleted ${deletedCount} databases, failed to delete ${failedCount}`);
      }

      console.log(`🧹 Database cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);
      return { deletedCount, failedCount };

    } catch (error) {
      console.error('❌ Error during bulk database deletion:', error);
      this.toastService.show('Failed to delete all databases');
      return { deletedCount: 0, failedCount: databases.length };
    }
  }

  /**
   * Delete a database (internal helper)
   * @param {string} dbName - Database name
   * @returns {Promise<boolean>} Success status
   */
  async deleteDatabase(dbName) {
    return new Promise((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName);

      deleteRequest.onsuccess = () => {
        console.log('✅ Deleted:', dbName);
        resolve(true);
      };

      deleteRequest.onerror = () => {
        console.error('❌ Failed to delete:', dbName, deleteRequest.error);
        resolve(false);
      };

      deleteRequest.onblocked = () => {
        console.warn('⚠️ Deletion blocked:', dbName);
        resolve(false);
      };
    });
  }
}
