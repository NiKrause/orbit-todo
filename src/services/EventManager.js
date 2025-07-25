/**
 * EventManager - Manages P2P and database event listeners
 * Centralizes all event handling logic for peer connections, database updates, and write permissions
 */
export class EventManager {
  constructor(toastService, formatPeerId) {
    this.toastService = toastService;
    this.formatPeerId = formatPeerId;
    this.listeners = new Map();
    this.peerUpdateInterval = null;
  }

  /**
   * Setup all P2P event listeners
   * @param {Function} updatePeers - Function to update peer list
   * @param {Function} updatePeerTransports - Function to update peer transports
   * @param {Function} updatePeerOrbitDbAddresses - Function to update peer OrbitDB addresses
   * @param {string} myPeerId - Current peer ID
   * @param {Function} updateWritePermissionRequests - Function to refresh write permission requests
   */
  setupP2PEventListeners(updatePeers, updatePeerTransports, updatePeerOrbitDbAddresses, myPeerId, updateWritePermissionRequests) {
    // Peer connection events
    const handlePeerConnected = (e) => {
      const peerId = e.detail?.peerId || 'unknown';
      const newTransport = e.detail?.transport || '';
      updatePeerTransports(peerId, newTransport);
      updatePeers();
      console.log("handlePeerConnected", e.detail);
      this.toastService.show(`Peer connected: ${this.formatPeerId(peerId)}`);
    };

    const handlePeerDisconnected = (e) => {
      updatePeers();
      const peerId = e.detail?.peerId || 'unknown';
      this.toastService.show(`Peer disconnected: ${this.formatPeerId(peerId)}`);
    };

    // OrbitDB address discovery events
    const handleOrbitDbAddressUpdate = (e) => {
      console.log('📝 [UI DEBUG] OrbitDB address update event:', e.detail);
      updatePeerOrbitDbAddresses();
      const { peerId, topic: dbAddress } = e.detail || {};
      // Only show toast if it's not our own peerId
      if (peerId && peerId !== myPeerId) {
        this.toastService.show(`Received OrbitDB address from peer: ${this.formatPeerId(peerId)}`);
      }
    };

    // Write permission events
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

    // Register event listeners
    this.addListener('p2p-peer-connected', handlePeerConnected);
    this.addListener('p2p-peer-disconnected', handlePeerDisconnected);
    this.addListener('orbitdb-database-discovered', handleOrbitDbAddressUpdate);
    this.addListener('write-permission-request-sent', handleWritePermissionRequestSent);
    this.addListener('write-permission-granted', handleWritePermissionGranted);
    this.addListener('write-permission-request-received', handleWritePermissionRequestReceived);
  }

  /**
   * Setup database update listener
   * @param {Function} onDatabaseUpdate - Database update callback from p2p library
   * @param {Function} refreshTodos - Function to refresh todos
   * @param {Function} refreshPeers - Function to refresh peers
   * @param {Function} refreshDbInfo - Function to refresh database info
   */
  setupDatabaseListener(onDatabaseUpdate, refreshTodos, refreshPeers, refreshDbInfo) {
    const databaseUpdateHandler = async (eventType, eventData) => {
      console.log("eventType", eventType);
      console.log("eventData", eventData);
      
      // Only refresh for certain event types
      if (eventType === 'update' || !eventType) {
        await refreshTodos();
        refreshPeers();
        refreshDbInfo();
        
        if (eventType === 'update') {
          if (eventData?.type === 'PUT') {
            this.toastService.show('Todo added or updated!');
          } else if (eventData?.type === 'DEL') {
            this.toastService.show('Todo deleted!');
          } else {
            this.toastService.show('Todo updated!');
          }
        }
      }
    };

    // Setup the database listener and store cleanup function
    const cleanup = onDatabaseUpdate(databaseUpdateHandler);
    this.listeners.set('database-update', cleanup);
    
    return cleanup;
  }

  /**
   * Start peer transport monitoring
   * @param {Function} getConnectedPeers - Function to get current connected peers
   * @param {Function} updatePeerList - Function to update the peer list state
   */
  startPeerTransportMonitoring(getConnectedPeers, updatePeerList) {
    this.peerUpdateInterval = setInterval(async () => {
      const updatedPeers = getConnectedPeers();
      let hasChanges = false;
      
      // This logic would need access to current peers state
      // We'll handle the comparison in the calling code for now
      updatePeerList(updatedPeers);
    }, 2000); // Check every 2 seconds for transport upgrades

    console.log('🔄 Started peer transport monitoring');
  }

  /**
   * Add an event listener and store its cleanup
   * @param {string} eventName - Name of the event
   * @param {Function} handler - Event handler function
   */
  addListener(eventName, handler) {
    window.addEventListener(eventName, handler);
    this.listeners.set(eventName, () => {
      window.removeEventListener(eventName, handler);
    });
  }

  /**
   * Update peer transports helper
   * @param {Array} peers - Current peers array
   * @param {string} peerId - Peer ID to update
   * @param {string} newTransport - New transport type
   * @returns {Array} Updated peers array
   */
  updatePeerTransports(peers, peerId, newTransport) {
    const updatedPeers = [...peers];
    const peer = updatedPeers.find(p => p.peerId === peerId);
    
    if (peer) {
      // If the transport does not exist, add it
      if (!peer.transports.includes(newTransport)) {
        peer.transports.push(newTransport);
      }
      // Remove 'circuit-relay' if we have 'webrtc'
      if (newTransport === 'webrtc') {
        peer.transports = peer.transports.filter(type => type !== 'circuit-relay');
      }
    }
    
    return updatedPeers;
  }

  /**
   * Check if peer transports have changed
   * @param {Array} currentPeers - Current peer list
   * @param {Array} updatedPeers - Updated peer list
   * @returns {boolean} True if changes detected
   */
  hasPeerTransportChanges(currentPeers, updatedPeers) {
    if (currentPeers.length !== updatedPeers.length) {
      return true;
    }

    for (const updatedPeer of updatedPeers) {
      const existingPeer = currentPeers.find(p => p.peerId === updatedPeer.peerId);
      if (existingPeer) {
        // Compare transport arrays
        const existingTransports = existingPeer.transports.sort().join(',');
        const newTransports = updatedPeer.transports.sort().join(',');
        
        if (existingTransports !== newTransports) {
          console.log(`🔄 Transport change detected for ${this.formatPeerId(updatedPeer.peerId)}:`, {
            before: existingPeer.transports,
            after: updatedPeer.transports
          });
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Stop peer transport monitoring
   */
  stopPeerTransportMonitoring() {
    if (this.peerUpdateInterval) {
      clearInterval(this.peerUpdateInterval);
      this.peerUpdateInterval = null;
      console.log('🧹 Cleared peer transport monitoring interval');
    }
  }

  /**
   * Clean up all event listeners and intervals
   */
  cleanup() {
    // Remove all event listeners
    this.listeners.forEach((cleanup, eventName) => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    });
    this.listeners.clear();

    // Stop peer monitoring
    this.stopPeerTransportMonitoring();

    console.log('🧹 EventManager cleanup completed');
  }
}
