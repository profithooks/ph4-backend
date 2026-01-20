/**
 * Notification Transports Registry
 * 
 * Maps channels to their transport implementations
 */
const InAppTransport = require('./InAppTransport');
const StubTransport = require('./StubTransport');

// Initialize transports
const transports = {
  IN_APP: new InAppTransport(),
  PUSH: new StubTransport('PUSH'),
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
