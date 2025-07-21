/**
 * Relay Server Discovery Utility
 * Dynamically fetches WebRTC multiaddrs from the relay server
 */

export class RelayDiscovery {
    constructor(relayHttpUrl = 'http://localhost:3000') {
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
            console.log('🔍 Discovering WebRTC multiaddrs from relay server...');
            
            const response = await fetch(`${this.relayHttpUrl}/multiaddrs`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            // Process and categorize addresses
            const result = {
                peerId: data.peerId,
                timestamp: data.timestamp,
                all: data.all,
                webrtc: data.webrtc,
                direct: data.webrtc.find(addr => addr.includes('/tcp/') && addr.includes('/webrtc')),
                circuitRelay: data.webrtc.find(addr => addr.includes('/p2p-circuit/webrtc')),
                websocket: data.all.find(addr => addr.includes('/ws'))
            };

            // Cache the result in memory and localStorage
            this.cachedAddrs = result;
            this.lastFetch = Date.now();
            this.saveToStorage();

            console.log('✅ WebRTC addresses discovered:', {
                direct: result.direct,
                circuitRelay: result.circuitRelay,
                cached: 'saved to localStorage'
            });

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

// Singleton instance for convenience
export const relayDiscovery = new RelayDiscovery();

/**
 * Quick utility function to get current WebRTC address
 * @returns {Promise<string|null>} Current best WebRTC multiaddr
 */
export async function getCurrentWebRTCAddr() {
    return relayDiscovery.getBestWebRTCAddr();
}

/**
 * Quick utility function to discover all addresses
 * @returns {Promise<Object>} Complete discovery result
 */
export async function discoverRelay() {
    return relayDiscovery.discoverWebRTCAddrs();
}
