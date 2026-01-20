/**
 * Base Transport Interface
 * 
 * All notification transports must implement this interface
 */

class BaseTransport {
  /**
   * Send a notification via this transport
   * 
   * @param {Object} params
   * @param {Object} params.notification - Notification object
   * @param {Object} params.attempt - NotificationAttempt object
   * @param {Object} params.user - User object
   * @param {Object} params.customer - Customer object (optional)
   * @returns {Promise<Object>} - { ok: true, providerMessageId } or throws error
   */
  async send({notification, attempt, user, customer}) {
    throw new Error('Transport.send() must be implemented');
  }
  
  /**
   * Check if transport is available/configured
   * 
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return true;
  }
  
  /**
   * Get transport name
   * 
   * @returns {string}
   */
  getName() {
    return 'BaseTransport';
  }
}

module.exports = BaseTransport;
