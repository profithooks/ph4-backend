# Backend Integration Tests

This directory contains integration tests for the PH4 backend API.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start MongoDB (if local):**
   ```bash
   # Option 1: Local MongoDB
   mongod
   
   # Option 2: Docker
   docker run -d -p 27017:27017 --name ph4-test-mongo mongo:latest
   ```

3. **Run tests:**
   ```bash
   TEST_MONGO_URI=mongodb://localhost:27017/ph4_test \
   TEST_EMAIL=test@example.com \
   TEST_PASSWORD=Test123456! \
   npm test
   ```

## Environment Variables

Required environment variables for tests:

```bash
TEST_MONGO_URI=mongodb://localhost:27017/ph4_test  # Test database URI
TEST_EMAIL=test@example.com                        # Test user email
TEST_PASSWORD=Test123456!                          # Test user password
```

## Test Files

| File | Purpose | Coverage |
|------|---------|----------|
| `setup.js` | Database connection & test utilities | N/A |
| `health.test.js` | Health endpoint tests | 2 tests |
| `auth.test.js` | Login/signup tests | 7 tests |
| `bills.test.js` | Bills endpoints + auth check | 10 tests |
| `validation.test.js` | Input validation tests | 8 tests |

**Total:** ~27 integration tests

## Test Philosophy

- **Integration tests** - Test real HTTP requests through Express
- **Real database** - Uses actual MongoDB (not mocked)
- **No server listener** - Uses `supertest(app)` directly
- **Minimal** - Tests core flows to prevent regressions
- **Fast** - Runs in < 30 seconds on local machine

## What is Tested

✅ **Health endpoints** - Status, MongoDB connectivity  
✅ **Authentication** - Login, signup, token generation  
✅ **Authorization** - Protected routes return 401 without token  
✅ **Bills listing** - Pagination, filtering, auth checks  
✅ **Bills summary** - Aggregation, filtering  
✅ **Input validation** - Joi schema validation, error messages  
✅ **ObjectId validation** - URL param validation  
✅ **Error formats** - Consistent 400/401/404 responses

## What is NOT Tested

⚠️ **Full CRUD** - Focus on GET + auth, not all POST/PUT/DELETE  
⚠️ **Complex flows** - Bill payment, recovery workflows  
⚠️ **Cron jobs** - Message delivery scheduled tasks  
⚠️ **Load/performance** - Use k6 load tests instead  
⚠️ **Frontend** - Separate React Native test suite

## Running Tests

**All tests:**
```bash
npm test
```

**Watch mode (re-run on file changes):**
```bash
npm run test:watch
```

**CI mode (parallel, coverage):**
```bash
npm run test:ci
```

**Single test file:**
```bash
npm test -- tests/auth.test.js
```

**Specific test:**
```bash
npm test -- -t "should successfully login"
```

## Test Output

```
 PASS  tests/health.test.js
 PASS  tests/auth.test.js
 PASS  tests/bills.test.js
 PASS  tests/validation.test.js

Test Suites: 4 passed, 4 total
Tests:       27 passed, 27 total
Snapshots:   0 total
Time:        12.345 s
```

## Troubleshooting

**"Cannot connect to MongoDB":**
- Verify MongoDB is running: `mongosh mongodb://localhost:27017`
- Check TEST_MONGO_URI is correct
- Ensure firewall allows connections

**"Test user creation failed":**
- Check TEST_EMAIL and TEST_PASSWORD are set
- Verify JWT_SECRET is set (min 32 chars)
- Check User model password hashing works

**"Tests timeout":**
- Increase Jest timeout in jest.config.js (default: 30s)
- Check MongoDB is responsive
- Verify no hanging connections

**"Port already in use":**
- Tests do NOT start a server listener
- If you see this, check for background processes

## CI/CD Integration

GitHub Actions example:

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mongodb:
        image: mongo:latest
        ports:
          - 27017:27017
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - run: npm ci
      
      - name: Run tests
        env:
          TEST_MONGO_URI: mongodb://localhost:27017/ph4_test
          TEST_EMAIL: test@example.com
          TEST_PASSWORD: Test123456!
          JWT_SECRET: test-secret-key-minimum-32-chars-long
        run: npm run test:ci
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Adding New Tests

1. Create new test file: `tests/my-feature.test.js`

2. Use template:
```javascript
const request = require('supertest');
const { connectTestDB, disconnectTestDB, ensureTestUser } = require('./setup');
const app = require('../src/app');

beforeAll(async () => {
  await connectTestDB();
  await ensureTestUser();
});

afterAll(async () => {
  await disconnectTestDB();
});

describe('My Feature', () => {
  it('should work', async () => {
    const res = await request(app).get('/api/my-endpoint').expect(200);
    expect(res.body).toHaveProperty('success', true);
  });
});
```

3. Run tests: `npm test`

## Best Practices

✅ **Use setup.js utilities** - `ensureTestUser()`, `getTestCredentials()`  
✅ **Clean connections** - Always `disconnectTestDB()` in `afterAll`  
✅ **Test error cases** - 400, 401, 404 responses  
✅ **Use descriptive names** - "should reject invalid email format"  
✅ **Keep tests fast** - Avoid unnecessary DB writes  
✅ **Test behavior, not implementation** - Focus on API contracts
