/**
 * WritePermissionManager - Manages write permission requests and granting
 * Handles creating write permission requests, processing incoming requests, and managing permissions
 */
export class WritePermissionManager {
  constructor(toastService) {
    this.toastService = toastService;
    this.processingRequests = new Set(); // Track requests being processed to prevent duplicates
  }

  /**
   * Create and send a write permission request to a peer
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getMyWritePermissionDatabase - Get own write permission database
   * @param {Function} dependencies.getMyPeerId - Get current peer ID
   * @param {Function} dependencies.getTodoDbAddress - Get current todo database address
   * @param {Function} dependencies.getTodoDbName - Get current todo database name
   * @param {string} targetPeerId - Peer ID to request permission from
   * @returns {Promise<boolean>} Success status
   */
  async createWritePermissionRequest(dependencies, targetPeerId) {
    const {
      getMyWritePermissionDatabase,
      getMyPeerId,
      getTodoDbAddress,
      getTodoDbName
    } = dependencies;

    try {
      console.log('📝 Creating write permission request for peer:', targetPeerId);
      this.toastService.show(`Requesting write permission from ${this.formatPeerId(targetPeerId)}...`);

      const myWritePermissionDb = getMyWritePermissionDatabase();
      if (!myWritePermissionDb) {
        throw new Error('Write permission database not available');
      }

      const myPeerId = getMyPeerId();
      const todoDbAddress = getTodoDbAddress();
      const todoDbName = getTodoDbName();

      // Create the write permission request
      const request = {
        requesterPeerId: myPeerId,
        targetPeerId: targetPeerId,
        todoDbAddress: todoDbAddress,
        todoDbName: todoDbName,
        requestedAt: new Date().toISOString(),
        status: 'pending'
      };

      console.log('📝 Writing permission request:', request);

      // Add the request to our write permission database
      await myWritePermissionDb.add(request);

      console.log('✅ Write permission request created successfully');
      this.toastService.show(`Write permission request sent to ${this.formatPeerId(targetPeerId)}`);

      return true;

    } catch (error) {
      console.error('❌ Error creating write permission request:', error);
      this.toastService.show(`Failed to request write permission: ${error.message}`);
      return false;
    }
  }

  /**
   * Process incoming write permission requests
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getMyPeerId - Get current peer ID
   * @param {Function} dependencies.getTodoDatabase - Get current todo database
   * @param {Function} dependencies.getMyWritePermissionDatabase - Get own write permission database
   * @param {Array} writePermissionRequests - Current write permission requests
   * @param {Function} updateWritePermissionRequests - Function to update requests in UI
   * @returns {Promise<void>}
   */
  async processIncomingRequests(dependencies, writePermissionRequests, updateWritePermissionRequests) {
    const {
      getMyPeerId,
      getTodoDatabase,
      getMyWritePermissionDatabase
    } = dependencies;

    try {
      const myPeerId = getMyPeerId();
      const todoDb = getTodoDatabase();
      const myWritePermissionDb = getMyWritePermissionDatabase();

      if (!todoDb || !myWritePermissionDb) {
        return;
      }

      // Find pending requests for this peer
      const incomingRequests = writePermissionRequests.filter(req => 
        req.targetPeerId === myPeerId && 
        req.status === 'pending' &&
        !this.processingRequests.has(req.hash)
      );

      if (incomingRequests.length === 0) {
        return;
      }

      console.log(`📨 Processing ${incomingRequests.length} incoming write permission requests`);

      for (const request of incomingRequests) {
        await this.processIncomingRequest(request, todoDb, myWritePermissionDb, updateWritePermissionRequests);
      }

    } catch (error) {
      console.error('❌ Error processing incoming write permission requests:', error);
    }
  }

  /**
   * Process a single incoming write permission request
   * @param {Object} request - The permission request
   * @param {Object} todoDb - Todo database instance
   * @param {Object} myWritePermissionDb - Write permission database instance
   * @param {Function} updateWritePermissionRequests - Function to update requests in UI
   * @returns {Promise<void>}
   */
  async processIncomingRequest(request, todoDb, myWritePermissionDb, updateWritePermissionRequests) {
    if (this.processingRequests.has(request.hash)) {
      console.log('⚠️ Request already being processed:', request.hash);
      return;
    }

    this.processingRequests.add(request.hash);

    try {
      console.log('📨 Processing incoming write permission request:', {
        from: this.formatPeerId(request.requesterPeerId),
        hash: request.hash
      });

      // Auto-grant the permission
      console.log('✅ Auto-granting write permission to:', this.formatPeerId(request.requesterPeerId));
      
      // Add the requester as a writer to the todo database
      await todoDb.access.grant('write', request.requesterPeerId);
      
      console.log('✅ Write permission granted to:', this.formatPeerId(request.requesterPeerId));

      // Update the request status to approved
      const updatedRequest = {
        ...request,
        status: 'approved',
        approvedAt: new Date().toISOString()
      };

      // Update the request in the write permission database
      await myWritePermissionDb.put(request.hash, updatedRequest);

      console.log('✅ Write permission request approved and updated');
      this.toastService.show(`Granted write permission to ${this.formatPeerId(request.requesterPeerId)}`);

      // Update UI
      updateWritePermissionRequests();

    } catch (error) {
      console.error('❌ Error processing write permission request:', error);
      
      try {
        // Update the request status to failed
        const failedRequest = {
          ...request,
          status: 'failed',
          failedAt: new Date().toISOString(),
          error: error.message
        };

        await myWritePermissionDb.put(request.hash, failedRequest);
        updateWritePermissionRequests();
      } catch (updateError) {
        console.error('❌ Error updating failed request status:', updateError);
      }

      this.toastService.show(`Failed to grant write permission: ${error.message}`);
    } finally {
      this.processingRequests.delete(request.hash);
    }
  }

  /**
   * Manually approve a write permission request
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getTodoDatabase - Get current todo database
   * @param {Function} dependencies.getMyWritePermissionDatabase - Get own write permission database
   * @param {Object} request - The permission request to approve
   * @param {Function} updateWritePermissionRequests - Function to update requests in UI
   * @returns {Promise<boolean>} Success status
   */
  async approveWritePermissionRequest(dependencies, request, updateWritePermissionRequests) {
    const {
      getTodoDatabase,
      getMyWritePermissionDatabase
    } = dependencies;

    try {
      console.log('✅ Manually approving write permission request:', {
        from: this.formatPeerId(request.requesterPeerId),
        hash: request.hash
      });

      const todoDb = getTodoDatabase();
      const myWritePermissionDb = getMyWritePermissionDatabase();

      if (!todoDb || !myWritePermissionDb) {
        throw new Error('Required databases not available');
      }

      // Add the requester as a writer to the todo database
      await todoDb.access.grant('write', request.requesterPeerId);
      
      console.log('✅ Write permission granted to:', this.formatPeerId(request.requesterPeerId));

      // Update the request status to approved
      const updatedRequest = {
        ...request,
        status: 'approved',
        approvedAt: new Date().toISOString()
      };

      // Update the request in the write permission database
      await myWritePermissionDb.put(request.hash, updatedRequest);

      console.log('✅ Write permission request approved and updated');
      this.toastService.show(`Granted write permission to ${this.formatPeerId(request.requesterPeerId)}`);

      // Update UI
      updateWritePermissionRequests();

      return true;

    } catch (error) {
      console.error('❌ Error approving write permission request:', error);
      this.toastService.show(`Failed to approve write permission: ${error.message}`);
      return false;
    }
  }

  /**
   * Deny a write permission request
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getMyWritePermissionDatabase - Get own write permission database
   * @param {Object} request - The permission request to deny
   * @param {Function} updateWritePermissionRequests - Function to update requests in UI
   * @returns {Promise<boolean>} Success status
   */
  async denyWritePermissionRequest(dependencies, request, updateWritePermissionRequests) {
    const { getMyWritePermissionDatabase } = dependencies;

    try {
      console.log('❌ Denying write permission request:', {
        from: this.formatPeerId(request.requesterPeerId),
        hash: request.hash
      });

      const myWritePermissionDb = getMyWritePermissionDatabase();
      if (!myWritePermissionDb) {
        throw new Error('Write permission database not available');
      }

      // Update the request status to denied
      const updatedRequest = {
        ...request,
        status: 'denied',
        deniedAt: new Date().toISOString()
      };

      // Update the request in the write permission database
      await myWritePermissionDb.put(request.hash, updatedRequest);

      console.log('❌ Write permission request denied and updated');
      this.toastService.show(`Denied write permission to ${this.formatPeerId(request.requesterPeerId)}`);

      // Update UI
      updateWritePermissionRequests();

      return true;

    } catch (error) {
      console.error('❌ Error denying write permission request:', error);
      this.toastService.show(`Failed to deny write permission: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a peer has write permission to the current database
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getTodoDatabase - Get current todo database
   * @param {string} peerId - Peer ID to check
   * @returns {Promise<boolean>} Whether peer has write permission
   */
  async hasWritePermission(dependencies, peerId) {
    const { getTodoDatabase } = dependencies;

    try {
      const todoDb = getTodoDatabase();
      if (!todoDb) {
        return false;
      }

      // Check if the peer has write access
      const hasAccess = await todoDb.access.capability(peerId, 'write');
      return hasAccess;

    } catch (error) {
      console.error('❌ Error checking write permission:', error);
      return false;
    }
  }

  /**
   * Get all write permission requests with enhanced metadata
   * @param {Array} writePermissionRequests - Raw write permission requests
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getMyPeerId - Get current peer ID
   * @returns {Object} Categorized write permission requests
   */
  categorizeWritePermissionRequests(writePermissionRequests, dependencies) {
    const { getMyPeerId } = dependencies;

    try {
      const myPeerId = getMyPeerId();

      const categorized = {
        incoming: [],
        outgoing: [],
        total: writePermissionRequests.length
      };

      for (const request of writePermissionRequests) {
        const enhancedRequest = {
          ...request,
          isIncoming: request.targetPeerId === myPeerId,
          isOutgoing: request.requesterPeerId === myPeerId,
          isPending: request.status === 'pending',
          isApproved: request.status === 'approved',
          isDenied: request.status === 'denied',
          isFailed: request.status === 'failed'
        };

        if (enhancedRequest.isIncoming) {
          categorized.incoming.push(enhancedRequest);
        } else if (enhancedRequest.isOutgoing) {
          categorized.outgoing.push(enhancedRequest);
        }
      }

      return categorized;

    } catch (error) {
      console.error('❌ Error categorizing write permission requests:', error);
      return {
        incoming: [],
        outgoing: [],
        total: 0
      };
    }
  }

  /**
   * Clean up old write permission requests
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getMyWritePermissionDatabase - Get own write permission database
   * @param {Array} writePermissionRequests - Current write permission requests
   * @param {number} maxAge - Maximum age in milliseconds (default: 7 days)
   * @returns {Promise<number>} Number of requests cleaned up
   */
  async cleanupOldRequests(dependencies, writePermissionRequests, maxAge = 7 * 24 * 60 * 60 * 1000) {
    const { getMyWritePermissionDatabase } = dependencies;

    try {
      const myWritePermissionDb = getMyWritePermissionDatabase();
      if (!myWritePermissionDb) {
        return 0;
      }

      const cutoffDate = new Date(Date.now() - maxAge);
      let cleanedCount = 0;

      for (const request of writePermissionRequests) {
        const requestDate = new Date(request.requestedAt);
        
        // Only clean up old, non-pending requests
        if (requestDate < cutoffDate && request.status !== 'pending') {
          try {
            await myWritePermissionDb.del(request.hash);
            cleanedCount++;
            console.log('🧹 Cleaned up old write permission request:', request.hash);
          } catch (deleteError) {
            console.error('❌ Error deleting old request:', deleteError);
          }
        }
      }

      if (cleanedCount > 0) {
        console.log(`🧹 Cleaned up ${cleanedCount} old write permission requests`);
        this.toastService.show(`Cleaned up ${cleanedCount} old permission requests`);
      }

      return cleanedCount;

    } catch (error) {
      console.error('❌ Error cleaning up old write permission requests:', error);
      return 0;
    }
  }

  /**
   * Format peer ID for display
   * @param {string} peerId - Full peer ID
   * @returns {string} Formatted peer ID
   */
  formatPeerId(peerId) {
    if (!peerId || typeof peerId !== 'string') {
      return 'Unknown';
    }
    return peerId.length > 12 ? `${peerId.substring(0, 8)}...${peerId.substring(peerId.length - 4)}` : peerId;
  }

  /**
   * Request write permission from a target peer
   * @param {string} targetPeerId - Target peer ID
   * @param {Map} peerOrbitDbAddresses - Map of peer OrbitDB addresses
   * @param {Function} updateCallback - Callback to update UI state
   * @returns {Promise<void>}
   */
  async requestPermission(targetPeerId, peerOrbitDbAddresses, updateCallback) {
    if (!targetPeerId || !peerOrbitDbAddresses.has(targetPeerId)) {
      this.toastService.show('Cannot request permission: peer database not found');
      return;
    }
    
    try {
      const { requestWritePermission } = await import('../lib/p2p.js');
      const targetDbAddress = peerOrbitDbAddresses.get(targetPeerId);
      const reason = `Requesting write access to collaborate on TODOs`;
      
      await requestWritePermission(targetDbAddress, targetPeerId, reason);
      this.toastService.show(`Write permission request sent to ${this.formatPeerId(targetPeerId)}`);
      
      // Update UI
      await updateCallback();
    } catch (err) {
      console.error('Failed to request write permission:', err);
      this.toastService.show('Failed to send write permission request');
    }
  }

  /**
   * Grant a write permission request
   * @param {string} requestId - Request ID to grant
   * @param {Function} updateCallback - Callback to update UI state
   * @returns {Promise<void>}
   */
  async grantPermission(requestId, updateCallback) {
    try {
      const { grantWritePermission } = await import('../lib/p2p.js');
      await grantWritePermission(requestId);
      this.toastService.show('Write permission granted!');
      await updateCallback();
    } catch (err) {
      console.error('Failed to grant write permission:', err);
      this.toastService.show('Failed to grant write permission');
    }
  }

  /**
   * Deny a write permission request
   * @param {string} requestId - Request ID to deny
   * @param {string} reason - Reason for denial
   * @param {Function} updateCallback - Callback to update UI state
   * @returns {Promise<void>}
   */
  async denyPermission(requestId, reason = '', updateCallback) {
    try {
      const { denyWritePermission } = await import('../lib/p2p.js');
      await denyWritePermission(requestId, reason);
      this.toastService.show('Write permission denied');
      await updateCallback();
    } catch (err) {
      console.error('Failed to deny write permission:', err);
      this.toastService.show('Failed to deny write permission');
    }
  }

  /**
   * Update write permission requests state
   * @param {string} dbAddress - Current database address
   * @param {string} selectedPeerId - Currently selected peer ID
   * @param {Function} stateCallback - Callback to update state
   * @returns {Promise<void>}
   */
  async updateRequests(dbAddress, selectedPeerId, stateCallback) {
    try {
      console.log('🔄 [UI DEBUG] Updating write permission requests...');
      
      const { 
        getMyWritePermissionRequests,
        getMyOutgoingWritePermissionRequests,
        hasWritePermission,
        getMyPeerId
      } = await import('../lib/p2p.js');
      
      const myPeerId = getMyPeerId();
      console.log('🔄 [UI DEBUG] My peer ID from UI context:', myPeerId);
      
      const incomingRequests = await getMyWritePermissionRequests();
      const outgoingRequests = await getMyOutgoingWritePermissionRequests();
      
      console.log('🔄 [UI DEBUG] Got requests:', {
        incoming: incomingRequests.length,
        outgoing: outgoingRequests.length
      });
      
      // Check write permission for current database
      const canWrite = await hasWritePermission(dbAddress, selectedPeerId);
      
      stateCallback(incomingRequests, outgoingRequests, canWrite);
    } catch (err) {
      console.error('Failed to update write permission requests:', err);
    }
  }

  /**
   * Get write permission statistics
   * @param {Array} writePermissionRequests - Write permission requests
   * @param {Object} dependencies - Required functions and data
   * @param {Function} dependencies.getMyPeerId - Get current peer ID
   * @returns {Object} Permission statistics
   */
  getWritePermissionStats(writePermissionRequests, dependencies) {
    const { getMyPeerId } = dependencies;

    try {
      const myPeerId = getMyPeerId();
      
      const stats = {
        total: writePermissionRequests.length,
        incoming: {
          total: 0,
          pending: 0,
          approved: 0,
          denied: 0,
          failed: 0
        },
        outgoing: {
          total: 0,
          pending: 0,
          approved: 0,
          denied: 0,
          failed: 0
        }
      };

      for (const request of writePermissionRequests) {
        if (request.targetPeerId === myPeerId) {
          // Incoming request
          stats.incoming.total++;
          stats.incoming[request.status] = (stats.incoming[request.status] || 0) + 1;
        } else if (request.requesterPeerId === myPeerId) {
          // Outgoing request
          stats.outgoing.total++;
          stats.outgoing[request.status] = (stats.outgoing[request.status] || 0) + 1;
        }
      }

      return stats;

    } catch (error) {
      console.error('❌ Error calculating write permission stats:', error);
      return {
        total: 0,
        incoming: { total: 0, pending: 0, approved: 0, denied: 0, failed: 0 },
        outgoing: { total: 0, pending: 0, approved: 0, denied: 0, failed: 0 }
      };
    }
  }
}
