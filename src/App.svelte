<script>
  import { onMount } from 'svelte'
import { 
    initializeP2P, 
    addTodo, 
    getAllTodos, 
    updateTodo, 
    deleteTodo, 
    getConnectedPeers, 
    getMyPeerId, 
    onDatabaseUpdate,
    getRelayDiscoveryStatus,
    formatPeerId,
    getTodoDbAddress,
    getTodoDbName,
    getPeerOrbitDbAddresses,
    openTodoDatabaseForPeer,
    getCurrentDatabaseInfo,
    requestWritePermission,
    grantWritePermission,
    denyWritePermission,
    getMyWritePermissionRequests,
    getMyOutgoingWritePermissionRequests,
    hasWritePermission,
    writePermissionRequestsStore
  } from './lib/p2p.js'
  import { getPeerWritePermissionDbAddresses } from './lib/p2p/database.js'
  import { 
    getMyWritePermissionDatabase, 
    getMyWritePermissionDatabaseAddress, 
    getMyWritePermissionDatabaseName 
  } from './lib/write-permissions.js'
  import { discoverRelay } from './utils/relay-discovery.js'
  import { getHelia } from './lib/p2p/network.js'

  // Import services
  import { ToastService } from './services/ToastService.js'
  import { EventManager } from './services/EventManager.js'
  import { DatabaseSwitcher } from './services/DatabaseSwitcher.js'
  import { DatabaseManager as DatabaseManagerService } from './services/DatabaseManager.js'
  import { IPFSAnalyzer as IPFSAnalyzerService } from './services/IPFSAnalyzer.js'
  import { WritePermissionManager } from './services/WritePermissionManager.js'

  // Import components
  import Toast from './components/Toast.svelte'
  import LoadingState from './components/LoadingState.svelte'
  import DatabaseSelector from './components/DatabaseSelector.svelte'
  import TodoForm from './components/TodoForm.svelte'
  import TodoList from './components/TodoList.svelte'
  import PeerStatus from './components/PeerStatus.svelte'
  import WritePermissions from './components/WritePermissions.svelte'
  import IPFSAnalyzer from './components/IPFSAnalyzer.svelte'
  import DatabaseManager from './components/DatabaseManager.svelte'
  import RelayStatus from './components/RelayStatus.svelte'

  let todos = []
  let inputText = ''
  let assigneeText = ''
  let peers = []
  let myPeerId = null
  let loading = true
  let error = null
  let relayStatus = null
  let showRelayDetails = false
  let toastMessage = '';
  let dbAddress = null
  let dbName = null
  let selectedPeerId = '';
  let peerOrbitDbAddresses = new Map();
  let writePermissionRequests = [];
  let outgoingWritePermissionRequests = [];
  let showWritePermissions = false;
  let canWriteToCurrentDB = true;
  
  // Database Manager variables
  let showDatabaseDetails = false;
  let browserDatabases = [];
  let viewingDatabase = null;
  let databaseContents = {};
  let storageUsage = null;
  
  // IPFS Analyzer variables
  let showIPFSDetails = false;
  let ipfsAnalysis = null;

  // Services
  let toastService;
  let eventManager;
  let databaseSwitcher;
  let databaseManagerService;
  let ipfsAnalyzerService;
  let writePermissionManager;

  onMount(async () => {
    // Initialize services
    toastService = new ToastService((message) => {
      toastMessage = message;
    });
    
    // Initialize other services
    databaseManagerService = new DatabaseManagerService(toastService, formatBytes);
    ipfsAnalyzerService = new IPFSAnalyzerService(toastService, formatBytes, formatPeerId);
    writePermissionManager = new WritePermissionManager(toastService);
    
    // Initialize EventManager to handle P2P events
    eventManager = new EventManager(toastService, formatPeerId);
    
    // Initialize DatabaseSwitcher for database operations
    databaseSwitcher = new DatabaseSwitcher(toastService, formatPeerId);
    
    function updatePeerTransports(peerId, newTransport) {
      const peer = peers.find(p => p.peerId === peerId);
      if (peer) {
        // If the transport does not exist, add it
        if (!peer.transports.includes(newTransport)) {
          peer.transports.push(newTransport);
        }
        // Remove 'circuit-relay' if we have 'webrtc'
        if (newTransport === 'webrtc') {
          peer.transports = peer.transports.filter(type => type !== 'circuit-relay');
        }
        peers = [...peers]; // Trigger reactivity
      }
    }

    // Set up periodic peer transport updates to catch WebRTC upgrades
    let peerUpdateInterval;
    function startPeerTransportMonitoring() {
      peerUpdateInterval = setInterval(async () => {
        const updatedPeers = getConnectedPeers();
        let hasChanges = false;
        
        // Check if any peer's transports have changed
        for (const updatedPeer of updatedPeers) {
          const existingPeer = peers.find(p => p.peerId === updatedPeer.peerId);
          if (existingPeer) {
            // Compare transport arrays
            const existingTransports = existingPeer.transports.sort().join(',');
            const newTransports = updatedPeer.transports.sort().join(',');
            
            if (existingTransports !== newTransports) {
              console.log(`🔄 Transport change detected for ${formatPeerId(updatedPeer.peerId)}:`, {
                before: existingPeer.transports,
                after: updatedPeer.transports
              });
              hasChanges = true;
            }
          }
        }
        
        if (hasChanges || updatedPeers.length !== peers.length) {
          console.log('🔄 Updating peer list due to transport or connection changes');
          peers = updatedPeers;
        }
      }, 2000); // Check every 2 seconds for transport upgrades
    }
    try {
      await initializeP2P()
      todos = await getAllTodos()
      peers = getConnectedPeers()
      myPeerId = getMyPeerId()
      dbAddress = getTodoDbAddress()
      dbName = getTodoDbName()
      
      // Subscribe to database updates
      onDatabaseUpdate(async (eventType, eventData) => {
        console.log("eventType",eventType)
        console.log("eventData",eventData)
        // Only refresh for certain event types (optional, but matches +page.svelte)
        if (eventType === 'update'  || !eventType) {
          todos = await getAllTodos()
          peers = getConnectedPeers()
          dbAddress = getTodoDbAddress()
          dbName = getTodoDbName()
          if (eventType === 'update') {
            if (eventData?.type === 'PUT') {
              toastService.show('Todo added or updated!');
            } else if (eventData?.type === 'DEL') {
              toastService.show('Todo deleted!');
            } else {
              toastService.show('Todo updated!');
            }
          }
        }
      })

      // Listen for peer connect/disconnect events
      function updatePeers() {
        peers = getConnectedPeers()
      }

function handlePeerConnected(e) {
        const peerId = e.detail?.peerId || 'unknown';
        const newTransport = e.detail?.transport || '';
        updatePeerTransports(peerId, newTransport);
        updatePeers();
        console.log("handlePeerConnected",e.detail);
        toastService.show(`Peer connected: ${formatPeerId(peerId)}`);
      }

      function handlePeerDisconnected(e) {
        updatePeers();
        const peerId = e.detail?.peerId || 'unknown';
        toastService.show(`Peer disconnected: ${formatPeerId(peerId)}`);
      }

      window.addEventListener('p2p-peer-connected', handlePeerConnected);
      window.addEventListener('p2p-peer-disconnected', handlePeerDisconnected);

      // Listen for OrbitDB address updates
      function handleOrbitDbAddressUpdate(e) {
        console.log('📝 [UI DEBUG] OrbitDB address update event:', e.detail);
        const oldMap = new Map(peerOrbitDbAddresses);
        peerOrbitDbAddresses = getPeerOrbitDbAddresses();
        console.log('📝 [UI DEBUG] Peer OrbitDB map update:', {
          before: Array.from(oldMap.entries()),
          after: Array.from(peerOrbitDbAddresses.entries()),
          size: peerOrbitDbAddresses.size
        });
        const { peerId, topic: dbAddress } = e.detail || {};
        // Only show toast if it's not our own peerId
        if (peerId && peerId !== myPeerId) {
          toastService.show(`Received OrbitDB address from peer: ${formatPeerId(peerId)}`);
        }
      }
      window.addEventListener('orbitdb-database-discovered', handleOrbitDbAddressUpdate);
      
      // Listen for write permission request events
      function handleWritePermissionRequestSent(e) {
        const { targetPeerId } = e.detail;
        toastService.show(`📝 Write permission request sent to ${formatPeerId(targetPeerId)}`);
      }
      
      function handleWritePermissionGranted(e) {
        const { requesterPeerId } = e.detail;
        toastService.show(`✅ Write permission granted to ${formatPeerId(requesterPeerId)}`);
      }
      
      function handleWritePermissionRequestReceived(e) {
        const { requesterPeerId } = e.detail;
        toastService.show(`🔔 New write permission request from ${formatPeerId(requesterPeerId)}`);
      }
      
      window.addEventListener('write-permission-request-sent', handleWritePermissionRequestSent);
      window.addEventListener('write-permission-granted', handleWritePermissionGranted);
      window.addEventListener('write-permission-request-received', handleWritePermissionRequestReceived);
      // Initial fetch
      peerOrbitDbAddresses = getPeerOrbitDbAddresses();
      
      // Subscribe to write permission requests
      writePermissionRequestsStore.subscribe(requests => {
        writePermissionRequests = requests;
      });
      
  // Ensure write permission system is initialized and force refresh
  try {
    const { initializeWritePermissionSystem } = await import('./lib/write-permissions.js');
    console.log('🔍 [UI DEBUG] Manually ensuring write permission system initialization...');
    await initializeWritePermissionSystem();
    console.log('✅ [UI DEBUG] Write permission system initialized successfully');
  } catch (initError) {
    console.warn('⚠️ [UI DEBUG] Failed to initialize write permission system:', initError);
  }
  
  // Initial fetch of write permission requests
  updateWritePermissionRequests();

      // Start periodic peer transport monitoring
      startPeerTransportMonitoring();
      
      loading = false
    } catch (err) {
      error = err.message
      loading = false
    }

    // Clean up on destroy
    return () => {
      if (peerUpdateInterval) {
        clearInterval(peerUpdateInterval);
        console.log('🧹 Cleared peer transport monitoring interval');
      }
      window.removeEventListener('p2p-peer-connected', handlePeerConnected);
      window.removeEventListener('p2p-peer-disconnected', handlePeerDisconnected);
      window.removeEventListener('orbitdb-database-discovered', handleOrbitDbAddressUpdate);
      window.removeEventListener('write-permission-request-sent', handleWritePermissionRequestSent);
      window.removeEventListener('write-permission-granted', handleWritePermissionGranted);
      window.removeEventListener('write-permission-request-received', handleWritePermissionRequestReceived);
    }
  })

  async function handleAddTodo() {
    if (inputText.trim() !== '') {
      try {
        await addTodo(inputText, assigneeText || null)
        inputText = ''
        assigneeText = ''
      } catch (err) {
        error = err.message
      }
    }
  }

  async function handleToggleComplete(id) {
    const todo = todos.find(t => t.id === id)
    if (todo) {
      try {
        await updateTodo(id, { completed: !todo.completed })
      } catch (err) {
        error = err.message
      }
    }
  }

  async function handleDelete(id) {
    try {
      await deleteTodo(id)
    } catch (err) {
      error = err.message
    }
  }

  async function handleAssign(id, peerId) {
    try {
      await updateTodo(id, { assignee: peerId })
    } catch (err) {
      error = err.message
    }
  }

  async function handlePeerDbSwitch() {
    const wasLoading = loading;
    loading = true;
    
    try {
      // Use DatabaseSwitcher service to handle the complex switching logic
      const switchResult = await databaseSwitcher.switchToDatabase(selectedPeerId, {
        getHelia,
        openTodoDatabaseForPeer,
        getTodoDbAddress,
        getTodoDbName,
        getAllTodos,
        getConnectedPeers,
        getPeerOrbitDbAddresses,
        onDatabaseUpdate,
        hasWritePermission,
        requestWritePermission,
        updateWritePermissionRequests
      });
      
      // Update component state with results
      todos = switchResult.todos;
      dbAddress = switchResult.dbAddress;
      dbName = switchResult.dbName;
      peers = switchResult.peers;
      peerOrbitDbAddresses = switchResult.peerOrbitDbAddresses;
      
      // Update write permission requests if needed
      if (switchResult.writePermissionRequested) {
        await updateWritePermissionRequests();
      }
      
    } catch (err) {
      console.error('❌ Database switch failed:', err);
      error = err.message;
    } finally {
      loading = wasLoading;
    }
  }
  
  // Add write permission request functions
  async function updateWritePermissionRequests() {
    try {
      console.log('🔄 [UI DEBUG] Updating write permission requests...');
      console.log('🔄 [UI DEBUG] My peer ID from UI context:', myPeerId);
      
      const incomingRequests = await getMyWritePermissionRequests();
      const outgoingRequests = await getMyOutgoingWritePermissionRequests();
      
      console.log('🔄 [UI DEBUG] Got requests:', {
        incoming: incomingRequests.length,
        outgoing: outgoingRequests.length
      });
      
      writePermissionRequests = incomingRequests;
      outgoingWritePermissionRequests = outgoingRequests;
      
      // Check write permission for current database
      canWriteToCurrentDB = await hasWritePermission(dbAddress, selectedPeerId);
    } catch (err) {
      console.error('Failed to update write permission requests:', err);
    }
  }
  
  async function handleRequestWritePermission(targetPeerId) {
    if (!targetPeerId || !peerOrbitDbAddresses.has(targetPeerId)) {
toastService.show('Cannot request permission: peer database not found');
      return;
    }
    
    try {
      const targetDbAddress = peerOrbitDbAddresses.get(targetPeerId);
      const reason = `Requesting write access to collaborate on TODOs`;
      
      await requestWritePermission(targetDbAddress, targetPeerId, reason);
toastService.show(`Write permission request sent to ${formatPeerId(targetPeerId)}`);
      
      // Update UI
      await updateWritePermissionRequests();
    } catch (err) {
      console.error('Failed to request write permission:', err);
toastService.show('Failed to send write permission request');
    }
  }
  
  async function handleGrantWritePermission(requestId) {
    try {
      await grantWritePermission(requestId);
toastService.show('Write permission granted!');
      await updateWritePermissionRequests();
    } catch (err) {
      console.error('Failed to grant write permission:', err);
toastService.show('Failed to grant write permission');
    }
  }
  
  async function handleDenyWritePermission(requestId, reason = '') {
    try {
      await denyWritePermission(requestId, reason);
toastService.show('Write permission denied');
      await updateWritePermissionRequests();
    } catch (err) {
      console.error('Failed to deny write permission:', err);
toastService.show('Failed to deny write permission');
    }
  }
  
  // Database Manager Functions
  async function refreshDatabases() {
    try {
      console.log('🔄 Refreshing databases...');
      
      if (!indexedDB.databases) {
        console.warn('indexedDB.databases() not supported in this browser');
toastService.show('Database enumeration not supported in this browser');
        return;
      }
      
      // Get storage information
      let storageInfo = null;
      try {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
          storageInfo = await navigator.storage.estimate();
          console.log('💾 Storage usage info:', storageInfo);
        }
      } catch (error) {
        console.warn('⚠️ Could not get storage usage info:', error);
      }

      // Function to estimate database size
      async function getDatabaseSize(dbName) {
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
              
              // Get all records to estimate size
              const getAllRequest = store.getAll();
              const records = await new Promise((resolve) => {
                getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
                getAllRequest.onerror = () => resolve([]);
              });
              
              // Estimate size by serializing a sample and extrapolating
              if (records.length > 0) {
                // Sample first few records to estimate average size
                const sampleSize = Math.min(10, records.length);
                let sampleTotalSize = 0;
                
                for (let i = 0; i < sampleSize; i++) {
                  try {
                    const serialized = JSON.stringify(records[i]);
                    sampleTotalSize += serialized.length * 2; // UTF-16 encoding
                  } catch (e) {
                    // If JSON.stringify fails, estimate based on object structure
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
      
      const allDatabases = await indexedDB.databases();
      console.log('📊 All databases found:', allDatabases);
      
      // Get currently active database information
      const currentDbAddress = getTodoDbAddress();
      const currentDbName = getTodoDbName();
      
      console.log('🎯 Current active databases:', {
        orbitDbAddress: currentDbAddress,
        orbitDbName: currentDbName
      });
      
      // Filter databases that are likely from Libp2p, Helia, or OrbitDB
      let p2pDatabases = allDatabases.filter(db => {
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
               name.startsWith('/') // OrbitDB addresses start with /
      });
      
      // Try to enhance each database with additional metadata
      const enhancedDatabases = await Promise.all(
        p2pDatabases.map(async (db) => {
          const enhanced = { ...db };
          
          // Determine if this database is currently active
          enhanced.isActive = false;
          enhanced.activeType = null;
          
          // Check if this is the current OrbitDB
          if (
            (currentDbAddress && db.name === currentDbAddress) ||
            (currentDbName && db.name === currentDbName) ||
            (currentDbAddress && db.name.includes(currentDbAddress.split('/').pop())) // Match by DB hash
          ) {
            enhanced.isActive = true;
            enhanced.activeType = 'orbitdb';
            console.log('🎯 Found active OrbitDB:', db.name);
          }
          
          // Check if this looks like an active Helia/IPFS datastore
          // Helia typically uses databases with "helia" or specific patterns in the name
          if (!enhanced.isActive && (
            db.name.toLowerCase().includes('helia') ||
            db.name.toLowerCase().includes('blockstore') ||
            db.name.toLowerCase().includes('datastore')
          )) {
            // Additional check: look for recent activity or specific store names
            try {
              const request = indexedDB.open(db.name);
              const dbInstance = await new Promise((resolve, reject) => {
                request.onsuccess = (event) => resolve(event.target.result);
                request.onerror = () => reject(request.error);
              });
              
              const storeNames = Array.from(dbInstance.objectStoreNames);
              
              // Check for typical Helia/IPFS store patterns
              if (storeNames.some(name => 
                name.includes('blocks') || 
                name.includes('data') || 
                name.includes('pins') ||
                name.includes('metadata')
              )) {
                enhanced.isActive = true;
                enhanced.activeType = 'helia';
                console.log('🎯 Found active Helia/IPFS database:', db.name);
              }
              
              dbInstance.close();
            } catch (err) {
              // Ignore errors during active detection
            }
          }
          
          // Check if this looks like an active Libp2p datastore
          if (!enhanced.isActive && (
            db.name.toLowerCase().includes('libp2p') ||
            db.name.toLowerCase().includes('keystore') ||
            db.name.toLowerCase().endsWith('-keystore') ||
            db.name.toLowerCase().includes('peer-')
          )) {
            enhanced.isActive = true;
            enhanced.activeType = 'libp2p';
            console.log('🎯 Found active Libp2p database:', db.name);
          }
          
          // Check if this is a keystore database
          if (db.name.toLowerCase().endsWith('keystore')) {
            enhanced.isKeystore = true;
            enhanced.keystoreKeys = [];
            
            // Try to extract keystore information
            try {
              const request = indexedDB.open(db.name);
              const dbInstance = await new Promise((resolve, reject) => {
                request.onsuccess = (event) => resolve(event.target.result);
                request.onerror = () => reject(request.error);
              });
              
              const storeNames = Array.from(dbInstance.objectStoreNames);
              console.log('🔑 Keystore database stores:', storeNames);
              
              // Look for key-related stores
              for (const storeName of storeNames) {
                try {
                  const transaction = dbInstance.transaction(storeName, 'readonly');
                  const store = transaction.objectStore(storeName);
                  
                  // Get all keys from the store
                  const getAllKeysRequest = store.getAllKeys();
                  const rawKeys = await new Promise((resolve) => {
                    getAllKeysRequest.onsuccess = () => resolve(getAllKeysRequest.result || []);
                    getAllKeysRequest.onerror = () => resolve([]);
                  });
                  
                  // Convert ArrayBuffer keys to readable strings
                  const keys = rawKeys.map(key => {
                    if (key instanceof ArrayBuffer) {
                      const uint8Array = new Uint8Array(key);
                      
                      // Try to decode as UTF-8 string first
                      try {
                        // Check if it contains valid ASCII/UTF-8 characters
                        let isValidString = true;
                        for (let i = 0; i < uint8Array.length; i++) {
                          const byte = uint8Array[i];
                          // Allow printable ASCII (32-126) and common UTF-8 sequences
                          if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
                            // Allow tab, newline, carriage return, but reject other control chars
                            if (byte === 0 && i === uint8Array.length - 1) {
                              // Allow null terminator at end
                              continue;
                            }
                            isValidString = false;
                            break;
                          }
                          if (byte > 126 && byte < 128) {
                            // Reject extended ASCII that's not UTF-8
                            isValidString = false;
                            break;
                          }
                        }
                        
                        if (isValidString && uint8Array.length > 0) {
                          // Decode as UTF-8
                          const decoder = new TextDecoder('utf-8', { fatal: false });
                          const decoded = decoder.decode(uint8Array).replace(/\0+$/, ''); // Remove null terminators
                          
                          // Check if decoded string looks reasonable (not just weird characters)
                          if (decoded.length > 0 && /^[\x20-\x7E\s]*$/.test(decoded)) {
                            return `"${decoded}" (string)`;
                          }
                        }
                      } catch (e) {
                        // If UTF-8 decoding fails, fall through to hex
                      }
                      
                      // Fall back to hex representation
                      const hexString = Array.from(uint8Array)
                        .map(byte => byte.toString(16).padStart(2, '0'))
                        .join('');
                      
                      // Show truncated hex for very long keys
                      if (hexString.length > 64) {
                        return `${hexString.substring(0, 32)}...${hexString.substring(hexString.length - 16)} (hex, ${uint8Array.length} bytes)`;
                      } else {
                        return `${hexString} (hex, ${uint8Array.length} bytes)`;
                      }
                    } else if (key && typeof key === 'object' && key.constructor === Object) {
                      // If it's a plain object, try to stringify it
                      return JSON.stringify(key);
                    } else if (typeof key === 'string') {
                      return key;
                    } else {
                      // For other types, convert to string
                      return String(key);
                    }
                  });
                  
                  // Get some sample records to understand the structure
                  const getAllRequest = store.getAll(10); // Limit to 10 records
                  const records = await new Promise((resolve) => {
                    getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
                    getAllRequest.onerror = () => resolve([]);
                  });
                  
                  if (keys.length > 0 || records.length > 0) {
                    enhanced.keystoreKeys.push({
                      storeName,
                      keyCount: keys.length,
                      keys: keys.slice(0, 20), // First 20 keys
                      sampleRecords: records.map(record => {
                        // Try to extract meaningful info from the record
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
                      })
                    });
                  }
                } catch (err) {
                  console.warn('Error reading keystore store:', storeName, err);
                }
              }
              
              dbInstance.close();
              console.log('🔑 Keystore analysis complete:', enhanced.keystoreKeys);
              
            } catch (err) {
              console.warn('Error analyzing keystore database:', db.name, err);
            }
          }
          
          try {
            // Try to get additional info by opening the database briefly
            const request = indexedDB.open(db.name);
            const dbInstance = await new Promise((resolve, reject) => {
              request.onsuccess = (event) => resolve(event.target.result);
              request.onerror = () => reject(request.error);
            });
            
            // Count total records across all object stores
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
            
            enhanced.storeNames = storeNames;
            enhanced.totalRecords = totalRecords;
            enhanced.lastAccessed = new Date().toISOString();
            
            // Get estimated size
            enhanced.estimatedSize = await getDatabaseSize(db.name);
            
            dbInstance.close();
          } catch (error) {
            // If we can't open the database, just use basic info
            enhanced.storeNames = [];
            enhanced.totalRecords = 0;
            enhanced.lastAccessed = null;
            enhanced.estimatedSize = 0;
            console.warn(`Could not access metadata for database: ${db.name}`, error);
          }
          
          return enhanced;
        })
      );
      
      // Sort databases: active ones first, then by name
      enhancedDatabases.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return a.name.localeCompare(b.name);
      });
      
      browserDatabases = enhancedDatabases;
      
      const activeCount = enhancedDatabases.filter(db => db.isActive).length;
      
      // Calculate storage usage summary
      const totalEstimatedSize = enhancedDatabases.reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
      const activeDatabasesSize = enhancedDatabases.filter(db => db.isActive).reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
      const inactiveDatabasesSize = enhancedDatabases.filter(db => !db.isActive).reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
      
      // Group by type
      const orbitDbSize = enhancedDatabases.filter(db => db.activeType === 'orbitdb').reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
      const heliaSize = enhancedDatabases.filter(db => db.activeType === 'helia').reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
      const libp2pSize = enhancedDatabases.filter(db => db.activeType === 'libp2p').reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
      const otherSize = enhancedDatabases.filter(db => !db.activeType).reduce((sum, db) => sum + (db.estimatedSize || 0), 0);
      
      storageUsage = {
        used: storageInfo?.usage || 0,
        quota: storageInfo?.quota || 0,
        p2pDatabases: {
          total: enhancedDatabases.length,
          active: activeCount,
          inactive: enhancedDatabases.length - activeCount,
          totalSize: totalEstimatedSize,
          activeDatabasesSize,
          inactiveDatabasesSize,
          byType: {
            orbitdb: { count: enhancedDatabases.filter(db => db.activeType === 'orbitdb').length, size: orbitDbSize },
            helia: { count: enhancedDatabases.filter(db => db.activeType === 'helia').length, size: heliaSize },
            libp2p: { count: enhancedDatabases.filter(db => db.activeType === 'libp2p').length, size: libp2pSize },
            other: { count: enhancedDatabases.filter(db => !db.activeType).length, size: otherSize }
          }
        }
      };
      
      console.log('🗄️ Enhanced P2P databases with size analysis:', {
        total: browserDatabases.length,
        active: activeCount,
        inactive: browserDatabases.length - activeCount,
        totalEstimatedSize: formatBytes(totalEstimatedSize),
        storageUsage
      });
      
toastService.show(`Found ${browserDatabases.length} P2P database(s) (${activeCount} active) - ${formatBytes(totalEstimatedSize)}`);
    } catch (error) {
      console.error('❌ Error refreshing databases:', error);
toastService.show('Failed to refresh databases');
    }
  }
  
  async function viewDatabaseContents(dbName) {
    try {
      if (viewingDatabase === dbName) {
        // Hide if already viewing
        viewingDatabase = null;
        return;
      }
      
      console.log('👀 Viewing database contents:', dbName);
toastService.show('Loading database contents...');
      
      const request = indexedDB.open(dbName);
      
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
            
            // Get all records (limit to first 20 for performance)
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
          
          databaseContents[dbName] = storeContents;
          viewingDatabase = dbName;
          databaseContents = { ...databaseContents }; // Trigger reactivity
          
toastService.show(`Loaded contents for ${dbName}`);
        } catch (error) {
          console.error('Error reading store contents:', error);
toastService.show('Failed to read database contents');
        } finally {
          db.close();
        }
      };
      
      request.onerror = () => {
        console.error('Error opening database:', request.error);
toastService.show('Failed to open database');
      };
      
    } catch (error) {
      console.error('❌ Error viewing database contents:', error);
toastService.show('Failed to view database contents');
    }
  }
  
  async function deleteSingleDatabase(dbName) {
    if (!confirm(`Are you sure you want to delete the database "${dbName}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      console.log('🗑️ Deleting database:', dbName);
      
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      
      deleteRequest.onsuccess = () => {
        console.log('✅ Database deleted:', dbName);
toastService.show(`Database "${dbName}" deleted`);
        
        // Find the deleted database to get its size
        const deletedDb = browserDatabases.find(db => db.name === dbName);
        const deletedSize = deletedDb?.estimatedSize || 0;
        
        // Remove from our list
        browserDatabases = browserDatabases.filter(db => db.name !== dbName);
        
        // Update storage usage if it exists
        if (storageUsage && deletedDb) {
          // Update total size
          storageUsage.p2pDatabases.totalSize -= deletedSize;
          
          // Update active/inactive sizes
          if (deletedDb.isActive) {
            storageUsage.p2pDatabases.activeDatabasesSize -= deletedSize;
            storageUsage.p2pDatabases.active -= 1;
          } else {
            storageUsage.p2pDatabases.inactiveDatabasesSize -= deletedSize;
            storageUsage.p2pDatabases.inactive -= 1;
          }
          
          // Update by type
          if (deletedDb.activeType) {
            const typeKey = deletedDb.activeType;
            if (storageUsage.p2pDatabases.byType[typeKey]) {
              storageUsage.p2pDatabases.byType[typeKey].size -= deletedSize;
              storageUsage.p2pDatabases.byType[typeKey].count -= 1;
            }
          } else {
            storageUsage.p2pDatabases.byType.other.size -= deletedSize;
            storageUsage.p2pDatabases.byType.other.count -= 1;
          }
          
          // Update total count
          storageUsage.p2pDatabases.total -= 1;
          
          // Trigger reactivity
          storageUsage = { ...storageUsage };
        }
        
        // Clear viewing state if we were viewing this database
        if (viewingDatabase === dbName) {
          viewingDatabase = null;
          delete databaseContents[dbName];
          databaseContents = { ...databaseContents };
        }
      };
      
      deleteRequest.onerror = () => {
        console.error('❌ Error deleting database:', deleteRequest.error);
toastService.show(`Failed to delete database "${dbName}"`);
      };
      
      deleteRequest.onblocked = () => {
        console.warn('⚠️ Database deletion blocked - close all tabs and try again');
toastService.show('Database deletion blocked - close other tabs and try again');
      };
      
    } catch (error) {
      console.error('❌ Error deleting database:', error);
toastService.show('Failed to delete database');
    }
  }
  
  async function deleteAllInactiveDatabases() {
    const inactiveDatabases = browserDatabases.filter(db => !db.isActive);
    
    if (inactiveDatabases.length === 0) {
toastService.show('No inactive databases to delete');
      return;
    }
    
    if (!confirm(`Are you sure you want to delete ${inactiveDatabases.length} inactive P2P databases? This action cannot be undone.`)) {
      return;
    }
    
    try {
      console.log('🗑️ Deleting inactive databases:', inactiveDatabases.length);
toastService.show('Deleting inactive databases...');
      
      let deletedCount = 0;
      let failedCount = 0;
      
      for (const db of inactiveDatabases) {
        try {
          await new Promise((resolve, reject) => {
            const deleteRequest = indexedDB.deleteDatabase(db.name);
            
            deleteRequest.onsuccess = () => {
              console.log('✅ Deleted inactive database:', db.name);
              deletedCount++;
              resolve();
            };
            
            deleteRequest.onerror = () => {
              console.error('❌ Failed to delete inactive database:', db.name, deleteRequest.error);
              failedCount++;
              reject(deleteRequest.error);
            };
            
            deleteRequest.onblocked = () => {
              console.warn('⚠️ Deletion blocked for inactive database:', db.name);
              failedCount++;
              reject(new Error('Deletion blocked'));
            };
          });
        } catch (error) {
          console.error('Error deleting inactive database:', db.name, error);
          failedCount++;
        }
      }
      
      // Update our state - remove deleted databases
      browserDatabases = browserDatabases.filter(db => db.isActive || !inactiveDatabases.some(deleted => deleted.name === db.name));
      
      // Clear viewing state if we were viewing a deleted database
      if (viewingDatabase && inactiveDatabases.some(db => db.name === viewingDatabase)) {
        viewingDatabase = null;
        delete databaseContents[viewingDatabase];
        databaseContents = { ...databaseContents };
      }
      
      if (failedCount === 0) {
toastService.show(`✅ Successfully deleted ${deletedCount} inactive databases`);
      } else {
toastService.show(`⚠️ Deleted ${deletedCount} inactive databases, failed to delete ${failedCount}`);
      }
      
      console.log(`🧹 Inactive database cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);
      
    } catch (error) {
      console.error('❌ Error during inactive database deletion:', error);
toastService.show('Failed to delete inactive databases');
    }
  }
  
  async function deleteAllDatabases() {
    if (!confirm(`Are you sure you want to delete ALL ${browserDatabases.length} P2P databases? This action cannot be undone and will reset all your P2P data.`)) {
      return;
    }
    
    const secondConfirm = confirm('This will delete all Libp2p, Helia, and OrbitDB data. Are you absolutely sure?');
    if (!secondConfirm) {
      return;
    }
    
    try {
      console.log('🗑️ Deleting all databases:', browserDatabases.length);
toastService.show('Deleting all databases...');
      
      let deletedCount = 0;
      let failedCount = 0;
      
      for (const db of browserDatabases) {
        try {
          await new Promise((resolve, reject) => {
            const deleteRequest = indexedDB.deleteDatabase(db.name);
            
            deleteRequest.onsuccess = () => {
              console.log('✅ Deleted:', db.name);
              deletedCount++;
              resolve();
            };
            
            deleteRequest.onerror = () => {
              console.error('❌ Failed to delete:', db.name, deleteRequest.error);
              failedCount++;
              reject(deleteRequest.error);
            };
            
            deleteRequest.onblocked = () => {
              console.warn('⚠️ Deletion blocked:', db.name);
              failedCount++;
              reject(new Error('Deletion blocked'));
            };
          });
        } catch (error) {
          console.error('Error deleting database:', db.name, error);
          failedCount++;
        }
      }
      
      // Clear our state
      browserDatabases = [];
      viewingDatabase = null;
      databaseContents = {};
      
      if (failedCount === 0) {
toastService.show(`✅ Successfully deleted all ${deletedCount} databases`);
      } else {
toastService.show(`⚠️ Deleted ${deletedCount} databases, failed to delete ${failedCount}`);
      }
      
      console.log(`🧹 Database cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);
      
    } catch (error) {
      console.error('❌ Error during bulk database deletion:', error);
toastService.show('Failed to delete all databases');
    }
  }
  
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  // IPFS Analysis Functions
  async function analyzeIPFS() {
    try {
      console.log('🔍 Starting IPFS analysis...');
toastService.show('Analyzing IPFS node...');
      
      const { getHelia } = await import('./lib/p2p/network.js');
      const helia = getHelia();
      
      if (!helia) {
        throw new Error('Helia instance not available');
      }
      
      const analysis = {
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
      
      // Get identity info
      try {
        const peerId = helia.libp2p.peerId;
        analysis.identity = {
          peerId: peerId.toString(),
          publicKey: peerId.publicKey ? peerId.publicKey.toString('hex') : null,
          keyType: peerId.type || 'Unknown'
        };
      } catch (err) {
        console.warn('Could not get identity info:', err);
      }
      
      // Get pinned content
      try {
        const pins = helia.pins.ls();
        
        for await (const pin of pins) {
          const cid = pin.cid.toString();
          
          // Get pin details
          let size = 0;
          let blocks = 0;
          let metadata = {};
          
          try {
            // For recursive pins, try to calculate DAG size
            if (pin.type === 'recursive') {
              console.log(`🌳 Calculating recursive DAG size for ${cid.substring(0, 12)}...`);
              
              // Try to walk the DAG and sum all blocks
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
                  size = totalSize;
                  blocks = blockCount;
                  console.log(`🌳 Recursive pin ${cid.substring(0, 12)}... DAG size: ${size} bytes (${blocks} blocks)`);
                } else {
                  // Fallback: try to get just the root block
                  const rootBlock = await helia.blockstore.get(pin.cid);
                  size = rootBlock.bytes.length;
                  blocks = 1;
                  console.log(`📦 Recursive pin ${cid.substring(0, 12)}... root block only: ${size} bytes`);
                }
              } catch (dagErr) {
                console.warn(`⚠️ DAG walk failed for ${cid.substring(0, 12)}:`, dagErr.message);
                // Fallback to root block
                try {
                  const rootBlock = await helia.blockstore.get(pin.cid);
                  size = rootBlock.bytes.length;
                  blocks = 1;
                  console.log(`📦 Recursive pin ${cid.substring(0, 12)}... fallback to root: ${size} bytes`);
                } catch (rootErr) {
                  size = 4096; // Larger default for recursive pins
                  console.log(`⚠️ Recursive pin ${cid.substring(0, 12)}... using large default: ${size} bytes`);
                }
              }
            } else {
              // For direct pins, just get the single block
              try {
                const block = await helia.blockstore.get(pin.cid);
                size = block.bytes.length;
                blocks = 1;
                console.log(`📦 Direct pin ${cid.substring(0, 12)}... size: ${size} bytes`);
              } catch (blockErr) {
                console.warn(`⚠️ Could not get block for direct pin ${cid.substring(0, 12)}:`, blockErr.message);
                size = 256; // Smaller default for direct pins
                console.log(`⚠️ Direct pin ${cid.substring(0, 12)}... using small default: ${size} bytes`);
              }
            }
          } catch (err) {
            console.error(`❌ Error calculating size for pin ${cid.substring(0, 12)}:`, err);
            size = pin.type === 'recursive' ? 4096 : 256;
            console.log(`⚠️ Pin ${cid.substring(0, 12)}... using ${pin.type} default: ${size} bytes`);
          }
          
          // Check if this might be an OrbitDB CID
          if (pin.type === 'recursive') {
            try {
              // Try to decode as OrbitDB manifest
              const block = await helia.blockstore.get(pin.cid);
              const decoded = JSON.parse(new TextDecoder().decode(block.bytes));
              
              if (decoded.type && (decoded.type === 'orbitdb' || decoded.name)) {
                metadata.isOrbitDB = true;
                metadata.dbType = decoded.type;
                metadata.dbName = decoded.name;
              }
            } catch (err) {
              // Not an OrbitDB manifest, continue
            }
          }
          
          if (blocks > 0) {
            metadata.blocks = blocks;
          }
          
          metadata.lastAccessed = new Date().toISOString();
          
          analysis.pins.push({
            cid,
            type: pin.type,
            size,
            metadata
          });
          
          // Update summary
          analysis.summary.totalPins++;
          analysis.summary.totalSize += size;
          
          if (pin.type === 'recursive') {
            analysis.summary.recursivePins++;
          } else {
            analysis.summary.directPins++;
          }
          
          if (metadata.isOrbitDB) {
            analysis.summary.orbitDatabases++;
            analysis.summary.orbitDbSize += size;
          }
        }
      } catch (err) {
        console.warn('Could not analyze pins:', err);
      }
      
      // Analyze OrbitDB databases from current app context
      try {
        const currentDbAddress = getTodoDbAddress();
        const currentDbName = getTodoDbName();
        const myPeerIdStr = getMyPeerId();
        
        console.log('🔍 [IPFS Analysis Debug] Database detection values:', {
          currentDbAddress,
          currentDbName,
          myPeerIdStr,
          peerOrbitDbAddressesSize: peerOrbitDbAddresses.size,
          peerOrbitDbAddresses: Array.from(peerOrbitDbAddresses.entries()),
          todosLength: todos.length
        });
        
        // Create a set to track processed databases
        const processedDatabases = new Set();
        
        // Add current database info (fix for null dbName)
        if (currentDbAddress) {
          const displayName = currentDbName || 'My TODO Database';
          console.log('✅ [IPFS Analysis Debug] Adding current database as own:', {
            address: currentDbAddress,
            name: displayName,
            originalDbName: currentDbName
          });
          // Try to get database size from our storage analysis
          let dbSize = 0;
          if (storageUsage) {
            dbSize = storageUsage.p2pDatabases.byType.orbitdb.size || 0;
          }
          
          analysis.orbitDatabases.push({
            address: currentDbAddress,
            name: currentDbName,
            type: 'documents', // Our todo app uses documents store
            isOwn: true, // Current database is always ours
            size: dbSize,
            identity: {
              id: myPeerIdStr,
              publicKey: analysis.identity?.publicKey
            },
            records: todos.length
          });
          
          analysis.summary.ownDatabases++;
          analysis.summary.todoDbCount++;
          processedDatabases.add(currentDbAddress);
        }
        
        // Add my own write permission database
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
          
          analysis.orbitDatabases.push({
            address: myWritePermissionDbAddress,
            name: myWritePermissionDbName || 'My Write Permission Database',
            type: 'write-permissions',
            isOwn: true,
            size: 0, // We could get this from storage analysis if needed
            identity: {
              id: myPeerIdStr,
              publicKey: analysis.identity?.publicKey
            },
            records: requestCount
          });
          
          analysis.summary.ownDatabases++;
          analysis.summary.writePermissionDbCount++;
          processedDatabases.add(myWritePermissionDbAddress);
        }
        
        // Add peer TODO databases from peerOrbitDbAddresses (excluding our own)
        for (const [peerId, dbAddress] of peerOrbitDbAddresses.entries()) {
          // Skip if we already processed this database or if it's our own
          if (!processedDatabases.has(dbAddress) && peerId !== myPeerIdStr) {
            console.log('📋 [IPFS Analysis Debug] Adding peer TODO database:', {
              peerId: formatPeerId(peerId),
              address: dbAddress
            });
            
            analysis.orbitDatabases.push({
              address: dbAddress,
              name: `${formatPeerId(peerId)}'s TODO Database`,
              type: 'documents',
              isOwn: false,
              size: 0, // We don't know the size of peer databases
              identity: {
                id: peerId,
                publicKey: null // We don't have peer public keys
              },
              records: 0 // We don't know record count
            });
            
            analysis.summary.peerDatabases++;
            analysis.summary.todoDbCount++;
            processedDatabases.add(dbAddress);
          }
        }
        
        // Add peer write permission databases
        const peerWritePermissionDbAddresses = getPeerWritePermissionDbAddresses();
        console.log('🔐 [IPFS Analysis Debug] Write permission databases:', {
          size: peerWritePermissionDbAddresses.size,
          entries: Array.from(peerWritePermissionDbAddresses.entries())
        });
        
        for (const [peerId, dbAddress] of peerWritePermissionDbAddresses.entries()) {
          // Skip if we already processed this database or if it's our own
          if (!processedDatabases.has(dbAddress) && peerId !== myPeerIdStr) {
            console.log('🔐 [IPFS Analysis Debug] Adding peer write permission database:', {
              peerId: formatPeerId(peerId),
              address: dbAddress
            });
            
            analysis.orbitDatabases.push({
              address: dbAddress,
              name: `${formatPeerId(peerId)}'s Write Permission Database`,
              type: 'write-permissions',
              isOwn: false,
              size: 0, // We don't know the size of peer databases
              identity: {
                id: peerId,
                publicKey: null // We don't have peer public keys
              },
              records: 0 // We don't know record count
            });
            
            analysis.summary.peerDatabases++;
            analysis.summary.writePermissionDbCount++;
            processedDatabases.add(dbAddress);
          }
        }
      } catch (err) {
        console.warn('Could not analyze OrbitDB databases:', err);
      }
      
      ipfsAnalysis = analysis;
      
      console.log('🔍 IPFS analysis complete:', {
        totalPins: analysis.summary.totalPins,
        totalSize: formatBytes(analysis.summary.totalSize),
        orbitDatabases: analysis.summary.orbitDatabases,
        ownDatabases: analysis.summary.ownDatabases,
        peerDatabases: analysis.summary.peerDatabases
      });
      
toastService.show(`IPFS analysis complete: ${analysis.summary.totalPins} pins, ${analysis.summary.orbitDatabases} OrbitDB databases`);
      
    } catch (error) {
      console.error('❌ Error during IPFS analysis:', error);
toastService.show('Failed to analyze IPFS node');
    }
  }
</script>

<Toast message={toastMessage} />

<svelte:head>
  <title>P2P TODO List {__APP_VERSION__}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="A peer-to-peer TODO list application using OrbitDB and IPFS">
</svelte:head>

<main class="container mx-auto p-6 max-w-4xl">
  <h1 class="text-3xl font-bold mb-6 text-center">P2P TODO List</h1>

  <DatabaseSelector 
    bind:selectedPeerId
    {peers}
    {peerOrbitDbAddresses}
    onDatabaseSwitch={handlePeerDbSwitch}
  />

  <LoadingState {loading} {error} />
  
  {#if !loading && !error}
    <TodoForm 
      bind:inputText
      bind:assigneeText
      {peers}
      onAddTodo={handleAddTodo}
    />

    <TodoList 
      {todos}
      {peers}
      onToggleComplete={handleToggleComplete}
      onDelete={handleDelete}
      onAssign={handleAssign}
    />

    <PeerStatus {peers} {myPeerId} />

    <WritePermissions 
      {showWritePermissions}
      {canWriteToCurrentDB}
      {dbAddress}
      {selectedPeerId}
      {writePermissionRequests}
      {outgoingWritePermissionRequests}
      {formatPeerId}
      onToggleShow={() => { showWritePermissions = !showWritePermissions; updateWritePermissionRequests(); }}
      onRequestWritePermission={handleRequestWritePermission}
      onGrantWritePermission={handleGrantWritePermission}
      onDenyWritePermission={handleDenyWritePermission}
    />

    <IPFSAnalyzer 
      {showIPFSDetails}
      {ipfsAnalysis}
      {formatBytes}
      {formatPeerId}
      onRefreshIPFSAnalysis={analyzeIPFS}
      onToggleShow={() => { showIPFSDetails = !showIPFSDetails; if (showIPFSDetails && !ipfsAnalysis) analyzeIPFS(); }}
    />

    <DatabaseManager 
      {showDatabaseDetails}
      {browserDatabases}
      {viewingDatabase}
      {databaseContents}
      {storageUsage}
      {formatBytes}
      onRefreshDatabases={refreshDatabases}
      onToggleShow={() => { showDatabaseDetails = !showDatabaseDetails; if (showDatabaseDetails) refreshDatabases(); }}
      onViewDatabaseContents={viewDatabaseContents}
      onDeleteSingleDatabase={deleteSingleDatabase}
      onDeleteAllDatabases={deleteAllDatabases}
      onDeleteAllInactiveDatabases={deleteAllInactiveDatabases}
    />

    <RelayStatus 
      {showRelayDetails}
      {relayStatus}
      {formatPeerId}
      onToggleShow={async () => {
        relayStatus = await getRelayDiscoveryStatus()
        
        // Also fetch discovery result to get full address info
        try {
          const discoveryResult = await discoverRelay()
          relayStatus.discoveryResult = discoveryResult
        } catch (error) {
          console.warn('Failed to fetch discovery result:', error)
        }
        
        showRelayDetails = !showRelayDetails
      }}
      onRefreshCache={async () => {
        console.log('🔘 Refresh Cache button clicked!');
        
        try {
          // First ensure relay discovery is properly configured
          console.log('📊 Getting relay discovery status to ensure proper configuration...');
          await getRelayDiscoveryStatus();
          
          // Clear cache and fetch fresh data
          const { getRelayDiscovery } = await import('./utils/relay-discovery.js')
          const relayDiscoveryInstance = getRelayDiscovery();
          console.log('🔧 Using relay discovery instance with URL:', relayDiscoveryInstance.relayHttpUrl);
          
          relayDiscoveryInstance.clearCache()
          console.log('🧹 Cleared relay discovery cache')
          
          // Immediately fetch fresh data
          relayStatus = await getRelayDiscoveryStatus()
          console.log('📊 Updated relay status:', relayStatus);
          
          const discoveryResult = await discoverRelay()
          relayStatus.discoveryResult = discoveryResult
          console.log('🔄 Fetched fresh relay discovery data:', discoveryResult);
          
        } catch (error) {
          console.error('❌ Error during refresh:', error);
        }
      }}
    />
    {/if}
  </main>

<footer class="mt-10 text-center text-xs text-gray-500 space-y-1">
  <div class="font-medium text-gray-600">
    P2P TODO List v{__APP_VERSION__}
  </div>
  {#if dbAddress}
    <div>
      <strong>OrbitDB Address:</strong>
      <code class="bg-gray-100 px-1 rounded">{dbAddress}</code>
    </div>
  {/if}
  {#if dbName}
    <div>
      <strong>DB Name:</strong>
      <code class="bg-gray-100 px-1 rounded">{dbName}</code>
    </div>
  {/if}
</footer>
