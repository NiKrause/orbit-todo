/**
 * OrbitDB Topic Discovery
 * Monitors peer subscription events to discover and subscribe to OrbitDB databases
 */
export class OrbitDBTopicDiscovery {
    constructor(ipfs) {
      this.ipfs = ipfs
      this.discoveredTopics = new Set()
      this.autoSubscriptions = new Map()
      this.onTopicDiscovered = null
      
      this.subscriptionHandler = this.handleSubscriptionChange.bind(this)
    }
  
    /**
     * Start monitoring for OrbitDB topic discoveries
     * @param {function} onTopicDiscovered - Callback when new OrbitDB topic is found
     */
    async startDiscovery(onTopicDiscovered) {
      this.onTopicDiscovered = onTopicDiscovered
      
      // Listen for peer subscription changes
      this.ipfs.libp2p.services.pubsub.addEventListener('subscription-change', this.subscriptionHandler)
      
      console.log('Started OrbitDB topic discovery...')
    }
  
    /**
     * Stop monitoring
     */
    async stopDiscovery() {
      this.ipfs.libp2p.services.pubsub.removeEventListener('subscription-change', this.subscriptionHandler)
      console.log('Stopped OrbitDB topic discovery')
    }
  
    /**
     * Handle peer subscription changes
     * @private
     */
    async handleSubscriptionChange(event) {
      const { peerId, subscriptions } = event.detail
      
      for (const subscription of subscriptions) {
        const { topic, subscribe } = subscription
        
        // Check if this is an OrbitDB topic
        if (this.isOrbitDBTopic(topic)) {
          if (subscribe && !this.discoveredTopics.has(topic)) {
            // New OrbitDB database discovered
            this.discoveredTopics.add(topic)
            console.log(`Discovered new OrbitDB database: ${topic} from peer ${peerId}`)
            
            if (this.onTopicDiscovered) {
              await this.onTopicDiscovered(topic, peerId)
            }
          }
        }
      }
    }
  
    /**
     * Check if a topic is an OrbitDB topic
     * @private
     */
    isOrbitDBTopic(topic) {
      // OrbitDB topics typically start with /orbitdb/ or contain orbitdb patterns
      return topic.startsWith('/orbitdb/') || 
             topic.includes('orbitdb') ||
             // You can add more patterns based on your OrbitDB address format
             /^\/.*\/.*\/.*$/.test(topic) // Generic pattern for OrbitDB-like addresses
    }
  

  
    /**
     * Get all discovered OrbitDB topics
     */
    getDiscoveredTopics() {
      return Array.from(this.discoveredTopics)
    }
  
    /**
     * Manually scan current peer subscriptions for OrbitDB topics
     */
    async scanExistingTopics() {
      try {
        // Get current peers and their subscriptions
        const peers = this.ipfs.libp2p.services.pubsub.getSubscribers()
        
        // This is a limitation - pubsub doesn't expose all topics directly
        // We can only discover topics when peers subscribe/unsubscribe
        console.log('Current peer subscriptions are not directly queryable in libp2p')
        console.log('Discovery will happen as peers subscribe to new topics')
      } catch (error) {
        console.error('Error scanning existing topics:', error)
      }
    }
  }
  
  /**
   * Usage example
   */
  export async function setupOrbitDBDiscovery(ipfs) {
    const discovery = new OrbitDBTopicDiscovery(ipfs)
    
    // Start discovery with callback
    await discovery.startDiscovery(async (topic, peerId) => {
      console.log(`New OrbitDB database discovered: ${topic}`)
      console.log(`Discovered by peer: ${peerId}`)
      
    })
    
    return discovery
  }
