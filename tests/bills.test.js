/**
 * Bills endpoints integration tests
 */
const request = require('supertest');
const { connectTestDB, disconnectTestDB, ensureTestUser, getTestCredentials } = require('./setup');
const Bill = require('../src/models/Bill');
const Customer = require('../src/models/Customer');
const BillShareLink = require('../src/models/BillShareLink');

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

  describe('POST /api/bills/:id/share-link', () => {
    let testBillId;
    let testCustomerId;

    // Create test customer and bill before share link tests
    beforeAll(async () => {
      const { email } = getTestCredentials();
      const user = await require('../src/models/User').findOne({ email });
      
      // Create test customer
      const customer = await Customer.create({
        userId: user._id,
        name: 'Test Customer',
        phone: '+919999999999',
      });
      testCustomerId = customer._id;

      // Create test bill
      const bill = await Bill.create({
        userId: user._id,
        customerId: testCustomerId,
        billNo: 'BILL-TEST-001',
        items: [
          {
            name: 'Test Item',
            qty: 1,
            price: 100,
            total: 100,
          },
        ],
        subTotal: 100,
        grandTotal: 100,
        status: 'pending',
        date: new Date(),
      });
      testBillId = bill._id;
    });

    // Cleanup after tests
    afterAll(async () => {
      if (testBillId) {
        await Bill.deleteOne({ _id: testBillId });
      }
      if (testCustomerId) {
        await Customer.deleteOne({ _id: testCustomerId });
      }
      await BillShareLink.deleteMany({});
    });

    it('should reject request without auth token', async () => {
      const res = await request(app)
        .post(`/api/bills/${testBillId}/share-link`)
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should create share link for bill', async () => {
      const res = await request(app)
        .post(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('url');
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.url).toContain('/public/b/');
      expect(res.body.data.token).toMatch(/^[a-f0-9]{48}$/i); // 48 char hex
    });

    it('should return existing link if already created (idempotent)', async () => {
      // First call
      const res1 = await request(app)
        .post(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const token1 = res1.body.data.token;

      // Second call should return same link
      const res2 = await request(app)
        .post(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res2.body.data.token).toBe(token1);
    });

    it('should return 404 for non-existent bill', async () => {
      const fakeId = require('mongoose').Types.ObjectId();
      const res = await request(app)
        .post(`/api/bills/${fakeId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return URL pointing to web domain (/b/:token path)', async () => {
      // This test verifies that share links point to web frontend, not backend
      // Default dev: http://localhost:5173/b/:token
      const res = await request(app)
        .post(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('url');
      expect(res.body.data.url).toContain('/b/');
      expect(res.body.data.url).not.toContain('/public/b/'); // Should be /b/, not /public/b/
      
      // In dev (default), should use http://localhost:5173
      if (!process.env.PUBLIC_APP_BASE_URL) {
        expect(res.body.data.url).toMatch(/^http:\/\/localhost:5173\/b\/[a-f0-9]{48}$/i);
      } else {
        // If PUBLIC_APP_BASE_URL is set, verify it's used
        expect(res.body.data.url).toMatch(
          new RegExp(`^${process.env.PUBLIC_APP_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/b/[a-f0-9]{48}$`, 'i')
        );
      }
    });

    it('should fail in production if PUBLIC_APP_BASE_URL is missing', async () => {
      // Save original env
      const originalEnv = process.env.PUBLIC_APP_BASE_URL;
      const originalNodeEnv = process.env.NODE_ENV;
      
      try {
        // Set production env without base URL
        process.env.NODE_ENV = 'production';
        delete process.env.PUBLIC_APP_BASE_URL;
        
        // Reload env config to pick up new value
        delete require.cache[require.resolve('../src/config/env')];
        delete require.cache[require.resolve('../src/controllers/billShare.controller')];
        
        const res = await request(app)
          .post(`/api/bills/${testBillId}/share-link`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(500);

        expect(res.body).toHaveProperty('success', false);
        expect(res.body.message).toContain('PUBLIC_APP_BASE_URL must be set');
        expect(res.body.code).toBe('MISSING_PUBLIC_APP_BASE_URL');
      } finally {
        // Restore original env
        process.env.PUBLIC_APP_BASE_URL = originalEnv;
        process.env.NODE_ENV = originalNodeEnv;
        // Reload config
        delete require.cache[require.resolve('../src/config/env')];
        delete require.cache[require.resolve('../src/controllers/billShare.controller')];
      }
    });
  });

  describe('DELETE /api/bills/:id/share-link', () => {
    let testBillId;
    let testCustomerId;

    // Create test customer and bill with share link
    beforeAll(async () => {
      const { email } = getTestCredentials();
      const user = await require('../src/models/User').findOne({ email });
      
      // Create test customer
      const customer = await Customer.create({
        userId: user._id,
        name: 'Test Customer Revoke',
        phone: '+919999999888',
      });
      testCustomerId = customer._id;

      // Create test bill
      const bill = await Bill.create({
        userId: user._id,
        customerId: testCustomerId,
        billNo: 'BILL-TEST-002',
        items: [
          {
            name: 'Test Item',
            qty: 1,
            price: 200,
            total: 200,
          },
        ],
        subTotal: 200,
        grandTotal: 200,
        status: 'pending',
        date: new Date(),
      });
      testBillId = bill._id;

      // Create share link
      await request(app)
        .post(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`);
    });

    // Cleanup after tests
    afterAll(async () => {
      if (testBillId) {
        await Bill.deleteOne({ _id: testBillId });
      }
      if (testCustomerId) {
        await Customer.deleteOne({ _id: testCustomerId });
      }
      await BillShareLink.deleteMany({});
    });

    it('should revoke share link', async () => {
      const res = await request(app)
        .delete(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message');

      // Verify link is revoked
      const shareLink = await BillShareLink.findOne({ billId: testBillId });
      expect(shareLink.status).toBe('revoked');
      expect(shareLink.revokedAt).toBeTruthy();
    });

    it('should return success if link already revoked (idempotent)', async () => {
      const res = await request(app)
        .delete(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('GET /public/b/:token', () => {
    let testBillId;
    let testCustomerId;
    let shareToken;

    // Create test customer, bill, and share link
    beforeAll(async () => {
      const { email } = getTestCredentials();
      const user = await require('../src/models/User').findOne({ email });
      
      // Create test customer
      const customer = await Customer.create({
        userId: user._id,
        name: 'Public Test Customer',
        phone: '+919999999777',
      });
      testCustomerId = customer._id;

      // Create test bill
      const bill = await Bill.create({
        userId: user._id,
        customerId: testCustomerId,
        billNo: 'BILL-PUBLIC-001',
        items: [
          {
            name: 'Public Test Item',
            qty: 2,
            price: 150,
            total: 300,
          },
        ],
        subTotal: 300,
        grandTotal: 300,
        status: 'pending',
        date: new Date(),
        notes: 'Test notes for public bill',
      });
      testBillId = bill._id;

      // Create share link
      const res = await request(app)
        .post(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`);
      
      shareToken = res.body.data.token;
    });

    // Cleanup after tests
    afterAll(async () => {
      if (testBillId) {
        await Bill.deleteOne({ _id: testBillId });
      }
      if (testCustomerId) {
        await Customer.deleteOne({ _id: testCustomerId });
      }
      await BillShareLink.deleteMany({});
    });

    it('should return HTML bill viewer for valid token', async () => {
      const res = await request(app)
        .get(`/public/b/${shareToken}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('BILL-PUBLIC-001');
      expect(res.text).toContain('Public Test Customer');
      expect(res.text).toContain('Public Test Item');
      expect(res.text).toContain('₹300');
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('should return 404 for invalid token format', async () => {
      const res = await request(app)
        .get('/public/b/invalid-token')
        .expect(404);

      expect(res.text).toContain('Link Not Found');
    });

    it('should return 404 for revoked link', async () => {
      // Revoke the link
      await request(app)
        .delete(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`);

      const res = await request(app)
        .get(`/public/b/${shareToken}`)
        .expect(404);

      expect(res.text).toContain('Link Expired or Revoked');
    });

    it('should update access metrics on view', async () => {
      // Create new link for metrics test
      const res1 = await request(app)
        .post(`/api/bills/${testBillId}/share-link`)
        .set('Authorization', `Bearer ${authToken}`);
      
      const newToken = res1.body.data.token;

      // Get initial share link
      const shareLinkBefore = await BillShareLink.findOne({ token: newToken });
      const initialCount = shareLinkBefore.accessCount;

      // Access public link
      await request(app)
        .get(`/public/b/${newToken}`)
        .expect(200);

      // Verify metrics updated
      const shareLinkAfter = await BillShareLink.findOne({ token: newToken });
      expect(shareLinkAfter.accessCount).toBe(initialCount + 1);
      expect(shareLinkAfter.lastAccessAt).toBeTruthy();
    });
  });
});
