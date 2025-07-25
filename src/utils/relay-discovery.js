/**
 * Relay Server Discovery Utility
 * Dynamically fetches WebRTC multiaddrs from the relay server
 */

export class RelayDiscovery {
    constructor(relayHttpUrl = 'http://127.0.0.1:3000') {
        this.relayHttpUrl = relayHttpUrl;
        this.cachedAddrs = null;
        this.lastFetch = null;
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes cache (longer for production)
        this.storageKey = 'libp2p-relay-discovery';
        
        // Load cached data from localStorage on startup
        this.loadFromStorage();
    }

    /**
     * Fetch current WebRTC multiaddrs from relay server
     * @returns {Promise<Object>} Discovery result with WebRTC addresses
     */
    async discoverWebRTCAddrs() {
        // Return cached result if still valid
        if (this.cachedAddrs && this.lastFetch && 
            (Date.now() - this.lastFetch) < this.cacheTTL) {
            return this.cachedAddrs;
        }

        try {
            console.log('🔍 Discovering WebRTC multiaddrs from relay server:', this.relayHttpUrl);
            
            const response = await fetch(`${this.relayHttpUrl}/multiaddrs`);
            console.log('📡 Response status:', response.status, response.statusText);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('📦 Raw server response:', data);
            
            // Process and categorize addresses
            // The server returns addresses in byTransport.webrtc format
            const webrtcAddrs = data.byTransport?.webrtc || [];
            const websocketAddrs = data.byTransport?.websocket || [];
            
            console.log('🔧 Extracted addresses:', {
                webrtcAddrs,
                websocketAddrs,
                byTransportExists: !!data.byTransport,
                webrtcExists: !!data.byTransport?.webrtc
            });
            
            const result = {
                peerId: data.peerId,
                timestamp: data.timestamp,
                all: data.all,
                webrtc: webrtcAddrs,
                // Use best addresses if available from enhanced relay server
                direct: data.best?.webrtc || webrtcAddrs.find(addr => addr.includes('/webrtc-direct/')),
                // Look for circuit relay WebRTC addresses
                circuitRelay: webrtcAddrs.find(addr => addr.includes('/p2p-circuit/webrtc')),
                // Use best websocket or fallback to first available
                websocket: data.best?.websocket || websocketAddrs.find(addr => addr.includes('/ws/')) || data.all.find(addr => addr.includes('/ws/')),
                // Include address quality info if available
                addressInfo: data.addressInfo
            };

            // Cache the result in memory and localStorage
            this.cachedAddrs = result;
            this.lastFetch = Date.now();
            this.saveToStorage();

            console.log('✅ WebRTC addresses discovered:', {
                direct: result.direct,
                circuitRelay: result.circuitRelay,
                websocket: result.websocket,
                webrtcCount: result.webrtc.length,
                cached: 'saved to localStorage'
            });
            
            console.log('📋 Final result object:', result);

            return result;

        } catch (error) {
            console.error('❌ Failed to discover WebRTC addresses:', error);
            throw error;
        }
    }

    /**
     * Get the best WebRTC address for connecting
     * Prefers direct WebRTC over circuit relay for better performance
     * @returns {Promise<string|null>} Best WebRTC multiaddr to use
     */
    async getBestWebRTCAddr() {
        try {
            const discovery = await this.discoverWebRTCAddrs();
            
            // Prefer direct WebRTC for private-to-public connections
            if (discovery.direct) {
                console.log('🎯 Using direct WebRTC address:', discovery.direct);
                return discovery.direct;
            }
            
            // Fall back to circuit relay for private-to-private
            if (discovery.circuitRelay) {
                console.log('🔄 Using circuit relay WebRTC address:', discovery.circuitRelay);
                return discovery.circuitRelay;
            }

            console.warn('⚠️ No WebRTC addresses available');
            return null;

        } catch (error) {
            console.error('❌ Failed to get WebRTC address:', error);
            return null;
        }
    }

    /**
     * Check if relay server is healthy
     * @returns {Promise<boolean>} Health status
     */
    async isRelayHealthy() {
        try {
            const response = await fetch(`${this.relayHttpUrl}/health`);
            return response.ok;
        } catch (error) {
            console.error('Health check failed:', error);
            return false;
        }
    }

    /**
     * Load cached addresses from localStorage
     */
    loadFromStorage() {
        if (typeof window === 'undefined' || !window.localStorage) return;
        
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const data = JSON.parse(stored);
                
                // Check if stored data is still valid
                if (data.lastFetch && (Date.now() - data.lastFetch) < this.cacheTTL) {
                    this.cachedAddrs = data.addresses;
                    this.lastFetch = data.lastFetch;
                    console.log('📦 Loaded WebRTC addresses from localStorage cache');
                } else {
                    console.log('🕒 Cached WebRTC addresses expired, will fetch fresh ones');
                    this.clearStoredCache();
                }
            }
        } catch (error) {
            console.warn('Failed to load cached addresses:', error);
            this.clearStoredCache();
        }
    }

    /**
     * Save cached addresses to localStorage
     */
    saveToStorage() {
        if (typeof window === 'undefined' || !window.localStorage || !this.cachedAddrs) return;
        
        try {
            const data = {
                addresses: this.cachedAddrs,
                lastFetch: this.lastFetch
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
            console.log('💾 Saved WebRTC addresses to localStorage cache');
        } catch (error) {
            console.warn('Failed to save addresses to cache:', error);
        }
    }

    /**
     * Clear cached addresses from memory and localStorage
     */
    clearCache() {
        this.cachedAddrs = null;
        this.lastFetch = null;
        this.clearStoredCache();
    }

    /**
     * Clear only localStorage cache
     */
    clearStoredCache() {
        if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.removeItem(this.storageKey);
        }
    }
}

// Singleton instance for convenience - will be configured by diagnostics
let relayDiscovery = null;

/**
 * Get or create the relay discovery instance with correct URL
 */
export function getRelayDiscovery() {
  if (!relayDiscovery) {
    // This will be overridden by diagnostics with the correct URL
    relayDiscovery = new RelayDiscovery();
  }
  return relayDiscovery;
}

/**
 * Set the relay discovery instance (used by diagnostics)
 */
export function setRelayDiscovery(instance) {
  relayDiscovery = instance;
}

/**
 * Quick utility function to get current WebRTC address
 * @returns {Promise<string|null>} Current best WebRTC multiaddr
 */
export async function getCurrentWebRTCAddr() {
    return getRelayDiscovery().getBestWebRTCAddr();
}

/**
 * Quick utility function to discover all addresses
 * @returns {Promise<Object>} Complete discovery result
 */
export async function discoverRelay() {
    return getRelayDiscovery().discoverWebRTCAddrs();
}
