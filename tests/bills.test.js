/**
 * Bills endpoints integration tests
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

describe('Bills Endpoints', () => {
  let authToken;

  // Get auth token before running tests
  beforeAll(async () => {
    const { email, password } = getTestCredentials();
    
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    authToken = res.body.data.token;
  });

  describe('GET /api/bills', () => {
    it('should reject request without auth token', async () => {
      const res = await request(app)
        .get('/api/bills')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject request with invalid auth token', async () => {
      const res = await request(app)
        .get('/api/bills')
        .set('Authorization', 'Bearer invalid-token-here')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return bills list with valid auth token', async () => {
      const res = await request(app)
        .get('/api/bills')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should support pagination parameters', async () => {
      const res = await request(app)
        .get('/api/bills?limit=5&page=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
    });

    it('should support filtering by status', async () => {
      const res = await request(app)
        .get('/api/bills?status=paid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('GET /api/bills/summary', () => {
    it('should reject request without auth token', async () => {
      const res = await request(app)
        .get('/api/bills/summary')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return bills summary with valid auth token', async () => {
      const res = await request(app)
        .get('/api/bills/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      
      // Verify summary includes counts and amounts
      expect(res.body.data).toHaveProperty('totalCount');
      expect(res.body.data).toHaveProperty('totalAmount');
      expect(res.body.data).toHaveProperty('paidAmount');
      expect(res.body.data).toHaveProperty('pendingAmount');
    });

    it('should support filtering in summary', async () => {
      const res = await request(app)
        .get('/api/bills/summary?status=unpaid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('totalCount');
    });
  });

  describe('GET /api/bills/:id', () => {
    it('should reject request without auth token', async () => {
      const res = await request(app)
        .get('/api/bills/507f1f77bcf86cd799439011') // Valid ObjectId format
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject invalid ObjectId format', async () => {
      const res = await request(app)
        .get('/api/bills/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent bill', async () => {
      const res = await request(app)
        .get('/api/bills/507f1f77bcf86cd799439011') // Valid but doesn't exist
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });
  });
});
