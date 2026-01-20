/**
 * Stub Transport
 * 
 * Used for channels that are not yet configured (PUSH, WHATSAPP, SMS)
 * Always fails with PROVIDER_NOT_CONFIGURED error
 * This ensures visibility of delivery failures
 */
const BaseTransport = require('./BaseTransport');
const logger = require('../../utils/logger');

class StubTransport extends BaseTransport {
  constructor(channel) {
    super();
    this.channel = channel;
  }
  
  async send({notification, attempt}) {
    logger.warn('[StubTransport] Provider not configured', {
      channel: this.channel,
      notificationId: notification._id,
      attempt: attempt.attemptNo,
    });
    
    // Throw error to mark attempt as failed
    const error = new Error(`${this.channel} provider not configured`);
    error.code = 'PROVIDER_NOT_CONFIGURED';
    error.retryable = false; // Don't retry until provider is configured
    
    throw error;
  }
  
  getName() {
    return `StubTransport(${this.channel})`;
  }
  
  async isAvailable() {
    return false;
  }
}

module.exports = StubTransport;
