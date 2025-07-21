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
   * Auto-subscribe to discovered OrbitDB topics
   * @param {function} messageHandler - Handler for messages from discovered topics
   */
  async enableAutoSubscribe(messageHandler) {
    this.messageHandler = messageHandler
    
    // Subscribe to already discovered topics
    for (const topic of this.discoveredTopics) {
      await this.subscribeToTopic(topic)
    }
    
    // Set up auto-subscription for future discoveries
    this.autoSubscribe = true
  }

  /**
   * Subscribe to a specific topic
   * @private
   */
  async subscribeToTopic(topic) {
    try {
      await this.ipfs.libp2p.services.pubsub.subscribe(topic)
      this.autoSubscriptions.set(topic, true)
      console.log(`Auto-subscribed to OrbitDB topic: ${topic}`)
      
      // Add message listener if we have a handler
      if (this.messageHandler && !this.hasMessageListener) {
        this.ipfs.libp2p.services.pubsub.addEventListener('message', this.messageHandler)
        this.hasMessageListener = true
      }
    } catch (error) {
      console.error(`Failed to subscribe to ${topic}:`, error)
    }
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
 * Enhanced discovery with pattern matching
 */
export class AdvancedOrbitDBDiscovery extends OrbitDBTopicDiscovery {
  constructor(ipfs, patterns = []) {
    super(ipfs)
    this.customPatterns = patterns
  }

  /**
   * Add custom patterns for OrbitDB detection
   */
  addPattern(pattern) {
    this.customPatterns.push(pattern)
  }

  /**
   * Enhanced OrbitDB topic detection
   * @private
   */
  isOrbitDBTopic(topic) {
    // Standard OrbitDB patterns
    if (super.isOrbitDBTopic(topic)) {
      return true
    }
    
    // Check custom patterns
    return this.customPatterns.some(pattern => {
      if (typeof pattern === 'string') {
        return topic.includes(pattern)
      } else if (pattern instanceof RegExp) {
        return pattern.test(topic)
      }
      return false
    })
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
    
    // Optionally auto-subscribe to interesting topics
    if (topic.includes('todo') || topic.includes('chat')) {
      try {
        await ipfs.libp2p.services.pubsub.subscribe(topic)
        console.log(`Auto-subscribed to interesting topic: ${topic}`)
      } catch (error) {
        console.error(`Failed to subscribe to ${topic}:`, error)
      }
    }
  })
  
  return discovery
}

/**
 * Monitor all OrbitDB activity
 */
export async function monitorAllOrbitDBActivity(ipfs) {
  const discovery = new OrbitDBTopicDiscovery(ipfs)
  
  // Auto-subscribe to all discovered OrbitDB topics
  await discovery.enableAutoSubscribe(async (event) => {
    const { topic, data, from } = event.detail
    
    try {
      // Try to decode as OrbitDB entry
      const { Entry } = await import('@orbitdb/core')
      const entry = await Entry.decode(data)
      
      console.log(`OrbitDB Activity on ${topic}:`, {
        payload: entry.payload,
        hash: entry.hash,
        from: String(from),
        timestamp: new Date()
      })
    } catch (error) {
      // Not an OrbitDB entry or decode failed
      console.log(`Non-OrbitDB message on ${topic}:`, data.length, 'bytes')
    }
  })
  
  await discovery.startDiscovery(async (topic, peerId) => {
    console.log(`Discovered and auto-subscribing to: ${topic}`)
    await discovery.subscribeToTopic(topic)
  })
  
  return discovery
}
