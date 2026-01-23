/**
 * Notification Transports Registry
 * 
 * Maps channels to their transport implementations
 */
const InAppTransport = require('./InAppTransport');
const StubTransport = require('./StubTransport');
const {isFirebaseConfigured} = require('../../config/firebase');
const logger = require('../../utils/logger');

// Lazy load FirebasePushTransport to avoid import errors if firebase-admin is not installed
let FirebasePushTransport = null;
let _firebasePushTransportInstance = null;

function getPushTransport() {
  // If Firebase is not configured, return StubTransport
  if (!isFirebaseConfigured()) {
    return new StubTransport('PUSH');
  }

  // If we already have an instance, return it
  if (_firebasePushTransportInstance) {
    return _firebasePushTransportInstance;
  }

  // Try to load FirebasePushTransport
  if (!FirebasePushTransport) {
    try {
      FirebasePushTransport = require('./FirebasePushTransport');
    } catch (error) {
      logger.warn('[NotificationTransports] Firebase configured but FirebasePushTransport failed to load', {
        error: error.message,
      });
      return new StubTransport('PUSH');
    }
  }

  // Create instance
  try {
    _firebasePushTransportInstance = new FirebasePushTransport();
    return _firebasePushTransportInstance;
  } catch (error) {
    logger.warn('[NotificationTransports] Failed to instantiate FirebasePushTransport', {
      error: error.message,
    });
    return new StubTransport('PUSH');
  }
}

// Initialize transports
const transports = {
  IN_APP: new InAppTransport(),
  // PUSH: Dynamically selected based on Firebase config (lazy evaluation)
  get PUSH() {
    return getPushTransport();
  },
  WHATSAPP: new StubTransport('WHATSAPP'),
  SMS: new StubTransport('SMS'),
  EMAIL: new StubTransport('EMAIL'),
};

/**
 * Get transport for a channel
 * 
 * @param {string} channel - Channel name (IN_APP, PUSH, etc.)
 * @returns {BaseTransport}
 */
function getTransport(channel) {
  const transport = transports[channel];
  
  if (!transport) {
    throw new Error(`No transport configured for channel: ${channel}`);
  }
  
  return transport;
}

/**
 * Register a custom transport for a channel
 * (Used when real providers are added)
 * 
 * @param {string} channel
 * @param {BaseTransport} transport
 */
function registerTransport(channel, transport) {
  transports[channel] = transport;
}

module.exports = {
  getTransport,
  registerTransport,
  transports,
};
