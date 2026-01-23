/**
 * Security endpoints integration tests
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { connectTestDB, disconnectTestDB, ensureTestUser, getTestCredentials } = require('./setup');
const Device = require('../src/models/Device');
const User = require('../src/models/User');
const {jwtSecret} = require('../src/config/env');

// Import app directly (do not start server)
const app = require('../src/app');

// Setup
beforeAll(async () => {
  await connectTestDB();
  await ensureTestUser();
});

// Teardown
afterAll(async () => {
  await disconnectTestDB();
});

describe('Security Endpoints', () => {
  let authToken;
  let userId;
  const testDeviceId = 'test-device-123';

  // Get auth token before running tests
  beforeAll(async () => {
    const { email, password } = getTestCredentials();
    
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    authToken = res.body.data.token;
    
    // Decode token to get userId
    const decoded = jwt.verify(authToken, jwtSecret);
    userId = decoded.id;
  });

  describe('POST /api/v1/security/devices/push-token', () => {
    beforeEach(async () => {
      // Clean up test devices before each test
      await Device.deleteMany({ userId, deviceId: testDeviceId });
    });

    it('should reject request without auth token', async () => {
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .send({ fcmToken: 'test-token-123' })
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject request with missing deviceId', async () => {
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ fcmToken: 'test-token-123' })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'DEVICE_ID_REQUIRED');
    });

    it('should reject request with invalid fcmToken (empty)', async () => {
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken: '' })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'INVALID_FCM_TOKEN');
    });

    it('should reject request with invalid fcmToken (placeholder)', async () => {
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken: 'null' })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'INVALID_FCM_TOKEN');
    });

    it('should reject request with invalid fcmToken (too long)', async () => {
      const longToken = 'a'.repeat(4097);
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken: longToken })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'INVALID_FCM_TOKEN');
    });

    it('should successfully register FCM token for existing device', async () => {
      // Create a device first
      const device = await Device.create({
        userId,
        businessId: userId,
        deviceId: testDeviceId,
        deviceName: 'Test Device',
        platform: 'ios',
        status: 'TRUSTED',
      });

      const fcmToken = 'valid-fcm-token-12345';
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('ok', true);
      expect(res.body.data).toHaveProperty('deviceId', testDeviceId);
      expect(res.body.data).toHaveProperty('tokenUpdatedAt');

      // Verify device was updated
      const updatedDevice = await Device.findById(device._id);
      expect(updatedDevice.fcmToken).toBe(fcmToken);
      expect(updatedDevice.fcmTokenUpdatedAt).toBeInstanceOf(Date);
    });

    it('should create device and register FCM token if device does not exist', async () => {
      const fcmToken = 'new-device-token-12345';
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('ok', true);
      expect(res.body.data).toHaveProperty('deviceId', testDeviceId);

      // Verify device was created
      const device = await Device.findOne({ userId, deviceId: testDeviceId });
      expect(device).toBeTruthy();
      expect(device.fcmToken).toBe(fcmToken);
      expect(device.status).toBe('PENDING'); // New devices start as PENDING
    });

    it('should be idempotent - calling twice updates same device', async () => {
      const fcmToken1 = 'token-1';
      const fcmToken2 = 'token-2';

      // First call
      await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken: fcmToken1 })
        .expect(200);

      // Second call with different token
      await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken: fcmToken2 })
        .expect(200);

      // Verify only one device exists and it has the latest token
      const devices = await Device.find({ userId, deviceId: testDeviceId });
      expect(devices.length).toBe(1);
      expect(devices[0].fcmToken).toBe(fcmToken2);
    });

    it('should reject token registration for BLOCKED device', async () => {
      // Create a blocked device
      const device = await Device.create({
        userId,
        businessId: userId,
        deviceId: testDeviceId,
        deviceName: 'Blocked Device',
        platform: 'ios',
        status: 'BLOCKED',
      });

      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken: 'test-token' })
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'DEVICE_NOT_TRUSTED');

      // Verify token was NOT updated
      const updatedDevice = await Device.findById(device._id);
      expect(updatedDevice.fcmToken).toBeNull();
    });

    it('should allow token registration for PENDING device', async () => {
      // Create a pending device
      const device = await Device.create({
        userId,
        businessId: userId,
        deviceId: testDeviceId,
        deviceName: 'Pending Device',
        platform: 'ios',
        status: 'PENDING',
      });

      const fcmToken = 'pending-device-token';
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);

      // Verify token was updated but status remains PENDING
      const updatedDevice = await Device.findById(device._id);
      expect(updatedDevice.fcmToken).toBe(fcmToken);
      expect(updatedDevice.status).toBe('PENDING'); // Status should not change
    });

    it('should use deviceId from JWT token if available', async () => {
      // Create a token with deviceId claim
      const tokenWithDeviceId = jwt.sign(
        { id: userId, deviceId: testDeviceId },
        jwtSecret,
        { expiresIn: '7d' }
      );

      const fcmToken = 'jwt-device-token';
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${tokenWithDeviceId}`)
        // Do NOT set x-device-id header
        .send({ fcmToken })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('deviceId', testDeviceId);

      // Verify device was created/updated
      const device = await Device.findOne({ userId, deviceId: testDeviceId });
      expect(device).toBeTruthy();
      expect(device.fcmToken).toBe(fcmToken);
    });

    it('should trim whitespace from fcmToken', async () => {
      const fcmToken = '  token-with-spaces  ';
      const res = await request(app)
        .post('/api/v1/security/devices/push-token')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-device-id', testDeviceId)
        .send({ fcmToken })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);

      // Verify token was trimmed
      const device = await Device.findOne({ userId, deviceId: testDeviceId });
      expect(device.fcmToken).toBe('token-with-spaces');
    });
  });
});
