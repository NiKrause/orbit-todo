/**
 * PeerManager - Service for managing peer connections and transport monitoring
 */
export class PeerManager {
  constructor(toastService, formatPeerId, getConnectedPeers) {
    this.toastService = toastService;
    this.formatPeerId = formatPeerId;
    this.getConnectedPeers = getConnectedPeers;
    this.peerUpdateInterval = null;
    this.peers = [];
    this.updateCallback = null;
  }

  /**
   * Set callback for peer updates
   */
  onPeersUpdate(callback) {
    this.updateCallback = callback;
  }

  /**
   * Update peer transports when new transport is detected
   */
  updatePeerTransports(peerId, newTransport) {
    const peer = this.peers.find(p => p.peerId === peerId);
    if (peer) {
      // If the transport does not exist, add it
      if (!peer.transports.includes(newTransport)) {
        peer.transports.push(newTransport);
      }
      // Remove 'circuit-relay' if we have 'webrtc'
      if (newTransport === 'webrtc') {
        peer.transports = peer.transports.filter(type => type !== 'circuit-relay');
      }
      this.peers = [...this.peers]; // Trigger reactivity
      this.notifyPeersUpdate();
    }
  }

  /**
   * Start monitoring peer transport changes
   */
  startPeerTransportMonitoring() {
    this.peerUpdateInterval = setInterval(async () => {
      const updatedPeers = this.getConnectedPeers();
      let hasChanges = false;
      
      // Check if any peer's transports have changed
      for (const updatedPeer of updatedPeers) {
        const existingPeer = this.peers.find(p => p.peerId === updatedPeer.peerId);
        if (existingPeer) {
          // Compare transport arrays
          const existingTransports = existingPeer.transports.sort().join(',');
          const newTransports = updatedPeer.transports.sort().join(',');
          
          if (existingTransports !== newTransports) {
            console.log(`🔄 Transport change detected for ${this.formatPeerId(updatedPeer.peerId)}:`, {
              before: existingPeer.transports,
              after: updatedPeer.transports
            });
            hasChanges = true;
          }
        }
      }
      
      if (hasChanges || updatedPeers.length !== this.peers.length) {
        console.log('🔄 Updating peer list due to transport or connection changes');
        this.peers = updatedPeers;
        this.notifyPeersUpdate();
      }
    }, 2000); // Check every 2 seconds for transport upgrades
  }

  /**
   * Handle peer connected event
   */
  handlePeerConnected(event) {
    const peerId = event.detail?.peerId || 'unknown';
    const newTransport = event.detail?.transport || '';
    this.updatePeerTransports(peerId, newTransport);
    this.updatePeers();
    console.log("handlePeerConnected", event.detail);
    this.toastService.show(`Peer connected: ${this.formatPeerId(peerId)}`);
  }

  /**
   * Handle peer disconnected event
   */
  handlePeerDisconnected(event) {
    this.updatePeers();
    const peerId = event.detail?.peerId || 'unknown';
    this.toastService.show(`Peer disconnected: ${this.formatPeerId(peerId)}`);
  }

  /**
   * Update peers list
   */
  updatePeers() {
    this.peers = this.getConnectedPeers();
    this.notifyPeersUpdate();
  }

  /**
   * Get current peers
   */
  getPeers() {
    return this.peers;
  }

  /**
   * Set peers (for initialization)
   */
  setPeers(peers) {
    this.peers = peers;
    this.notifyPeersUpdate();
  }

  /**
   * Notify callback of peer updates
   */
  notifyPeersUpdate() {
    if (this.updateCallback) {
      this.updateCallback(this.peers);
    }
  }

  /**
   * Stop monitoring and cleanup
   */
  cleanup() {
    if (this.peerUpdateInterval) {
      clearInterval(this.peerUpdateInterval);
      this.peerUpdateInterval = null;
      console.log('🧹 Cleared peer transport monitoring interval');
    }
  }
}
