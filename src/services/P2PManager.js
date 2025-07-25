/**
 * P2PManager - Service for managing P2P initialization and database updates
 */
export class P2PManager {
  constructor(toastService, p2pFunctions) {
    this.toastService = toastService;
    this.p2p = p2pFunctions;
    this.isInitialized = false;
    this.updateCallbacks = new Set();
  }

  /**
   * Initialize P2P system
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.p2p.initializeP2P();
      this.isInitialized = true;
      
      // Set up database update subscription
      this.p2p.onDatabaseUpdate(async (eventType, eventData) => {
        console.log("eventType", eventType);
        console.log("eventData", eventData);
        
        // Only refresh for certain event types
        if (eventType === 'update' || !eventType) {
          const updateData = {
            todos: await this.p2p.getAllTodos(),
            peers: this.p2p.getConnectedPeers(),
            dbAddress: this.p2p.getTodoDbAddress(),
            dbName: this.p2p.getTodoDbName()
          };
          
          // Notify all callbacks
          this.updateCallbacks.forEach(callback => callback(updateData));
          
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
      });
      
    } catch (error) {
      console.error('Failed to initialize P2P:', error);
      throw error;
    }
  }

  /**
   * Get initial application state
   */
  async getInitialState() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return {
      todos: await this.p2p.getAllTodos(),
      peers: this.p2p.getConnectedPeers(),
      myPeerId: this.p2p.getMyPeerId(),
      dbAddress: this.p2p.getTodoDbAddress(),
      dbName: this.p2p.getTodoDbName(),
      peerOrbitDbAddresses: this.p2p.getPeerOrbitDbAddresses()
    };
  }

  /**
   * Subscribe to database updates
   */
  onUpdate(callback) {
    this.updateCallbacks.add(callback);
    return () => this.updateCallbacks.delete(callback);
  }

  /**
   * Todo operations
   */
  async addTodo(text, assignee = null) {
    return await this.p2p.addTodo(text, assignee);
  }

  async updateTodo(id, updates) {
    return await this.p2p.updateTodo(id, updates);
  }

  async deleteTodo(id) {
    return await this.p2p.deleteTodo(id);
  }

  /**
   * Get current state snapshot
   */
  getCurrentState() {
    return {
      dbAddress: this.p2p.getTodoDbAddress(),
      dbName: this.p2p.getTodoDbName(),
      myPeerId: this.p2p.getMyPeerId(),
      peers: this.p2p.getConnectedPeers(),
      peerOrbitDbAddresses: this.p2p.getPeerOrbitDbAddresses()
    };
  }

  /**
   * Check if initialized
   */
  get initialized() {
    return this.isInitialized;
  }
}
