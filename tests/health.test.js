/**
 * Health endpoint integration tests
 */
const request = require('supertest');
const { connectTestDB, disconnectTestDB } = require('./setup');

// Import app directly (do not start server)
const app = require('../src/app');

// Setup
beforeAll(async () => {
  await connectTestDB();
});

// Teardown
afterAll(async () => {
  await disconnectTestDB();
});

describe('Health Endpoints', () => {
  describe('GET /api/health', () => {
    it('should return 200 and health status', async () => {
      const res = await request(app)
        .get('/api/health')
        .expect(200);

      // Verify response structure
      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('services');
      expect(res.body.services).toHaveProperty('mongodb');
      
      // Verify MongoDB is UP
      expect(res.body.services.mongodb.status).toBe('UP');
    });

    it('should include uptime and environment', async () => {
      const res = await request(app)
        .get('/api/health')
        .expect(200);

      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('environment');
    });
  });

  describe('GET /health (legacy)', () => {
    it('should return 200 for backward compatibility', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message');
    });
  });
});
