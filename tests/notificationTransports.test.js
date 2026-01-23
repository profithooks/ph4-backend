/**
 * Notification Transports Tests
 * 
 * Verifies transport selection logic (StubTransport vs FirebasePushTransport)
 */
const {getTransport} = require('../src/services/notificationTransports');
const StubTransport = require('../src/services/notificationTransports/StubTransport');
const {isFirebaseConfigured} = require('../src/config/firebase');

describe('Notification Transports', () => {
  describe('PUSH transport selection', () => {
    it('should use StubTransport when Firebase is not configured', () => {
      // Ensure Firebase is not configured for this test
      const originalEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      const originalPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      
      // Clear require cache to force re-evaluation
      delete require.cache[require.resolve('../src/services/notificationTransports')];
      delete require.cache[require.resolve('../src/config/firebase')];
      
      // Re-require to get fresh state
      const {getTransport: getTransportFresh} = require('../src/services/notificationTransports');
      
      const transport = getTransportFresh('PUSH');
      
      expect(transport).toBeInstanceOf(StubTransport);
      expect(transport.getName()).toBe('StubTransport(PUSH)');
      
      // Restore env
      if (originalEnv) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalEnv;
      if (originalPath) process.env.FIREBASE_SERVICE_ACCOUNT_PATH = originalPath;
    });

    it('should use FirebasePushTransport when Firebase is configured', () => {
      // Skip if Firebase is not actually configured in test environment
      if (!isFirebaseConfigured()) {
        console.log('[SKIP] Firebase not configured in test environment, skipping FirebasePushTransport test');
        return;
      }

      // Clear require cache
      delete require.cache[require.resolve('../src/services/notificationTransports')];
      delete require.cache[require.resolve('../src/config/firebase')];
      
      // Re-require
      const {getTransport: getTransportFresh} = require('../src/services/notificationTransports');
      
      const transport = getTransportFresh('PUSH');
      
      expect(transport.getName()).toBe('FirebasePushTransport');
      expect(transport.isAvailable).toBeDefined();
    });

    it('should handle IN_APP transport correctly', () => {
      const transport = getTransport('IN_APP');
      
      expect(transport).toBeDefined();
      expect(transport.getName()).toBe('InAppTransport');
    });

    it('should throw error for unknown channel', () => {
      expect(() => {
        getTransport('UNKNOWN_CHANNEL');
      }).toThrow('No transport configured for channel: UNKNOWN_CHANNEL');
    });
  });
});
