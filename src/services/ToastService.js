/**
 * ToastService - Manages toast notifications
 * Provides centralized toast message handling with automatic timeout
 */
export class ToastService {
  constructor() {
    this.message = '';
    this.timeout = null;
    this.subscribers = new Set();
  }

  /**
   * Show a toast message
   * @param {string} message - The message to display
   * @param {number} duration - Duration in milliseconds (default: 1500)
   */
  show(message, duration = 1500) {
    this.message = message;
    this.notifySubscribers();
    
    // Clear any existing timeout
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    
    // Set new timeout to clear message
    this.timeout = setTimeout(() => {
      this.clear();
    }, duration);
  }

  /**
   * Clear the current toast message
   */
  clear() {
    this.message = '';
    this.notifySubscribers();
    
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  /**
   * Subscribe to toast message changes
   * @param {Function} callback - Function to call when message changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get current message
   * @returns {string} Current toast message
   */
  getMessage() {
    return this.message;
  }

  /**
   * Notify all subscribers of message change
   */
  notifySubscribers() {
    this.subscribers.forEach(callback => callback(this.message));
  }

  /**
   * Cleanup - clear timeout and subscribers
   */
  destroy() {
    this.clear();
    this.subscribers.clear();
  }
}
