/**
 * DatabaseSwitcher - Manages database switching operations
 * Handles the complex logic of switching between peer databases and managing write permissions
 */
export class DatabaseSwitcher {
  constructor(toastService, formatPeerId) {
    this.toastService = toastService;
    this.formatPeerId = formatPeerId;
    this.cleanupDatabaseListener = null;
  }

  /**
   * Switch to a different database (peer or default)
   * @param {string} selectedPeerId - Peer ID to switch to (empty for default)
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getHelia - Get Helia instance
   * @param {Function} dependencies.openTodoDatabaseForPeer - Open peer database
   * @param {Function} dependencies.getTodoDbAddress - Get current database address
   * @param {Function} dependencies.getTodoDbName - Get current database name
   * @param {Function} dependencies.getAllTodos - Get all todos from current database
   * @param {Function} dependencies.getConnectedPeers - Get connected peers
   * @param {Function} dependencies.getPeerOrbitDbAddresses - Get peer OrbitDB addresses
   * @param {Function} dependencies.onDatabaseUpdate - Setup database listener
   * @param {Function} dependencies.hasWritePermission - Check write permission
   * @param {Function} dependencies.requestWritePermission - Request write permission
   * @param {Function} dependencies.updateWritePermissionRequests - Update permission requests
   * @param {Map} dependencies.peerOrbitDbAddresses - Current peer addresses map
   * @returns {Promise<Object>} Result object with success, data, and error info
   */
  async switchToDatabase(selectedPeerId, dependencies) {
    const {
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
      updateWritePermissionRequests,
      peerOrbitDbAddresses
    } = dependencies;

    try {
      console.log('🔄 Starting database switch to:', selectedPeerId || 'default');

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
      const dbAddress = getTodoDbAddress();
      const dbName = getTodoDbName();
      console.log('📊 Database info updated:', { address: dbAddress, name: dbName });

      // Step 4: Fetch todos from the new database
      console.log('📋 Fetching todos from new database...');
      const newTodos = await getAllTodos();
      console.log('✅ Loaded', newTodos.length, 'todos from new database');

      // Step 5: Update other state
      const peers = getConnectedPeers();
      const updatedPeerOrbitDbAddresses = getPeerOrbitDbAddresses();

      // Step 6: Re-setup database event listeners for reactive updates
      console.log('🔄 Re-setting up database event listeners...');
      if (this.cleanupDatabaseListener) {
        this.cleanupDatabaseListener();
      }
      this.cleanupDatabaseListener = onDatabaseUpdate((eventType, eventData) => {
        console.log('📝 Database update received:', eventType, eventData);
        // Note: The actual todo refresh will be handled by the calling component
        // since it needs to update the component state
      });

      // Step 7: Handle write permissions
      const writePermissionResult = await this.handleWritePermissions(
        selectedPeerId,
        dbAddress,
        peerOrbitDbAddresses,
        hasWritePermission,
        requestWritePermission,
        updateWritePermissionRequests
      );

      // Success - show toast message
      this.toastService.show(selectedPeerId 
        ? `Switched to ${this.formatPeerId(selectedPeerId)}'s DB (${newTodos.length} todos)` 
        : `Switched to default DB (${newTodos.length} todos)`);

      console.log('✅ Database switch completed successfully');

      return {
        success: true,
        data: {
          todos: newTodos,
          dbAddress,
          dbName,
          peers,
          peerOrbitDbAddresses: updatedPeerOrbitDbAddresses,
          writePermissionStatus: writePermissionResult
        },
        error: null
      };

    } catch (err) {
      console.error('❌ Database switch failed:', err);
      return {
        success: false,
        data: null,
        error: err.message
      };
    }
  }

  /**
   * Handle write permission logic for database switching
   * @param {string} selectedPeerId - Peer ID
   * @param {string} dbAddress - Database address
   * @param {Map} peerOrbitDbAddresses - Peer addresses map
   * @param {Function} hasWritePermission - Check permission function
   * @param {Function} requestWritePermission - Request permission function
   * @param {Function} updateWritePermissionRequests - Update requests function
   * @returns {Promise<Object>} Write permission status
   */
  async handleWritePermissions(
    selectedPeerId,
    dbAddress,
    peerOrbitDbAddresses,
    hasWritePermission,
    requestWritePermission,
    updateWritePermissionRequests
  ) {
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
        this.toastService.show(`📝 Write permission requested from ${this.formatPeerId(selectedPeerId)}`);

        // Force update the write permission requests UI immediately
        await updateWritePermissionRequests();

        return {
          hasPermission: false,
          requestSent: true,
          message: 'Write permission requested'
        };
      } catch (err) {
        console.error('❌ Failed to auto-request write permission:', err);
        this.toastService.show('❌ Failed to request write permission');
        
        return {
          hasPermission: false,
          requestSent: false,
          error: err.message
        };
      }
    } else if (selectedPeerId && canWrite) {
      console.log('✅ Already have write permission for this database');
      return {
        hasPermission: true,
        requestSent: false,
        message: 'Write permission already granted'
      };
    } else if (!selectedPeerId) {
      console.log('🏠 Switched to own database - no permission request needed');
      return {
        hasPermission: true,
        requestSent: false,
        message: 'Own database - full permissions'
      };
    }

    return {
      hasPermission: canWrite,
      requestSent: false,
      message: 'Unknown permission state'
    };
  }

  /**
   * Request write permission for a specific peer
   * @param {string} targetPeerId - Target peer ID
   * @param {Map} peerOrbitDbAddresses - Peer addresses map
   * @param {Function} requestWritePermission - Request permission function
   * @param {Function} updateWritePermissionRequests - Update requests function
   * @returns {Promise<Object>} Request result
   */
  async requestWritePermissionForPeer(targetPeerId, peerOrbitDbAddresses, requestWritePermission, updateWritePermissionRequests) {
    if (!targetPeerId || !peerOrbitDbAddresses.has(targetPeerId)) {
      const message = 'Cannot request permission: peer database not found';
      this.toastService.show(message);
      return { success: false, error: message };
    }

    try {
      const targetDbAddress = peerOrbitDbAddresses.get(targetPeerId);
      const reason = 'Requesting write access to collaborate on TODOs';

      await requestWritePermission(targetDbAddress, targetPeerId, reason);
      this.toastService.show(`Write permission request sent to ${this.formatPeerId(targetPeerId)}`);

      // Update UI
      await updateWritePermissionRequests();
      
      return { success: true };
    } catch (err) {
      console.error('Failed to request write permission:', err);
      this.toastService.show('Failed to send write permission request');
      return { success: false, error: err.message };
    }
  }

  /**
   * Get the database listener cleanup function
   * @returns {Function|null} Cleanup function
   */
  getDatabaseListenerCleanup() {
    return this.cleanupDatabaseListener;
  }

  /**
   * Clean up database listener
   */
  cleanup() {
    if (this.cleanupDatabaseListener) {
      this.cleanupDatabaseListener();
      this.cleanupDatabaseListener = null;
      console.log('🧹 DatabaseSwitcher cleanup completed');
    }
  }
}
