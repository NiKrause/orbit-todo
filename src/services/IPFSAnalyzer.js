/**
 * IPFSAnalyzer - Manages IPFS node analysis and OrbitDB discovery
 * Handles pinned content analysis, database discovery, and identity information
 */
export class IPFSAnalyzer {
  constructor(toastService, formatBytes, formatPeerId) {
    this.toastService = toastService;
    this.formatBytes = formatBytes;
    this.formatPeerId = formatPeerId;
  }

  /**
   * Analyze IPFS node and OrbitDB databases
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getHelia - Get Helia instance
   * @param {Function} dependencies.getTodoDbAddress - Get current todo database address
   * @param {Function} dependencies.getTodoDbName - Get current todo database name
   * @param {Function} dependencies.getMyPeerId - Get current peer ID
   * @param {Function} dependencies.getPeerOrbitDbAddresses - Get peer OrbitDB addresses
   * @param {Function} dependencies.getPeerWritePermissionDbAddresses - Get peer write permission addresses
   * @param {Function} dependencies.getMyWritePermissionDatabaseAddress - Get own write permission DB address
   * @param {Function} dependencies.getMyWritePermissionDatabaseName - Get own write permission DB name
   * @param {Array} dependencies.todos - Current todos
   * @param {Array} dependencies.writePermissionRequests - Write permission requests
   * @param {Object} dependencies.storageUsage - Storage usage information
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeIPFS({
    getTodoDbAddress,
    getTodoDbName,
    getMyPeerId,
    todos,
    peerOrbitDbAddresses,
    writePermissionRequests,
    storageUsage}) {
    const {
      getHelia
    } = await import('../lib/p2p/network.js');

    try {
      console.log('🔍 Starting IPFS analysis...');
      this.toastService.show('Analyzing IPFS node...');

      const helia = getHelia();
      if (!helia) {
        throw new Error('Helia instance not available');
      }

      const analysis = this.initializeAnalysis();

      // Get identity info
      analysis.identity = await this.getIdentityInfo(helia);

      // Analyze pinned content
      await this.analyzePinnedContent(helia, analysis);

      // Analyze OrbitDB databases
      await this.analyzeOrbitDatabases(analysis, {
        getTodoDbAddress,
        getTodoDbName,
        getMyPeerId,
        todos,
        peerOrbitDbAddresses,
        writePermissionRequests,
        storageUsage
      });

      console.log('🔍 IPFS analysis complete:', {
        totalPins: analysis.summary.totalPins,
        totalSize: this.formatBytes(analysis.summary.totalSize),
        orbitDatabases: analysis.summary.orbitDatabases,
        ownDatabases: analysis.summary.ownDatabases,
        peerDatabases: analysis.summary.peerDatabases
      });

      this.toastService.show(
        `IPFS analysis complete: ${analysis.summary.totalPins} pins, ${analysis.summary.orbitDatabases} OrbitDB databases`
      );

      return analysis;

    } catch (error) {
      console.error('❌ Error during IPFS analysis:', error);
      this.toastService.show('Failed to analyze IPFS node');
      throw error;
    }
  }

  /**
   * Initialize analysis structure
   * @returns {Object} Empty analysis object
   */
  initializeAnalysis() {
    return {
      summary: {
        totalPins: 0,
        totalSize: 0,
        recursivePins: 0,
        directPins: 0,
        orbitDatabases: 0,
        ownDatabases: 0,
        peerDatabases: 0,
        todoDbCount: 0,
        writePermissionDbCount: 0,
        orbitDbSize: 0
      },
      pins: [],
      orbitDatabases: [],
      identity: null
    };
  }

  /**
   * Get IPFS identity information
   * @param {Object} helia - Helia instance
   * @returns {Promise<Object|null>} Identity info or null
   */
  async getIdentityInfo(helia) {
    try {
      const peerId = helia.libp2p.peerId;
      return {
        peerId: peerId.toString(),
        publicKey: peerId.publicKey ? peerId.publicKey.toString('hex') : null,
        keyType: peerId.type || 'Unknown'
      };
    } catch (err) {
      console.warn('Could not get identity info:', err);
      return null;
    }
  }

  /**
   * Analyze pinned content
   * @param {Object} helia - Helia instance
   * @param {Object} analysis - Analysis object to update
   */
  async analyzePinnedContent(helia, analysis) {
    try {
      const pins = helia.pins.ls();

      for await (const pin of pins) {
        const cid = pin.cid.toString();
        const pinAnalysis = await this.analyzePin(helia, pin, cid);

        analysis.pins.push(pinAnalysis);

        // Update summary
        analysis.summary.totalPins++;
        analysis.summary.totalSize += pinAnalysis.size;

        if (pin.type === 'recursive') {
          analysis.summary.recursivePins++;
        } else {
          analysis.summary.directPins++;
        }

        if (pinAnalysis.metadata.isOrbitDB) {
          analysis.summary.orbitDatabases++;
          analysis.summary.orbitDbSize += pinAnalysis.size;
        }
      }
    } catch (err) {
      console.warn('Could not analyze pins:', err);
    }
  }

  /**
   * Analyze a single pin
   * @param {Object} helia - Helia instance
   * @param {Object} pin - Pin object
   * @param {string} cid - CID string
   * @returns {Promise<Object>} Pin analysis
   */
  async analyzePin(helia, pin, cid) {
    let size = 0;
    let blocks = 0;
    let metadata = {};

    try {
      if (pin.type === 'recursive') {
        const dagAnalysis = await this.analyzeRecursivePin(helia, pin, cid);
        size = dagAnalysis.size;
        blocks = dagAnalysis.blocks;
      } else {
        const blockAnalysis = await this.analyzeDirectPin(helia, pin, cid);
        size = blockAnalysis.size;
        blocks = blockAnalysis.blocks;
      }
    } catch (err) {
      console.error(`❌ Error calculating size for pin ${cid.substring(0, 12)}:`, err);
      size = pin.type === 'recursive' ? 4096 : 256;
      console.log(`⚠️ Pin ${cid.substring(0, 12)}... using ${pin.type} default: ${size} bytes`);
    }

    // Check if this might be an OrbitDB CID
    if (pin.type === 'recursive') {
      metadata = await this.checkOrbitDBManifest(helia, pin.cid);
    }

    if (blocks > 0) {
      metadata.blocks = blocks;
    }

    metadata.lastAccessed = new Date().toISOString();

    return {
      cid,
      type: pin.type,
      size,
      metadata
    };
  }

  /**
   * Analyze recursive pin (DAG)
   * @param {Object} helia - Helia instance
   * @param {Object} pin - Pin object
   * @param {string} cid - CID string
   * @returns {Promise<Object>} Size and block analysis
   */
  async analyzeRecursivePin(helia, pin, cid) {
    console.log(`🌳 Calculating recursive DAG size for ${cid.substring(0, 12)}...`);

    try {
      let totalSize = 0;
      let blockCount = 0;

      // Use the DAG walk to get all blocks in the DAG
      for await (const block of helia.blockstore.getMany([pin.cid])) {
        totalSize += block.bytes.length;
        blockCount++;

        // Limit to prevent infinite loops on large DAGs
        if (blockCount > 1000) {
          console.log(`⚠️ Stopping DAG walk at 1000 blocks for ${cid.substring(0, 12)}`);
          break;
        }
      }

      if (totalSize > 0) {
        console.log(`🌳 Recursive pin ${cid.substring(0, 12)}... DAG size: ${totalSize} bytes (${blockCount} blocks)`);
        return { size: totalSize, blocks: blockCount };
      } else {
        // Fallback: try to get just the root block
        const rootBlock = await helia.blockstore.get(pin.cid);
        console.log(`📦 Recursive pin ${cid.substring(0, 12)}... root block only: ${rootBlock.bytes.length} bytes`);
        return { size: rootBlock.bytes.length, blocks: 1 };
      }
    } catch (dagErr) {
      console.warn(`⚠️ DAG walk failed for ${cid.substring(0, 12)}:`, dagErr.message);
      // Fallback to root block
      try {
        const rootBlock = await helia.blockstore.get(pin.cid);
        console.log(`📦 Recursive pin ${cid.substring(0, 12)}... fallback to root: ${rootBlock.bytes.length} bytes`);
        return { size: rootBlock.bytes.length, blocks: 1 };
      } catch (rootErr) {
        console.log(`⚠️ Recursive pin ${cid.substring(0, 12)}... using large default: 4096 bytes`);
        return { size: 4096, blocks: 0 };
      }
    }
  }

  /**
   * Analyze direct pin (single block)
   * @param {Object} helia - Helia instance
   * @param {Object} pin - Pin object
   * @param {string} cid - CID string
   * @returns {Promise<Object>} Size and block analysis
   */
  async analyzeDirectPin(helia, pin, cid) {
    try {
      const block = await helia.blockstore.get(pin.cid);
      console.log(`📦 Direct pin ${cid.substring(0, 12)}... size: ${block.bytes.length} bytes`);
      return { size: block.bytes.length, blocks: 1 };
    } catch (blockErr) {
      console.warn(`⚠️ Could not get block for direct pin ${cid.substring(0, 12)}:`, blockErr.message);
      console.log(`⚠️ Direct pin ${cid.substring(0, 12)}... using small default: 256 bytes`);
      return { size: 256, blocks: 0 };
    }
  }

  /**
   * Check if a CID represents an OrbitDB manifest
   * @param {Object} helia - Helia instance
   * @param {Object} cid - CID object
   * @returns {Promise<Object>} Metadata object
   */
  async checkOrbitDBManifest(helia, cid) {
    try {
      // Try to decode as OrbitDB manifest
      const block = await helia.blockstore.get(cid);
      const decoded = JSON.parse(new TextDecoder().decode(block.bytes));

      if (decoded.type && (decoded.type === 'orbitdb' || decoded.name)) {
        return {
          isOrbitDB: true,
          dbType: decoded.type,
          dbName: decoded.name
        };
      }
    } catch (err) {
      // Not an OrbitDB manifest, continue
    }

    return {};
  }

  /**
   * Analyze OrbitDB databases from app context
   * @param {Object} analysis - Analysis object to update
   * @param {Object} dependencies - Required functions and data
   */
  async analyzeOrbitDatabases(analysis, dependencies) {
    const {
      getTodoDbAddress,
      getTodoDbName,
      getMyPeerId,
      todos,
      peerOrbitDbAddresses,
      writePermissionRequests,
      storageUsage
    } = dependencies;

    try {
      // Import required functions dynamically
      const { getPeerWritePermissionDbAddresses } = await import('../lib/p2p/database.js');
      const { 
        getMyWritePermissionDatabaseAddress, 
        getMyWritePermissionDatabaseName 
      } = await import('../lib/write-permissions.js');

      const currentDbAddress = getTodoDbAddress();
      const currentDbName = getTodoDbName();
      const myPeerIdStr = getMyPeerId();
      const peerOrbitDbAddressesMap = peerOrbitDbAddresses;

      console.log('🔍 [IPFS Analysis Debug] Database detection values:', {
        currentDbAddress,
        currentDbName,
        myPeerIdStr,
        peerOrbitDbAddressesSize: peerOrbitDbAddressesMap.size,
        peerOrbitDbAddresses: Array.from(peerOrbitDbAddressesMap.entries()),
        todosLength: todos.length
      });

      const processedDatabases = new Set();

      // Get database instances for replication status
      const { 
        getCurrentTodoDB,
        getPeerTodoDbInstances,
        getPeerWritePermissionDbInstances
      } = await import('../lib/p2p/database.js');
      
      const { getMyWritePermissionDatabase } = await import('../lib/write-permissions.js');
      
      const currentTodoDB = getCurrentTodoDB();
      const myWritePermissionDB = getMyWritePermissionDatabase();
      const peerTodoDbInstances = getPeerTodoDbInstances();
      const peerWritePermissionDbInstances = getPeerWritePermissionDbInstances();

      // Add current TODO database
      this.addCurrentTodoDatabase(analysis, {
        currentDbAddress,
        currentDbName,
        myPeerIdStr,
        todos,
        storageUsage,
        processedDatabases,
        dbInstance: currentTodoDB
      });

      // Add own write permission database
      this.addOwnWritePermissionDatabase(analysis, {
        getMyWritePermissionDatabaseAddress,
        getMyWritePermissionDatabaseName,
        myPeerIdStr,
        writePermissionRequests,
        processedDatabases,
        dbInstance: myWritePermissionDB
      });

      // Add peer TODO databases
      this.addPeerTodoDatabases(analysis, {
        peerOrbitDbAddresses: peerOrbitDbAddressesMap,
        myPeerIdStr,
        processedDatabases,
        peerTodoDbInstances
      });

      // Add peer write permission databases
      this.addPeerWritePermissionDatabases(analysis, {
        getPeerWritePermissionDbAddresses,
        myPeerIdStr,
        processedDatabases,
        peerWritePermissionDbInstances
      });

    } catch (err) {
      console.warn('Could not analyze OrbitDB databases:', err);
    }
  }

  /**
   * Add current TODO database to analysis
   * @param {Object} analysis - Analysis object
   * @param {Object} params - Parameters
   */
  addCurrentTodoDatabase(analysis, params) {
    const { currentDbAddress, currentDbName, myPeerIdStr, todos, storageUsage, processedDatabases, dbInstance } = params;

    if (currentDbAddress) {
      const displayName = currentDbName || 'My TODO Database';
      console.log('✅ [IPFS Analysis Debug] Adding current database as own:', {
        address: currentDbAddress,
        name: displayName,
        originalDbName: currentDbName
      });

      // Try to get database size from storage analysis
      let dbSize = 0;
      if (storageUsage) {
        dbSize = storageUsage.p2pDatabases.byType.orbitdb.size || 0;
      }
      
      // Get replication status
      const replicationStatus = this.getReplicationStatus(dbInstance);

      analysis.orbitDatabases.push({
        address: currentDbAddress,
        name: currentDbName,
        type: 'documents',
        isOwn: true,
        size: dbSize,
        identity: {
          id: myPeerIdStr,
          publicKey: analysis.identity?.publicKey
        },
        records: todos.length,
        replication: replicationStatus
      });

      analysis.summary.ownDatabases++;
      analysis.summary.todoDbCount++;
      processedDatabases.add(currentDbAddress);
    }
  }

  /**
   * Add own write permission database to analysis
   * @param {Object} analysis - Analysis object
   * @param {Object} params - Parameters
   */
  addOwnWritePermissionDatabase(analysis, params) {
    const {
      getMyWritePermissionDatabaseAddress,
      getMyWritePermissionDatabaseName,
      myPeerIdStr,
      writePermissionRequests,
      processedDatabases,
      dbInstance
    } = params;

    const myWritePermissionDbAddress = getMyWritePermissionDatabaseAddress();
    const myWritePermissionDbName = getMyWritePermissionDatabaseName();

    if (myWritePermissionDbAddress) {
      console.log('✅ [IPFS Analysis Debug] Adding my write permission database:', {
        address: myWritePermissionDbAddress,
        name: myWritePermissionDbName
      });

      // Try to get write permission request count
      let requestCount = 0;
      try {
        requestCount = writePermissionRequests.length;
      } catch (err) {
        console.warn('Could not get write permission request count:', err);
      }
      
      // Get replication status
      const replicationStatus = this.getReplicationStatus(dbInstance);

      analysis.orbitDatabases.push({
        address: myWritePermissionDbAddress,
        name: myWritePermissionDbName || 'My Write Permission Database',
        type: 'write-permissions',
        isOwn: true,
        size: 0,
        identity: {
          id: myPeerIdStr,
          publicKey: analysis.identity?.publicKey
        },
        records: requestCount,
        replication: replicationStatus
      });

      analysis.summary.ownDatabases++;
      analysis.summary.writePermissionDbCount++;
      processedDatabases.add(myWritePermissionDbAddress);
    }
  }

  /**
   * Add peer TODO databases to analysis
   * @param {Object} analysis - Analysis object
   * @param {Object} params - Parameters
   */
  addPeerTodoDatabases(analysis, params) {
    const { peerOrbitDbAddresses, myPeerIdStr, processedDatabases, peerTodoDbInstances } = params;

    for (const [peerId, dbAddress] of peerOrbitDbAddresses.entries()) {
      // Skip if we already processed this database or if it's our own
      if (!processedDatabases.has(dbAddress) && peerId !== myPeerIdStr) {
        console.log('📋 [IPFS Analysis Debug] Adding peer TODO database:', {
          peerId: this.formatPeerId(peerId),
          address: dbAddress
        });
        
        // Get database instance for replication status
        const dbInstance = peerTodoDbInstances.get(peerId);
        const replicationStatus = this.getReplicationStatus(dbInstance);

        analysis.orbitDatabases.push({
          address: dbAddress,
          name: `${this.formatPeerId(peerId)}'s TODO Database`,
          type: 'documents',
          isOwn: false,
          size: 0,
          identity: {
            id: peerId,
            publicKey: null
          },
          records: 0,
          replication: replicationStatus
        });

        analysis.summary.peerDatabases++;
        analysis.summary.todoDbCount++;
        processedDatabases.add(dbAddress);
      }
    }
  }

  /**
   * Add peer write permission databases to analysis
   * @param {Object} analysis - Analysis object
   * @param {Object} params - Parameters
   */
  addPeerWritePermissionDatabases(analysis, params) {
    const { getPeerWritePermissionDbAddresses, myPeerIdStr, processedDatabases, peerWritePermissionDbInstances } = params;

    const peerWritePermissionDbAddresses = getPeerWritePermissionDbAddresses();
    console.log('🔐 [IPFS Analysis Debug] Write permission databases:', {
      size: peerWritePermissionDbAddresses.size,
      entries: Array.from(peerWritePermissionDbAddresses.entries())
    });

    for (const [peerId, dbAddress] of peerWritePermissionDbAddresses.entries()) {
      // Skip if we already processed this database or if it's our own
      if (!processedDatabases.has(dbAddress) && peerId !== myPeerIdStr) {
        console.log('🔐 [IPFS Analysis Debug] Adding peer write permission database:', {
          peerId: this.formatPeerId(peerId),
          address: dbAddress
        });
        
        // Get database instance for replication status
        const dbInstance = peerWritePermissionDbInstances.get(peerId);
        const replicationStatus = this.getReplicationStatus(dbInstance);

        analysis.orbitDatabases.push({
          address: dbAddress,
          name: `${this.formatPeerId(peerId)}'s Write Permission Database`,
          type: 'write-permissions',
          isOwn: false,
          size: 0,
          identity: {
            id: peerId,
            publicKey: null
          },
          records: 0,
          replication: replicationStatus
        });

        analysis.summary.peerDatabases++;
        analysis.summary.writePermissionDbCount++;
        processedDatabases.add(dbAddress);
      }
    }
  }
  
  /**
   * Get replication status for a database instance
   * @param {Object} dbInstance - OrbitDB database instance
   * @returns {Object} Replication status information
   */
  getReplicationStatus(dbInstance) {
    if (!dbInstance) {
      return {
        isOpen: false,
        hasReplicator: false,
        replicatorPeers: 0,
        isReplicating: false,
        hasEvents: false,
        status: 'No Instance'
      };
    }
    
    try {
      const status = {
        isOpen: !!dbInstance.address,
        hasReplicator: !!dbInstance.replicator,
        replicatorPeers: dbInstance.replicator?.peers?.size || 0,
        isReplicating: dbInstance.replicator?.started || false,
        hasEvents: !!dbInstance.events,
        dbName: dbInstance.dbName || 'Unknown',
        type: dbInstance.type || 'Unknown'
      };
      
      // Determine overall status
      if (!status.isOpen) {
        status.status = 'Closed';
      } else if (status.hasReplicator && status.isReplicating && status.replicatorPeers > 0) {
        status.status = `Replicating (${status.replicatorPeers} peers)`;
      } else if (status.hasReplicator && status.isReplicating) {
        status.status = 'Ready for Replication';
      } else if (status.hasReplicator) {
        status.status = 'Replicator Available';
      } else {
        status.status = 'Open - No Replicator';
      }
      
      return status;
    } catch (error) {
      console.warn('Error getting replication status:', error);
      return {
        isOpen: false,
        hasReplicator: false,
        replicatorPeers: 0,
        isReplicating: false,
        hasEvents: false,
        status: 'Error',
        error: error.message
      };
    }
  }
}
