/**
 * AppStateManager - Main service to orchestrate all other services and manage app state
 */
export class AppStateManager {
  constructor(services) {
    // Core services
    this.toastService = services.toastService;
    this.p2pManager = services.p2pManager;
    this.peerManager = services.peerManager;
    this.databaseSwitcher = services.databaseSwitcher;
    this.writePermissionManager = services.writePermissionManager;
    this.databaseManagerService = services.databaseManagerService;
    this.ipfsAnalyzerService = services.ipfsAnalyzerService;
    this.eventManager = services.eventManager;

    // Application state
    this.state = {
      // Core data
      todos: [],
      peers: [],
      myPeerId: null,
      
      // Database info
      dbAddress: null,
      dbName: null,
      selectedPeerId: '',
      peerOrbitDbAddresses: new Map(),
      
      // UI state
      loading: true,
      error: null,
      inputText: '',
      assigneeText: '',
      
      // Write permissions
      writePermissionRequests: [],
      outgoingWritePermissionRequests: [],
      canWriteToCurrentDB: true,
      showWritePermissions: false,
      
      // Database manager
      showDatabaseDetails: false,
      browserDatabases: [],
      viewingDatabase: null,
      databaseContents: {},
      storageUsage: null,
      
      // IPFS analyzer
      showIPFSDetails: false,
      ipfsAnalysis: null,
      
      // Relay status
      showRelayDetails: false,
      relayStatus: null
    };

    // State change callbacks
    this.stateCallbacks = new Set();
    
    // Event listeners cleanup functions
    this.cleanupFunctions = [];
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      // Initialize P2P system
      const initialState = await this.p2pManager.getInitialState();
      
      // Update state with initial data
      this.updateState({
        todos: initialState.todos,
        peers: initialState.peers,
        myPeerId: initialState.myPeerId,
        dbAddress: initialState.dbAddress,
        dbName: initialState.dbName,
        peerOrbitDbAddresses: initialState.peerOrbitDbAddresses,
        loading: false,
        error: null
      });

      // Set up peer manager
      this.peerManager.setPeers(initialState.peers);
      this.peerManager.onPeersUpdate((peers) => {
        this.updateState({ peers });
      });
      this.peerManager.startPeerTransportMonitoring();

      // Subscribe to P2P updates
      const unsubscribeP2P = this.p2pManager.onUpdate((updateData) => {
        this.updateState({
          todos: updateData.todos,
          peers: updateData.peers,
          dbAddress: updateData.dbAddress,
          dbName: updateData.dbName
        });
      });
      this.cleanupFunctions.push(unsubscribeP2P);

      // Set up event listeners
      this.setupEventListeners();

      // Initialize write permission system
      await this.initializeWritePermissions();

    } catch (error) {
      console.error('Failed to initialize application:', error);
      this.updateState({
        error: error.message,
        loading: false
      });
    }
  }

  /**
   * Set up DOM event listeners
   */
  setupEventListeners() {
    // Peer connection events
    const handlePeerConnected = (e) => this.peerManager.handlePeerConnected(e);
    const handlePeerDisconnected = (e) => this.peerManager.handlePeerDisconnected(e);
    
    window.addEventListener('p2p-peer-connected', handlePeerConnected);
    window.addEventListener('p2p-peer-disconnected', handlePeerDisconnected);
    
    this.cleanupFunctions.push(() => {
      window.removeEventListener('p2p-peer-connected', handlePeerConnected);
      window.removeEventListener('p2p-peer-disconnected', handlePeerDisconnected);
    });

    // OrbitDB events
    const handleOrbitDbAddressUpdate = (e) => {
      console.log('📝 [UI DEBUG] OrbitDB address update event:', e.detail);
      const oldMap = new Map(this.state.peerOrbitDbAddresses);
      const newAddresses = this.p2pManager.getCurrentState().peerOrbitDbAddresses;
      
      this.updateState({ peerOrbitDbAddresses: newAddresses });
      
      console.log('📝 [UI DEBUG] Peer OrbitDB map update:', {
        before: Array.from(oldMap.entries()),
        after: Array.from(newAddresses.entries()),
        size: newAddresses.size
      });
      
      const { peerId, topic: dbAddress } = e.detail || {};
      // Only show toast if it's not our own peerId
      if (peerId && peerId !== this.state.myPeerId) {
        this.toastService.show(`Received OrbitDB address from peer: ${this.formatPeerId(peerId)}`);
      }
    };
    
    window.addEventListener('orbitdb-database-discovered', handleOrbitDbAddressUpdate);
    this.cleanupFunctions.push(() => {
      window.removeEventListener('orbitdb-database-discovered', handleOrbitDbAddressUpdate);
    });

    // Write permission events
    this.setupWritePermissionListeners();
  }

  /**
   * Set up write permission event listeners
   */
  setupWritePermissionListeners() {
    const handleWritePermissionRequestSent = (e) => {
      const { targetPeerId } = e.detail;
      this.toastService.show(`📝 Write permission request sent to ${this.formatPeerId(targetPeerId)}`);
    };
    
    const handleWritePermissionGranted = (e) => {
      const { requesterPeerId } = e.detail;
      this.toastService.show(`✅ Write permission granted to ${this.formatPeerId(requesterPeerId)}`);
    };
    
    const handleWritePermissionRequestReceived = (e) => {
      const { requesterPeerId } = e.detail;
      this.toastService.show(`🔔 New write permission request from ${this.formatPeerId(requesterPeerId)}`);
    };
    
    window.addEventListener('write-permission-request-sent', handleWritePermissionRequestSent);
    window.addEventListener('write-permission-granted', handleWritePermissionGranted);
    window.addEventListener('write-permission-request-received', handleWritePermissionRequestReceived);
    
    this.cleanupFunctions.push(() => {
      window.removeEventListener('write-permission-request-sent', handleWritePermissionRequestSent);
      window.removeEventListener('write-permission-granted', handleWritePermissionGranted);
      window.removeEventListener('write-permission-request-received', handleWritePermissionRequestReceived);
    });
  }

  /**
   * Initialize write permission system
   */
  async initializeWritePermissions() {
    try {
      // Import write permission initialization
      const { initializeWritePermissionSystem, writePermissionRequestsStore } = await import('../lib/write-permissions.js');
      
      console.log('🔍 [UI DEBUG] Manually ensuring write permission system initialization...');
      await initializeWritePermissionSystem();
      console.log('✅ [UI DEBUG] Write permission system initialized successfully');
      
      // Subscribe to write permission requests
      writePermissionRequestsStore.subscribe(requests => {
        this.updateState({ writePermissionRequests: requests });
      });

      // Initial fetch of write permission requests
      await this.updateWritePermissionRequests();
      
    } catch (initError) {
      console.warn('⚠️ [UI DEBUG] Failed to initialize write permission system:', initError);
    }
  }

  /**
   * Update write permission requests
   */
  async updateWritePermissionRequests() {
    return await this.writePermissionManager.updateRequests(
      this.state.dbAddress,
      this.state.selectedPeerId,
      (requests, outgoing, canWrite) => {
        this.updateState({
          writePermissionRequests: requests,
          outgoingWritePermissionRequests: outgoing,
          canWriteToCurrentDB: canWrite
        });
      }
    );
  }

  /**
   * Update application state and notify subscribers
   */
  updateState(updates) {
    this.state = { ...this.state, ...updates };
    this.stateCallbacks.forEach(callback => callback(this.state));
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(callback) {
    this.stateCallbacks.add(callback);
    // Return initial state immediately
    callback(this.state);
    // Return unsubscribe function
    return () => this.stateCallbacks.delete(callback);
  }

  /**
   * Get current state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Todo operations
   */
  async addTodo() {
    if (this.state.inputText.trim() !== '') {
      try {
        await this.p2pManager.addTodo(this.state.inputText, this.state.assigneeText || null);
        this.updateState({
          inputText: '',
          assigneeText: ''
        });
      } catch (err) {
        this.updateState({ error: err.message });
      }
    }
  }

  async toggleTodoComplete(id) {
    const todo = this.state.todos.find(t => t.id === id);
    if (todo) {
      try {
        await this.p2pManager.updateTodo(id, { completed: !todo.completed });
      } catch (err) {
        this.updateState({ error: err.message });
      }
    }
  }

  async deleteTodo(id) {
    try {
      await this.p2pManager.deleteTodo(id);
    } catch (err) {
      this.updateState({ error: err.message });
    }
  }

  async assignTodo(id, peerId) {
    try {
      await this.p2pManager.updateTodo(id, { assignee: peerId });
    } catch (err) {
      this.updateState({ error: err.message });
    }
  }

  /**
   * Database switching
   */
  async switchDatabase() {
    const wasLoading = this.state.loading;
    this.updateState({ loading: true });
    
    try {
      const switchResult = await this.databaseSwitcher.switchToDatabase(this.state.selectedPeerId, {
        getHelia: (await import('../lib/p2p/network.js')).getHelia,
        openTodoDatabaseForPeer: (await import('../lib/p2p.js')).openTodoDatabaseForPeer,
        getTodoDbAddress: (await import('../lib/p2p.js')).getTodoDbAddress,
        getTodoDbName: (await import('../lib/p2p.js')).getTodoDbName,
        getAllTodos: (await import('../lib/p2p.js')).getAllTodos,
        getConnectedPeers: (await import('../lib/p2p.js')).getConnectedPeers,
        getPeerOrbitDbAddresses: (await import('../lib/p2p.js')).getPeerOrbitDbAddresses,
        onDatabaseUpdate: (await import('../lib/p2p.js')).onDatabaseUpdate,
        hasWritePermission: (await import('../lib/p2p.js')).hasWritePermission,
        requestWritePermission: (await import('../lib/p2p.js')).requestWritePermission,
        updateWritePermissionRequests: () => this.updateWritePermissionRequests(),
        peerOrbitDbAddresses: this.state.peerOrbitDbAddresses
      });
      
      if (switchResult.success) {
        // Update component state with results
        this.updateState({
          todos: switchResult.data.todos,
          dbAddress: switchResult.data.dbAddress,
          dbName: switchResult.data.dbName,
          peers: switchResult.data.peers,
          peerOrbitDbAddresses: switchResult.data.peerOrbitDbAddresses
        });
        
        // Update write permission requests if needed
        if (switchResult.data.writePermissionStatus?.requestSent) {
          await this.updateWritePermissionRequests();
        }
      } else {
        // Handle switch failure
        this.updateState({ error: switchResult.error });
      }
      
    } catch (err) {
      console.error('❌ Database switch failed:', err);
      this.updateState({ error: err.message });
    } finally {
      this.updateState({ loading: wasLoading });
    }
  }

  /**
   * Helper to format peer ID (should be injected)
   */
  formatPeerId(peerId) {
    // This should be injected from the main app
    if (this.formatPeerIdFn) {
      return this.formatPeerIdFn(peerId);
    }
    return peerId ? peerId.substring(0, 8) + '...' : 'unknown';
  }

  /**
   * Set format peer ID function
   */
  setFormatPeerIdFunction(fn) {
    this.formatPeerIdFn = fn;
  }

  /**
   * Cleanup all resources
   */
  cleanup() {
    // Call all cleanup functions
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];
    
    // Cleanup services
    this.peerManager.cleanup();
    
    // Clear callbacks
    this.stateCallbacks.clear();
  }
}
