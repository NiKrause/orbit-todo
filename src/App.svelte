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
  import { discoverRelay } from './utils/relay-discovery.js'
  import { getHelia } from './lib/p2p/network.js'

  // Import components
  import Toast from './components/Toast.svelte'
  import LoadingState from './components/LoadingState.svelte'
  import DatabaseSelector from './components/DatabaseSelector.svelte'
  import TodoForm from './components/TodoForm.svelte'
  import TodoList from './components/TodoList.svelte'
  import PeerStatus from './components/PeerStatus.svelte'
  import WritePermissions from './components/WritePermissions.svelte'
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
  let toastTimeout;
  let dbAddress = null
  let dbName = null
  let selectedPeerId = '';
  let peerOrbitDbAddresses = new Map();
  let cleanupDatabaseListener = null;
  let writePermissionRequests = [];
  let outgoingWritePermissionRequests = [];
  let showWritePermissions = false;
  let canWriteToCurrentDB = true;
  
  // Database Manager variables
  let showDatabaseDetails = false;
  let browserDatabases = [];
  let viewingDatabase = null;
  let databaseContents = {};

  function showToast(message) {
    toastMessage = message;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastMessage = '';
    }, 1500); // Toast visible for 1.5 seconds
  }

  onMount(async () => {
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
              showToast('Todo added or updated!');
            } else if (eventData?.type === 'DEL') {
              showToast('Todo deleted!');
            } else {
              showToast('Todo updated!');
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
        showToast(`Peer connected: ${formatPeerId(peerId)}`);
      }

      function handlePeerDisconnected(e) {
        updatePeers();
        const peerId = e.detail?.peerId || 'unknown';
        showToast(`Peer disconnected: ${formatPeerId(peerId)}`);
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
          showToast(`Received OrbitDB address from peer: ${formatPeerId(peerId)}`);
        }
      }
      window.addEventListener('orbitdb-database-discovered', handleOrbitDbAddressUpdate);
      
      // Listen for write permission request events
      function handleWritePermissionRequestSent(e) {
        const { targetPeerId } = e.detail;
        showToast(`📝 Write permission request sent to ${formatPeerId(targetPeerId)}`);
      }
      
      function handleWritePermissionGranted(e) {
        const { requesterPeerId } = e.detail;
        showToast(`✅ Write permission granted to ${formatPeerId(requesterPeerId)}`);
      }
      
      function handleWritePermissionRequestReceived(e) {
        const { requesterPeerId } = e.detail;
        showToast(`🔔 New write permission request from ${formatPeerId(requesterPeerId)}`);
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
    try {
      console.log('🔄 Starting database switch to:', selectedPeerId || 'default');
      
      // Show loading state during switch
      const wasLoading = loading;
      loading = true;
      
      try {
        // Step 1: Switch to the new database
        console.log('📍 Opening database for peer:', selectedPeerId);
        const helia = getHelia();
        if (!helia) {
          throw new Error('Helia instance not available');
        }
        await openTodoDatabaseForPeer(selectedPeerId, helia);
        
        // Step 2: Wait a moment for database to initialize
        console.log('⏳ Waiting for database to initialize...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 3: Update database info
        dbAddress = getTodoDbAddress();
        dbName = getTodoDbName();
        console.log('📊 Database info updated:', { address: dbAddress, name: dbName });
        
        // Step 4: Fetch todos from the new database
        console.log('📋 Fetching todos from new database...');
        const newTodos = await getAllTodos();
        todos = newTodos;
        console.log('✅ Loaded', newTodos.length, 'todos from new database');
        
        // Step 5: Update other state
        peers = getConnectedPeers();
        peerOrbitDbAddresses = getPeerOrbitDbAddresses();
        
        // Step 6: Re-setup database event listeners for reactive updates
        console.log('🔄 Re-setting up database event listeners...');
        if (cleanupDatabaseListener) {
          cleanupDatabaseListener();
        }
        cleanupDatabaseListener = onDatabaseUpdate((eventType, eventData) => {
          console.log('📝 Database update received:', eventType, eventData);
          // Refresh todos when database updates
          getAllTodos().then(refreshedTodos => {
            todos = refreshedTodos;
            console.log('🔄 Todos refreshed after database update:', refreshedTodos.length);
          }).catch(err => {
            console.error('Error refreshing todos after database update:', err);
          });
        });
        
        // Check if we need to request write permission
        console.log('🔍 [DEBUG] Checking write permissions:', {
          selectedPeerId,
          dbAddress,
          hasSelectedPeer: !!selectedPeerId,
          hasPeerDbAddress: peerOrbitDbAddresses.has(selectedPeerId)
        });
        
        const canWrite = await hasWritePermission(dbAddress, selectedPeerId);
        console.log('🔍 [DEBUG] Write permission check result:', {
          canWrite,
          dbAddress,
          selectedPeerId
        });
        
        if (selectedPeerId && !canWrite) {
          // Automatically request write permission when switching to a peer's database
          console.log('🔐 No write permission detected, requesting permission...');
          console.log('🔍 [DEBUG] Requesting write permission with params:', {
            dbAddress,
            selectedPeerId,
            peerDbAddress: peerOrbitDbAddresses.get(selectedPeerId)
          });
          
          try {
            const reason = 'Requesting write access to collaborate on TODOs';
            const permissionRequest = await requestWritePermission(dbAddress, selectedPeerId, reason);
            console.log('✅ [DEBUG] Write permission request created:', permissionRequest);
            showToast(`📝 Write permission requested from ${formatPeerId(selectedPeerId)}`);
            
            // Force update the write permission requests UI immediately
            await updateWritePermissionRequests();
          } catch (err) {
            console.error('❌ Failed to auto-request write permission:', err);
            showToast('❌ Failed to request write permission');
          }
        } else if (selectedPeerId && canWrite) {
          console.log('✅ Already have write permission for this database');
        } else if (!selectedPeerId) {
          console.log('🏠 Switched to own database - no permission request needed');
        }
        
        showToast(selectedPeerId ? 
          `Switched to ${formatPeerId(selectedPeerId)}'s DB (${newTodos.length} todos)` : 
          `Switched to default DB (${newTodos.length} todos)`);
        
        console.log('✅ Database switch completed successfully');
        
      } finally {
        // Always restore loading state
        loading = wasLoading;
      }
      
    } catch (err) {
      console.error('❌ Database switch failed:', err);
      error = err.message;
      loading = false
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
      showToast('Cannot request permission: peer database not found');
      return;
    }
    
    try {
      const targetDbAddress = peerOrbitDbAddresses.get(targetPeerId);
      const reason = `Requesting write access to collaborate on TODOs`;
      
      await requestWritePermission(targetDbAddress, targetPeerId, reason);
      showToast(`Write permission request sent to ${formatPeerId(targetPeerId)}`);
      
      // Update UI
      await updateWritePermissionRequests();
    } catch (err) {
      console.error('Failed to request write permission:', err);
      showToast('Failed to send write permission request');
    }
  }
  
  async function handleGrantWritePermission(requestId) {
    try {
      await grantWritePermission(requestId);
      showToast('Write permission granted!');
      await updateWritePermissionRequests();
    } catch (err) {
      console.error('Failed to grant write permission:', err);
      showToast('Failed to grant write permission');
    }
  }
  
  async function handleDenyWritePermission(requestId, reason = '') {
    try {
      await denyWritePermission(requestId, reason);
      showToast('Write permission denied');
      await updateWritePermissionRequests();
    } catch (err) {
      console.error('Failed to deny write permission:', err);
      showToast('Failed to deny write permission');
    }
  }
  
  // Database Manager Functions
  async function refreshDatabases() {
    try {
      console.log('🔄 Refreshing databases...');
      
      if (!indexedDB.databases) {
        console.warn('indexedDB.databases() not supported in this browser');
        showToast('Database enumeration not supported in this browser');
        return;
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
          if (!enhanced.isActive && db.name.toLowerCase().includes('libp2p')) {
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
            enhanced.lastAccessed = new Date().toISOString(); // Current time as "last accessed"
            
            dbInstance.close();
          } catch (error) {
            // If we can't open the database, just use basic info
            enhanced.storeNames = [];
            enhanced.totalRecords = 0;
            enhanced.lastAccessed = null;
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
      console.log('🗄️ Enhanced P2P databases found:', {
        total: browserDatabases.length,
        active: activeCount,
        inactive: browserDatabases.length - activeCount
      });
      
      showToast(`Found ${browserDatabases.length} P2P database(s) (${activeCount} active)`);
    } catch (error) {
      console.error('❌ Error refreshing databases:', error);
      showToast('Failed to refresh databases');
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
      showToast('Loading database contents...');
      
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
          
          showToast(`Loaded contents for ${dbName}`);
        } catch (error) {
          console.error('Error reading store contents:', error);
          showToast('Failed to read database contents');
        } finally {
          db.close();
        }
      };
      
      request.onerror = () => {
        console.error('Error opening database:', request.error);
        showToast('Failed to open database');
      };
      
    } catch (error) {
      console.error('❌ Error viewing database contents:', error);
      showToast('Failed to view database contents');
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
        showToast(`Database "${dbName}" deleted`);
        
        // Remove from our list
        browserDatabases = browserDatabases.filter(db => db.name !== dbName);
        
        // Clear viewing state if we were viewing this database
        if (viewingDatabase === dbName) {
          viewingDatabase = null;
          delete databaseContents[dbName];
          databaseContents = { ...databaseContents };
        }
      };
      
      deleteRequest.onerror = () => {
        console.error('❌ Error deleting database:', deleteRequest.error);
        showToast(`Failed to delete database "${dbName}"`);
      };
      
      deleteRequest.onblocked = () => {
        console.warn('⚠️ Database deletion blocked - close all tabs and try again');
        showToast('Database deletion blocked - close other tabs and try again');
      };
      
    } catch (error) {
      console.error('❌ Error deleting database:', error);
      showToast('Failed to delete database');
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
      showToast('Deleting all databases...');
      
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
        showToast(`✅ Successfully deleted all ${deletedCount} databases`);
      } else {
        showToast(`⚠️ Deleted ${deletedCount} databases, failed to delete ${failedCount}`);
      }
      
      console.log(`🧹 Database cleanup complete: ${deletedCount} deleted, ${failedCount} failed`);
      
    } catch (error) {
      console.error('❌ Error during bulk database deletion:', error);
      showToast('Failed to delete all databases');
    }
  }
</script>

{#if toastMessage}
  <div class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300">
    {toastMessage}
  </div>
{/if}

<svelte:head>
  <title>P2P TODO List {__APP_VERSION__}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="A peer-to-peer TODO list application using OrbitDB and IPFS">
</svelte:head>

<main class="container mx-auto p-6 max-w-4xl">
  <h1 class="text-3xl font-bold mb-6 text-center">P2P TODO List</h1>

  <!-- Peer OrbitDB Selection Dropdown -->
  <div class="mb-6 flex items-center gap-4">
    <label for="peer-db-select" class="font-medium">View TODOs from:</label>
    <select
      id="peer-db-select"
      bind:value={selectedPeerId}
      on:change={handlePeerDbSwitch}
      class="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    >
      <option value="">My DB (default)</option>
      {#each peers as { peerId }}
        <!-- Debug logging in template -->
        {console.log('📝 [DROPDOWN DEBUG] Checking peer:', peerId, 'Has OrbitDB address:', !!peerOrbitDbAddresses.get(peerId), 'Address:', peerOrbitDbAddresses.get(peerId))}
        {#if peerOrbitDbAddresses.get(peerId)}
          <option value={peerId}>
            {formatPeerId(peerId)}... (…{peerOrbitDbAddresses.get(peerId).slice(-5)})
          </option>
        {:else}
          <!-- Show debug option for peers without OrbitDB address -->
          <!-- <option value={peerId} disabled>{formatPeerId(peerId)}... (no OrbitDB address)</option> -->
        {/if}
      {/each}
    </select>
    {#if selectedPeerId && peerOrbitDbAddresses.get(selectedPeerId)}
      <span class="text-xs text-gray-500">OrbitDB: <code class="bg-gray-100 px-1 rounded">…{peerOrbitDbAddresses.get(selectedPeerId).slice(-5)}</code></span>
    {/if}
  </div>

  {#if loading}
    <div class="text-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
      <p class="mt-4 text-gray-600">Initializing P2P connection...</p>
      <p class="mt-2 text-xs text-gray-400">v{__APP_VERSION__}</p>
    </div>
  {:else if error}
    <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
      Error: {error}
    </div>
  {:else}
    <!-- Add TODO Form -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">Add New TODO</h2>
      <div class="space-y-4">
        <input
          type="text"
          bind:value={inputText}
          placeholder="What needs to be done?"
          class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          on:keydown={(e) => e.key === 'Enter' && handleAddTodo()}
        />
        <div class="flex gap-2">
          <select
            bind:value={assigneeText}
            class="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Assign to...</option>
            {#each peers as { peerId }}
              <option value={peerId}>{formatPeerId(peerId)}...</option>
            {/each}
          </select>
          <button 
            on:click={handleAddTodo} 
            class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-md font-medium transition-colors"
          >
            Add TODO
          </button>
        </div>
      </div>
    </div>

    <!-- TODO List -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">TODO Items ({todos.length})</h2>
      {#if todos.length > 0}
        <div class="space-y-3">
          {#each todos as { id, text, completed, assignee, createdBy }}
            <div class="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50">
              <div class="flex items-center space-x-3 flex-1">
                <input 
                  type="checkbox" 
                  checked={completed} 
                  on:change={() => handleToggleComplete(id)} 
                  class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <div class="flex-1">
                  <span class={completed ? 'line-through text-gray-500' : 'text-gray-800'}>
                    {text}
                  </span>
                  <div class="text-sm text-gray-500 mt-1">
                    {#if assignee}
                      Assigned to: <code class="bg-gray-100 px-1 rounded">{formatPeerId(assignee)}</code>
                    {:else}
                      <span class="text-orange-600">Unassigned</span>
                    {/if}
                    • Created by: <code class="bg-gray-100 px-1 rounded">{formatPeerId(createdBy)}</code>
                  </div>
                </div>
              </div>
              <div class="flex space-x-2">
                <!-- Assign to connected peers -->
                {#if peers.length > 0}
                  <select 
                    on:change={(e) => handleAssign(id, e.target.value)}
                    class="text-sm border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="">Assign to...</option>
                    {#each peers as { peerId }}
                      <option value={peerId}>{formatPeerId(peerId)}...</option>
                    {/each}
                  </select>
                {/if}
                <button 
                  on:click={() => handleDelete(id)} 
                  class="text-red-500 hover:text-red-700 px-3 py-1 rounded-md transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-gray-500 text-center py-8">No TODOs yet. Add one above!</p>
      {/if}
    </div>

    <!-- P2P Status -->
    <div class="grid md:grid-cols-2 gap-6">
      <!-- Connected Peers -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">Connected Peers ({peers.length})</h2>
        {#if peers.length > 0}
          <div class="space-y-2">
            {#each peers as { peerId, transports }}
              <div class="flex items-center space-x-2">
                <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                <code class="text-sm bg-gray-100 px-2 py-1 rounded">{formatPeerId(peerId)}</code>
                {#each transports as type}
                  {#if type === 'webrtc'}
                    <span class="badge bg-green-200 text-green-800">WebRTC</span>
                  {:else if type === 'circuit-relay'}
                    <span class="badge bg-blue-200 text-blue-800">Relay</span>
                  {:else if type === 'websocket'}
                    <span class="badge bg-purple-200 text-purple-800">WS</span>
                  {:else}
                    <span class="badge bg-gray-200 text-gray-800">{type}</span>
                  {/if}
                {/each}
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-gray-500">No peers connected yet.</p>
        {/if}
      </div>

      <!-- My Identity -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">My Peer ID</h2>
        {#if myPeerId}
          <div class="bg-blue-50 p-3 rounded-md">
            <code class="text-sm font-mono break-all">{formatPeerId(myPeerId)}</code>
          </div>
          <p class="text-sm text-gray-600 mt-2">Share this ID with others to assign TODOs to you.</p>
        {:else}
          <p class="text-gray-500">Loading...</p>
        {/if}
      </div>
    </div>

    <!-- Write Permissions Management -->
    <div class="bg-white rounded-lg shadow-md p-6 mt-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Write Permissions</h2>
        <button 
          on:click={() => { showWritePermissions = !showWritePermissions; updateWritePermissionRequests(); }}
          class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md transition-colors"
        >
          {showWritePermissions ? 'Hide Permissions' : 'Show Permissions'}
        </button>
      </div>
      
      {#if showWritePermissions}
        <div class="space-y-6">
          <!-- Write Permission Status -->
          <div class="bg-gray-50 p-4 rounded-md">
            <div class="flex items-center space-x-2 mb-2">
              <div class="w-3 h-3 rounded-full {canWriteToCurrentDB ? 'bg-green-500' : 'bg-red-500'}"></div>
              <span class="font-medium">
                {canWriteToCurrentDB ? 'You can write to this database' : 'You cannot write to this database'}
              </span>
            </div>
            <p class="text-sm text-gray-600">
              Current database: <code class="bg-white px-1 rounded">{dbAddress || 'Loading...'}</code>
            </p>
            {#if selectedPeerId && !canWriteToCurrentDB}
              <button 
                on:click={() => handleRequestWritePermission(selectedPeerId)}
                class="mt-2 text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md transition-colors"
              >
                Request Write Permission from {formatPeerId(selectedPeerId)}
              </button>
            {/if}
          </div>

          <!-- Incoming Permission Requests -->
          <div>
            <h3 class="text-lg font-medium mb-3">Incoming Requests ({writePermissionRequests.length})</h3>
            {#if writePermissionRequests.length > 0}
              <div class="space-y-3">
                {#each writePermissionRequests as request}
                  <div class="border border-gray-200 p-3 rounded-md">
                    <div class="flex items-center justify-between">
                      <div class="flex-1">
                        <div class="flex items-center space-x-2 mb-1">
                          <span class="font-medium text-sm">From: {formatPeerId(request.requesterPeerId)}</span>
                          <span class="text-xs px-2 py-1 rounded-full {request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : request.status === 'granted' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            {request.status}
                          </span>
                        </div>
                        <p class="text-sm text-gray-600 mb-1">{request.reason}</p>
                        <p class="text-xs text-gray-500">
                          Requested: {new Date(request.requestedAt).toLocaleString()}
                        </p>
                      </div>
                      {#if request.status === 'pending'}
                        <div class="flex space-x-2">
                          <button 
                            on:click={() => handleGrantWritePermission(request.id)}
                            class="text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-md transition-colors"
                          >
                            Grant
                          </button>
                          <button 
                            on:click={() => handleDenyWritePermission(request.id, 'Declined by user')}
                            class="text-sm bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md transition-colors"
                          >
                            Deny
                          </button>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-gray-500 text-sm">No incoming permission requests</p>
            {/if}
          </div>

          <!-- Outgoing Permission Requests -->
          <div>
            <h3 class="text-lg font-medium mb-3">My Requests ({outgoingWritePermissionRequests.length})</h3>
            {#if outgoingWritePermissionRequests.length > 0}
              <div class="space-y-3">
                {#each outgoingWritePermissionRequests as request}
                  <div class="border border-gray-200 p-3 rounded-md">
                    <div class="flex items-center justify-between">
                      <div class="flex-1">
                        <div class="flex items-center space-x-2 mb-1">
                          <span class="font-medium text-sm">To: {formatPeerId(request.targetPeerID)}</span>
                          <span class="text-xs px-2 py-1 rounded-full {request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : request.status === 'granted' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            {request.status}
                          </span>
                        </div>
                        <p class="text-sm text-gray-600 mb-1">{request.reason}</p>
                        <p class="text-xs text-gray-500">
                          Requested: {new Date(request.requestedAt).toLocaleString()}
                          {#if request.status === 'granted' && request.grantedAt}
                            | Granted: {new Date(request.grantedAt).toLocaleString()}
                          {:else if request.status === 'denied' && request.deniedAt}
                            | Denied: {new Date(request.deniedAt).toLocaleString()}
                          {/if}
                        </p>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-gray-500 text-sm">No outgoing permission requests</p>
            {/if}
          </div>
        </div>
      {:else}
        <p class="text-sm text-gray-500">Manage write permissions for peer databases. Click "Show Permissions" to view requests.</p>
      {/if}
    </div>

    <!-- Database Manager -->
    <div class="bg-white rounded-lg shadow-md p-6 mt-6">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center space-x-2">
          <h2 class="text-xl font-semibold">Database Manager</h2>
          {#if browserDatabases.length > 0}
            <span class="bg-blue-100 text-blue-800 text-sm px-2 py-1 rounded-full">
              {browserDatabases.length} database{browserDatabases.length !== 1 ? 's' : ''}
            </span>
          {/if}
        </div>
        <div class="flex space-x-2">
          <button 
            on:click={refreshDatabases}
            class="text-sm bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1 rounded-md transition-colors"
          >
            Refresh
          </button>
          <button 
            on:click={() => { showDatabaseDetails = !showDatabaseDetails; if (showDatabaseDetails) refreshDatabases(); }}
            class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md transition-colors"
          >
            {showDatabaseDetails ? 'Hide Databases' : 'Show Databases'}
          </button>
        </div>
      </div>
      
      {#if showDatabaseDetails}
        {#if browserDatabases.length > 0}
          <div class="space-y-4">
            <!-- Database List -->
            <div class="space-y-3">
              {#each browserDatabases as db}
                <div class="border rounded-lg p-4 {db.isActive ? 
                  (db.activeType === 'orbitdb' ? 'border-green-300 bg-green-50' : 
                   db.activeType === 'helia' ? 'border-blue-300 bg-blue-50' : 
                   'border-purple-300 bg-purple-50') : 'border-gray-200'}">
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center space-x-3">
                      <div class="w-3 h-3 rounded-full {db.isActive ? 
                        (db.activeType === 'orbitdb' ? 'bg-green-500' : 
                         db.activeType === 'helia' ? 'bg-blue-500' : 
                         'bg-purple-500') : 'bg-gray-400'}"></div>
                      <div>
                        <div class="flex items-center space-x-2">
                          <h3 class="font-medium text-lg">{db.name}</h3>
                          {#if db.isActive}
                            <span class="text-xs px-2 py-1 rounded-full font-medium {db.activeType === 'orbitdb' ? 'bg-green-200 text-green-800' : 
                              db.activeType === 'helia' ? 'bg-blue-200 text-blue-800' : 
                              'bg-purple-200 text-purple-800'}">
                              ✨ ACTIVE {db.activeType.toUpperCase()}
                            </span>
                          {/if}
                        </div>
                        <div class="text-sm text-gray-500 space-y-1">
                          <div class="flex items-center space-x-4">
                            <span>Version: {db.version}</span>
                            {#if db.totalRecords !== undefined}
                              <span>Records: {db.totalRecords.toLocaleString()}</span>
                            {/if}
                            {#if db.storeNames && db.storeNames.length > 0}
                              <span>Stores: {db.storeNames.length}</span>
                            {/if}
                            {#if db.isKeystore}
                              <span class="text-yellow-600 font-medium">🔑 KEYSTORE</span>
                            {/if}
                          </div>
                          {#if db.lastAccessed}
                            <div class="text-xs text-gray-400">
                              Last accessed: {new Date(db.lastAccessed).toLocaleString()}
                            </div>
                          {:else}
                            <div class="text-xs text-gray-400">
                              Last accessed: Unknown
                            </div>
                          {/if}
                          
                          {#if db.isKeystore && db.keystoreKeys && db.keystoreKeys.length > 0}
                            <div class="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                              <div class="font-medium text-yellow-800 mb-1">Keystore Contents:</div>
                              {#each db.keystoreKeys as keystore}
                                <div class="mb-2">
                                  <div class="font-medium text-yellow-700">Store: {keystore.storeName}</div>
                                  <div class="text-yellow-600">Keys: {keystore.keyCount}</div>
                                  
                                  {#if keystore.keys && keystore.keys.length > 0}
                                    <div class="mt-1">
                                      <div class="text-yellow-700 font-medium">Key IDs:</div>
                                      <div class="text-yellow-600 break-all">
                                        {keystore.keys.slice(0, 3).join(', ')}
                                        {#if keystore.keys.length > 3}
                                          ... and {keystore.keys.length - 3} more
                                        {/if}
                                      </div>
                                    </div>
                                  {/if}
                                  
                                  {#if keystore.sampleRecords && keystore.sampleRecords.length > 0}
                                    <div class="mt-1">
                                      <div class="text-yellow-700 font-medium">Sample Records:</div>
                                      {#each keystore.sampleRecords.slice(0, 2) as record}
                                        <div class="text-yellow-600 text-xs bg-yellow-100 p-1 rounded mt-1">
                                          {#if record.id}
                                            <strong>ID:</strong> {record.id}<br>
                                          {/if}
                                          {#if record.name}
                                            <strong>Name:</strong> {record.name}<br>
                                          {/if}
                                          {#if record.keyType}
                                            <strong>Type:</strong> {record.keyType}<br>
                                          {/if}
                                          {#if record.algorithm}
                                            <strong>Algorithm:</strong> {record.algorithm}<br>
                                          {/if}
                                          {#if record.hasPublicKey}
                                            <strong>Has Public Key:</strong> Yes<br>
                                          {/if}
                                          {#if record.hasPrivateKey}
                                            <strong>Has Private Key:</strong> Yes<br>
                                          {/if}
                                          {#if record.usages}
                                            <strong>Usages:</strong> {JSON.stringify(record.usages)}<br>
                                          {/if}
                                          {#if record.dataLength}
                                            <strong>Data Length:</strong> {record.dataLength} bytes<br>
                                          {/if}
                                          {#if record.value}
                                            <strong>Value:</strong> {record.value}<br>
                                          {/if}
                                        </div>
                                      {/each}
                                      {#if keystore.sampleRecords.length > 2}
                                        <div class="text-yellow-600 text-xs mt-1">
                                          ... and {keystore.sampleRecords.length - 2} more records
                                        </div>
                                      {/if}
                                    </div>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {:else if db.isKeystore}
                            <div class="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-600">
                              🔑 This is a keystore database, but no key data could be extracted.
                            </div>
                          {/if}
                        </div>
                      </div>
                    </div>
                    <div class="flex space-x-2">
                      <button 
                        on:click={() => viewDatabaseContents(db.name)}
                        class="text-sm bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1 rounded-md transition-colors"
                      >
                        View Contents
                      </button>
                      <button 
                        on:click={() => deleteSingleDatabase(db.name)}
                        class="text-sm bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded-md transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  
                  <!-- Database Contents (if viewing) -->
                  {#if viewingDatabase === db.name && databaseContents[db.name]}
                    <div class="mt-3 p-3 bg-gray-50 rounded-md">
                      <h4 class="font-medium text-sm mb-2">Object Stores:</h4>
                      {#each databaseContents[db.name] as store}
                        <div class="mb-3 p-2 bg-white rounded">
                          <div class="flex items-center justify-between mb-1">
                            <span class="font-medium text-sm">{store.name}</span>
                            <span class="text-xs text-gray-500">{store.count} records</span>
                          </div>
                          {#if store.records && store.records.length > 0}
                            <div class="text-xs bg-gray-100 p-2 rounded max-h-32 overflow-y-auto">
                              <pre class="whitespace-pre-wrap">{JSON.stringify(store.records.slice(0, 5), null, 2)}</pre>
                              {#if store.records.length > 5}
                                <p class="text-gray-500 mt-1">... and {store.records.length - 5} more records</p>
                              {/if}
                            </div>
                          {:else}
                            <p class="text-xs text-gray-500">No records found</p>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            
            <!-- Bulk Actions -->
            <div class="border-t pt-4">
              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-600">Found {browserDatabases.length} database(s)</span>
                <button 
                  on:click={deleteAllDatabases}
                  class="text-sm bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md transition-colors"
                >
                  Delete All Databases
                </button>
              </div>
            </div>
          </div>
        {:else}
          <div class="text-center py-8">
            <p class="text-gray-500">No Libp2p/IPFS/OrbitDB databases found</p>
            <p class="text-xs text-gray-400 mt-2">Databases appear here when you use the P2P features</p>
          </div>
        {/if}
      {:else}
        <p class="text-sm text-gray-500">Manage IndexedDB databases created by Libp2p, Helia, and OrbitDB. Click "Show Databases" to view and manage them.</p>
      {/if}
    </div>

    <!-- Relay Discovery Status (Debug Section) -->
    <div class="bg-white rounded-lg shadow-md p-6 mt-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Relay Discovery Status</h2>
        <div class="flex space-x-2">
          <button 
            on:click={async () => {
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
            class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-md transition-colors"
          >
            {showRelayDetails ? 'Hide Details' : 'Show Details'}
          </button>
          
          {#if showRelayDetails}
            <button 
              on:click={async () => {
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
              class="text-sm bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1 rounded-md transition-colors"
            >
              Refresh Cache
            </button>
          {/if}
        </div>
      </div>
      
      {#if showRelayDetails}
        {#if relayStatus}
          <div class="space-y-3">
            <div class="flex items-center space-x-2">
              <div class="w-3 h-3 rounded-full {relayStatus.healthy ? 'bg-green-500' : 'bg-red-500'}"></div>
              <span class="font-medium">Relay Server: {relayStatus.healthy ? 'Healthy' : 'Unhealthy'}</span>
              <span class="text-xs px-2 py-1 rounded-full {relayStatus.bootstrapConfig?.isDevelopment ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}">
                {relayStatus.bootstrapConfig?.isDevelopment ? 'Development (localhost)' : 'Production (public)'}
              </span>
            </div>
            
            <div class="text-sm text-gray-600">
              <p><strong>WebRTC Address Cache:</strong> 
                {#if relayStatus.cacheValid}
                  <span class="text-green-600">Valid (cached {Math.round(relayStatus.cacheAge / 1000)}s ago)</span>
                {:else}
                  <span class="text-orange-600">Expired or missing - will fetch from relay on next connection</span>
                {/if}
              </p>
              <p class="text-xs text-gray-500 mt-1">Caches WebRTC multiaddresses from the relay to avoid repeated HTTP requests</p>
              
              <!-- Bootstrap Configuration -->
              {#if relayStatus.bootstrapConfig}
                <p class="mt-2"><strong>Bootstrap Relay:</strong> <code class="bg-white px-1 rounded text-xs">{relayStatus.bootstrapConfig.currentBootstrapAddr}</code></p>
                <p class="text-xs text-gray-500 mt-1">This is the LibP2P relay server used for peer discovery and circuit relay</p>
              {/if}
              
              <!-- Relay Server Information -->
              <p class="mt-2"><strong>Relay HTTP Server:</strong> <code class="bg-white px-1 rounded text-xs">{relayStatus.relayHttpUrl || 'Unknown'}</code></p>
              <p class="text-xs text-gray-500 mt-1">This is the HTTP server for health checks and multiaddr discovery (different from the LibP2P relay above)</p>
              
              {#if relayStatus.discoveryResult}
                <p class="mt-2"><strong>Relay Peer ID:</strong> <code class="bg-white px-1 rounded text-xs">{formatPeerId(relayStatus.discoveryResult.peerId)}</code></p>
              {/if}
              
              {#if relayStatus.addresses || relayStatus.discoveryResult}
                <p class="mt-2"><strong>Available Multiaddresses:</strong></p>
                <div class="mt-1 space-y-1">
                  {#if relayStatus.addresses?.direct || relayStatus.discoveryResult?.direct}
                    <div class="bg-green-50 p-2 rounded border-l-4 border-green-400">
                      <code class="text-xs">{relayStatus.addresses?.direct || relayStatus.discoveryResult?.direct}</code>
                      <span class="text-green-600 text-xs ml-2">(Direct WebRTC)</span>
                    </div>
                  {/if}
                  {#if relayStatus.addresses?.circuitRelay || relayStatus.discoveryResult?.circuitRelay}
                    <div class="bg-blue-50 p-2 rounded border-l-4 border-blue-400">
                      <code class="text-xs">{relayStatus.addresses?.circuitRelay || relayStatus.discoveryResult?.circuitRelay}</code>
                      <span class="text-blue-600 text-xs ml-2">(Circuit Relay)</span>
                    </div>
                  {/if}
                  {#if relayStatus.addresses?.websocket || relayStatus.discoveryResult?.websocket}
                    <div class="bg-purple-50 p-2 rounded border-l-4 border-purple-400">
                      <code class="text-xs">{relayStatus.addresses?.websocket || relayStatus.discoveryResult?.websocket}</code>
                      <span class="text-purple-600 text-xs ml-2">(WebSocket)</span>
                    </div>
                  {/if}
                  
                  <!-- Show all WebRTC addresses if available -->
                  {#if relayStatus.discoveryResult?.webrtc && relayStatus.discoveryResult.webrtc.length > 0}
                    <div class="mt-2">
                      <p class="text-sm font-medium text-gray-700">All WebRTC Addresses:</p>
                      {#each relayStatus.discoveryResult.webrtc as addr}
                        <div class="bg-gray-50 p-1 rounded mt-1">
                          <code class="text-xs">{addr}</code>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else}
                <p class="text-red-600">No multiaddresses available</p>
              {/if}
              
              {#if relayStatus.error}
                <p class="text-red-600 mt-2"><strong>Error:</strong> {relayStatus.error}</p>
              {/if}
            </div>
          </div>
        {:else}
          <p class="text-gray-500">Click "Show Details" to check relay discovery status</p>
        {/if}
      {:else}
        <p class="text-sm text-gray-500">Relay discovery provides WebRTC addresses with smart caching to avoid unnecessary requests on page reload.</p>
      {/if}
    </div>
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
