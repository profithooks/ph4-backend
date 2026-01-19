/**
 * Authentication integration tests
 */
const request = require('supertest');
const { connectTestDB, disconnectTestDB, ensureTestUser, getTestCredentials } = require('./setup');

// Import app directly (do not start server)
const app = require('../src/app');

// Setup
beforeAll(async () => {
  await connectTestDB();
  await ensureTestUser(); // Create test user if needed
});

// Teardown
afterAll(async () => {
  await disconnectTestDB();
});

describe('Authentication Endpoints', () => {
  let authToken;

  describe('POST /api/auth/login', () => {
    it('should reject login with missing credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject login with invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'wrong@example.com',
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should successfully login with valid credentials', async () => {
      const { email, password } = getTestCredentials();
      
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      // Verify response structure
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data).toHaveProperty('email', email);
      
      // Verify token exists and is a string
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.token.length).toBeGreaterThan(20);

      // Save token for other tests
      authToken = res.body.data.token;
    });

    it('should return user data on successful login', async () => {
      const { email, password } = getTestCredentials();
      
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      expect(res.body.data).toHaveProperty('_id');
      expect(res.body.data).toHaveProperty('name');
      expect(res.body.data).toHaveProperty('email');
    });
  });

  describe('POST /api/auth/signup', () => {
    it('should reject signup with missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          email: 'incomplete@example.com',
          // Missing name and password
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject signup with existing email', async () => {
      const { email } = getTestCredentials();
      
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Duplicate User',
          email: email, // Already exists
          password: 'NewPassword123!',
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should successfully create new user', async () => {
      const uniqueEmail = `test-${Date.now()}@example.com`;
      
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'New Test User',
          email: uniqueEmail,
          password: 'NewPassword123!',
          phone: '+919876543210',
        })
        .expect(201);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data).toHaveProperty('email', uniqueEmail);
    });
  });

  // Export token for use in other test files
  afterAll(() => {
    global.testAuthToken = authToken;
  });
});
