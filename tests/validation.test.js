/**
 * Validation integration tests
 * Tests that Joi validation middleware works correctly
 */
const request = require('supertest');
const { connectTestDB, disconnectTestDB, ensureTestUser, getTestCredentials } = require('./setup');

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

describe('Input Validation', () => {
  let authToken;

  // Get auth token before running tests
  beforeAll(async () => {
    const { email, password } = getTestCredentials();
    
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    authToken = res.body.data.token;
  });

  describe('POST /api/bills - Validation', () => {
    it('should reject empty request body', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject invalid customerId format', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId: 'invalid-id',
          items: [],
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toMatch(/validation/i);
    });

    it('should reject missing required fields', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId: '507f1f77bcf86cd799439011',
          // Missing items array
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return validation error details', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId: 'invalid',
          items: 'not-an-array',
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
      // Should include validation details
      expect(res.body.error).toBeTruthy();
    });
  });

  describe('POST /api/customers - Validation', () => {
    it('should reject missing name field', async () => {
      const res = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          phone: '9876543210',
          // Missing name
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject invalid phone number', async () => {
      const res = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Customer',
          phone: '123', // Too short
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('ObjectId Validation Middleware', () => {
    it('should reject invalid ObjectId in URL params', async () => {
      const res = await request(app)
        .get('/api/bills/not-a-valid-objectid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toMatch(/invalid.*id/i);
    });

    it('should accept valid ObjectId format', async () => {
      // This should pass ObjectId validation but return 404 (not found)
      const res = await request(app)
        .get('/api/bills/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404); // Not 400 - ObjectId is valid format

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('Rate Limiting', () => {
    it('should not rate limit normal usage', async () => {
      // Make a few requests - should all succeed
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .get('/api/bills')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('success', true);
      }
    });

    // Note: Testing actual rate limit triggering would require 300+ requests
    // which is slow for integration tests. This is better tested in load tests.
  });
});
