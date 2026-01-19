# PH4 Backend API

MERN stack backend for PH4 application.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Update environment variables in `.env`:
- `MONGO_URI`: MongoDB connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `PORT`: Server port (default: 5000)

4. Start MongoDB:
```bash
# If using local MongoDB
mongod
```

5. Run server:
```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

## Sentry (Production Error Tracking)

Sentry is configured for production error tracking but is **optional**. The app will run fine without it.

### Setup

1. **Get DSN from Sentry:**
   - Sign up at https://sentry.io (free tier available)
   - Create a project for "Node.js"
   - Copy the DSN from Project Settings → Client Keys

2. **Configure environment variables:**
   ```bash
   # .env
   SENTRY_ENABLED=true
   SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/7890123
   SENTRY_ENVIRONMENT=production
   SENTRY_TRACES_SAMPLE_RATE=0.1
   ```

3. **Install Sentry (optional):**
   ```bash
   npm install @sentry/node
   ```
   
   **Note:** App will run without `@sentry/node` installed. If Sentry is enabled but the package is missing, you'll see a warning and error tracking will be disabled.

### Behavior

- **Production (NODE_ENV=production):** Sentry enabled by default if DSN provided
- **Development:** Sentry disabled by default (set `SENTRY_ENABLED=true` to test)
- **Missing DSN:** App warns but continues running (does NOT crash)
- **PII Protection:** Passwords, tokens, and auth headers automatically scrubbed

### Example Configurations

**Production:**
```bash
NODE_ENV=production
SENTRY_ENABLED=true
SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/7890123
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1  # Monitor 10% of requests
```

**Development (Sentry disabled):**
```bash
NODE_ENV=development
SENTRY_ENABLED=false
# DSN not needed when disabled
```

**Development (Sentry testing):**
```bash
NODE_ENV=development
SENTRY_ENABLED=true
SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/7890123
SENTRY_ENVIRONMENT=development
```

### Verification

Server startup will show:
```
[Sentry] ✅ Initialized successfully
```

Or if disabled:
```
[Sentry] Disabled via SENTRY_ENABLED=false
```

Or if DSN missing:
```
⚠️  SENTRY WARNING
SENTRY_ENABLED is true but SENTRY_DSN is not configured.
Error tracking will NOT work in production.
```

---

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login user

### Customers
- `GET /api/customers` - Get all customers
- `POST /api/customers` - Create customer
- `PUT /api/customers/:id` - Update customer

### Ledger
- `GET /api/ledger/:customerId` - Get transactions
- `POST /api/ledger/credit` - Add credit transaction
- `POST /api/ledger/debit` - Add debit transaction

### Recovery
- `GET /api/recovery/:customerId` - Get recovery case
- `POST /api/recovery/open` - Open recovery case
- `POST /api/recovery/promise` - Set promise date
- `POST /api/recovery/status` - Update case status

### Follow-up
- `GET /api/followups/:customerId` - Get follow-up tasks
- `POST /api/followups` - Create follow-up task

## Architecture

Single-tenant system where one user owns all customers, transactions, cases, and tasks.

All endpoints except `/api/auth/*` require JWT authentication via Bearer token in Authorization header.

---

## Tests

Integration tests are implemented using Jest and Supertest to prevent regressions in core flows.

### Prerequisites

Tests require a MongoDB instance for integration testing. You can use:
- Local MongoDB: `mongodb://localhost:27017/ph4_test`
- Docker: `docker run -d -p 27017:27017 mongo:latest`
- MongoDB Atlas: Use a dedicated test database

### Running Tests

**Install test dependencies first:**
```bash
npm install
```

**Run all tests:**
```bash
TEST_MONGO_URI=mongodb://localhost:27017/ph4_test \
TEST_EMAIL=test@example.com \
TEST_PASSWORD=Test123456! \
npm test
```

**Run tests in watch mode (development):**
```bash
TEST_MONGO_URI=mongodb://localhost:27017/ph4_test \
TEST_EMAIL=test@example.com \
TEST_PASSWORD=Test123456! \
npm run test:watch
```

**Run tests in CI mode:**
```bash
TEST_MONGO_URI=mongodb://localhost:27017/ph4_test \
TEST_EMAIL=test@example.com \
TEST_PASSWORD=Test123456! \
npm run test:ci
```

### Environment Variables for Tests

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `TEST_MONGO_URI` | Yes | MongoDB connection string for testing | `mongodb://localhost:27017/ph4_test` |
| `TEST_EMAIL` | Yes | Email for test user | `test@example.com` |
| `TEST_PASSWORD` | Yes | Password for test user | `Test123456!` |
| `NODE_ENV` | Auto | Set to `test` automatically | `test` |

### Test Coverage

**Current test coverage:**

| Module | Coverage |
|--------|----------|
| Health endpoints | ✅ 100% |
| Authentication (login/signup) | ✅ 100% |
| Bills endpoints (GET, auth check) | ✅ 80% |
| Bills summary | ✅ 100% |
| Input validation (Joi) | ✅ 60% |
| ObjectId validation | ✅ 100% |

**What is tested:**
- ✅ Health endpoint returns correct structure
- ✅ User login with valid/invalid credentials
- ✅ User signup with validation
- ✅ Bills list requires authentication
- ✅ Bills summary requires authentication
- ✅ Bills filtering and pagination
- ✅ Joi validation for POST/PUT requests
- ✅ ObjectId validation middleware
- ✅ Error response formats (400, 401, 404)

**What is NOT tested:**
- ⚠️ Bill creation (requires customer setup)
- ⚠️ Payment workflows
- ⚠️ Recovery and follow-up flows
- ⚠️ Message delivery cron
- ⚠️ Full CRUD operations (focus is on GET + auth)

**Note:** Tests use the real database (not mocked). The test user is created automatically if it doesn't exist.

### Test Structure

```
tests/
├── setup.js              # Database connection & utilities
├── health.test.js        # Health endpoint tests
├── auth.test.js          # Authentication tests
├── bills.test.js         # Bills endpoint tests
└── validation.test.js    # Input validation tests
```

### Writing New Tests

Example test file:

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
  it('should work correctly', async () => {
    const res = await request(app)
      .get('/api/my-endpoint')
      .expect(200);
    
    expect(res.body).toHaveProperty('success', true);
  });
});
```

### Continuous Integration

Add to CI/CD pipeline:

```yaml
# .github/workflows/test.yml
- name: Run Tests
  env:
    TEST_MONGO_URI: ${{ secrets.TEST_MONGO_URI }}
    TEST_EMAIL: test@example.com
    TEST_PASSWORD: Test123456!
  run: npm run test:ci
```

---

## Load Testing

Load tests are implemented using [k6](https://k6.io/) to validate system performance under different load conditions.

### Prerequisites

Install k6:
```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6
```

### Test Configuration

All tests require environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `BASE_URL` | Backend API URL | `http://localhost:5055` |
| `TEST_EMAIL` | Test user email | `test@example.com` |
| `TEST_PASSWORD` | Test user password | `Test123456!` |

**Important:** Create a test user before running load tests:
```bash
curl -X POST http://localhost:5055/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "Test123456!"
  }'
```

### Available Tests

#### 1. Smoke Test (3-5 minutes)

Quick validation that the system works under minimal load.

**Load Profile:**
- 2 virtual users
- Duration: ~5 minutes
- Ramp up: 1 min, Hold: 3 min, Ramp down: 1 min

**Endpoints Tested:**
- `GET /api/health` (no auth)
- `GET /api/customers`
- `GET /api/bills?limit=20`
- `GET /api/bills/summary`

**Thresholds:**
- Error rate: < 1%
- p95 response time: < 500ms
- Checks pass rate: > 95%

**Run:**
```bash
BASE_URL=http://localhost:5055 \
TEST_EMAIL=test@example.com \
TEST_PASSWORD=Test123456! \
npm run load:smoke
```

---

#### 2. Normal Load Test (10 minutes)

Tests system behavior under typical production load.

**Load Profile:**
- 20 virtual users
- Duration: ~10 minutes
- Ramp up: 2 min, Hold: 6 min, Ramp down: 2 min

**Endpoints Tested (weighted mix):**
- 35%: `GET /api/bills?limit=20`
- 25%: `GET /api/bills/summary`
- 25%: `GET /api/customers?limit=20`
- 15%: `GET /api/settings`

**Thresholds:**
- Error rate: < 1%
- p95 response time: < 800ms
- Checks pass rate: > 95%

**Run:**
```bash
BASE_URL=http://localhost:5055 \
TEST_EMAIL=test@example.com \
TEST_PASSWORD=Test123456! \
npm run load:normal
```

---

#### 3. Stress Test (13 minutes)

Tests system behavior at the edge of capacity.

**Load Profile:**
- 50 virtual users
- Duration: ~13 minutes
- Ramp up: 3 min, Hold: 7 min, Ramp down: 3 min

**Endpoints Tested:**
- Same weighted mix as normal load test

**Thresholds (relaxed for stress):**
- Error rate: < 2%
- p95 response time: < 1500ms
- Checks pass rate: > 90%

**Run:**
```bash
BASE_URL=http://localhost:5055 \
TEST_EMAIL=test@example.com \
TEST_PASSWORD=Test123456! \
npm run load:stress
```

---

### Running in Staging/Production

**Staging Example:**
```bash
BASE_URL=https://staging-api.profithooks.com \
TEST_EMAIL=loadtest@profithooks.com \
TEST_PASSWORD=SecureStaging123! \
npm run load:smoke
```

**Production (with caution):**
```bash
# Only run smoke test in production, and only during low-traffic periods
BASE_URL=https://api.profithooks.com \
TEST_EMAIL=production-monitor@profithooks.com \
TEST_PASSWORD=SecureProduction456! \
npm run load:smoke
```

**⚠️ Warning:** Do NOT run stress tests against production. Use staging environment.

---

### Interpreting Results

Each test outputs a summary at the end:

```
======================================================================
SMOKE TEST SUMMARY
======================================================================
Total Requests: 487
Failed Requests: 0.0000 (0.00%)
Request Duration p95: 234.56ms
Request Duration p99: 345.67ms
Checks Passed: 100.00%
Login Errors: 0
Auth Errors: 0
======================================================================

THRESHOLDS: ✅ PASSED
  - http_req_failed < 1%: ✅ (0.00%)
  - http_req_duration p95 < 500ms: ✅ (234.56ms)
  - checks > 95%: ✅ (100.00%)
======================================================================
```

**Key Metrics:**
- **Failed Requests:** Should be near 0%
- **p95 Duration:** 95% of requests complete within this time
- **p99 Duration:** 99% of requests complete within this time
- **Checks Passed:** Validation checks (status codes, response format)
- **Login/Auth Errors:** Authentication failures

**When Tests Fail:**
1. Check MongoDB is running and accessible
2. Verify test user exists and credentials are correct
3. Check server logs for errors
4. Verify network connectivity
5. Consider increasing thresholds if system is resource-constrained

---

### Performance Optimization

If tests fail thresholds, consider:

1. **Database Indexes:** Ensure all frequently-queried fields are indexed
2. **Query Optimization:** Use `.lean()` for read-only queries, limit populated fields
3. **Caching:** Add Redis for frequently-accessed data
4. **Connection Pooling:** Increase MongoDB connection pool size
5. **Server Resources:** Scale vertically (more CPU/RAM) or horizontally (more instances)
6. **Rate Limiting:** Verify rate limits aren't too aggressive for load tests

---

### Continuous Integration

Add to CI/CD pipeline:

```yaml
# .github/workflows/load-test.yml
- name: Run Smoke Test
  run: |
    BASE_URL=${{ secrets.STAGING_URL }} \
    TEST_EMAIL=${{ secrets.TEST_EMAIL }} \
    TEST_PASSWORD=${{ secrets.TEST_PASSWORD }} \
    npm run load:smoke
```

---

## 🚀 Production Deployment to Render

### Prerequisites

1. **MongoDB Atlas** (free tier available)
   - Sign up at https://cloud.mongodb.com
   - Create a cluster (M0 free tier is sufficient)
   
2. **GitHub Account**
   - Create a new repository for this backend

3. **Render Account** (free tier available)
   - Sign up at https://render.com

---

### Step 1: Prepare MongoDB Atlas

1. **Create Cluster:**
   - Go to https://cloud.mongodb.com
   - Click "Build a Database" → Select "M0 Free" tier
   - Choose region closest to your Render deployment (e.g., Singapore)

2. **Create Database User:**
   - Go to "Database Access" → "Add New Database User"
   - Create username and strong password
   - Set role: "Read and write to any database"
   - **Save credentials** (you'll need them for connection string)

3. **Configure Network Access:**
   - Go to "Network Access" → "Add IP Address"
   - Option A: Click "Allow Access from Anywhere" (0.0.0.0/0) - easiest for Render
   - Option B: Add Render's IP ranges manually (see Render docs)

4. **Get Connection String:**
   - Go to "Database" → Click "Connect" on your cluster
   - Choose "Drivers" → Node.js
   - Copy connection string, it looks like:
     ```
     mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
     ```
   - Replace `<username>` and `<password>` with your actual credentials
   - Add database name before the `?`: `.../profithooks-db?retryWrites=...`

---

### Step 2: Generate Production Secrets

Generate a strong JWT secret:

```bash
openssl rand -base64 48
```

**Save this output** - you'll use it as `JWT_SECRET` in Render.

---

### Step 3: Push Backend to GitHub

```bash
# Navigate to backend folder
cd /Users/naved/Desktop/ph4-backend

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Production-ready backend for PH4"

# Create main branch
git branch -M main

# Add your GitHub repository as remote
# Replace YOUR_USERNAME and YOUR_REPO with your actual GitHub username and repo name
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Push to GitHub
git push -u origin main
```

**IMPORTANT:** Verify `.gitignore` is working - `.env` file should NOT be pushed to GitHub!

---

### Step 4: Deploy to Render

#### Option A: Using render.yaml (Automatic - Recommended)

1. Go to https://dashboard.render.com
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repository
4. Render will auto-detect `render.yaml` and configure everything
5. Click **"Apply"** to create the service
6. Skip to Step 5 to add secret environment variables

#### Option B: Manual Setup

1. Go to https://dashboard.render.com
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository containing this backend
4. Configure:
   - **Name:** `ph4-backend` (or your preferred name)
   - **Region:** Singapore (or closest to your users)
   - **Branch:** `main`
   - **Root Directory:** (leave blank)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (or select paid plan)
5. Click **"Create Web Service"** (don't click "Deploy" yet)

---

### Step 5: Configure Environment Variables

In Render dashboard → Your service → **Environment** tab:

Click **"Add Environment Variable"** and add these:

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | **Required** |
| `MONGO_URI` | `mongodb+srv://...` | **Required** - Paste your MongoDB Atlas connection string |
| `JWT_SECRET` | (from Step 2) | **Required** - The 48-char secret you generated |
| `JWT_EXPIRE` | `7d` | Optional (default: 7d) |
| `TRUST_PROXY` | `true` | **Required** for Render |
| `CORS_ORIGINS` | `https://yourapp.com` | **Required** - Your frontend URL(s), comma-separated, no spaces |
| `CORS_CREDENTIALS` | `true` | Optional (default: false) |
| `SENTRY_ENABLED` | `true` | Optional (for error tracking) |
| `SENTRY_DSN` | (from sentry.io) | Optional - Only if using Sentry |
| `SENTRY_ENVIRONMENT` | `production` | Optional |
| `LOG_LEVEL` | `info` | Optional (default: info) |

**Example CORS_ORIGINS:**
```
https://yourapp.com,https://www.yourapp.com,https://app.yourapp.com
```

---

### Step 6: Deploy!

1. After adding all environment variables, click **"Save Changes"**
2. Render will automatically trigger a deployment
3. Wait 2-5 minutes for build and deployment to complete
4. You'll see logs in real-time

---

### Step 7: Verify Deployment

Your API will be live at: `https://ph4-backend.onrender.com` (or your chosen name)

**Test the health endpoint:**

```bash
curl https://ph4-backend.onrender.com/api/health
```

**Expected response:**
```json
{
  "status": "OK",
  "timestamp": "2026-01-19T...",
  "uptime": 123,
  "environment": "production",
  "services": {
    "mongodb": "connected"
  }
}
```

If you see `"mongodb": "connected"`, **congratulations!** 🎉 Your backend is live!

---

### Step 8: Update Frontend

Update your React Native app's API base URL:

```javascript
// In your frontend .env or config
API_BASE_URL=https://ph4-backend.onrender.com
```

---

## 🔄 Auto-Deploy on Git Push

Render automatically redeploys your backend whenever you push to the `main` branch:

```bash
# Make changes to your backend
git add .
git commit -m "Update backend"
git push origin main

# Render will auto-detect and deploy in ~2-5 minutes
```

---

## 🐛 Troubleshooting

### Issue: "mongodb": "failed"

**Cause:** MongoDB connection string is incorrect or network access not configured.

**Fix:**
1. Verify `MONGO_URI` in Render environment variables
2. Check MongoDB Atlas Network Access allows Render (0.0.0.0/0)
3. Verify username/password are correct in connection string
4. Ensure database name is included: `.../profithooks-db?retryWrites=...`

### Issue: Server not starting

**Cause:** Missing required environment variables.

**Fix:**
1. Check Render logs for error message
2. Verify `NODE_ENV=production` is set
3. Verify `JWT_SECRET` is at least 32 characters
4. Verify `MONGO_URI` is set

### Issue: CORS errors from frontend

**Cause:** Frontend domain not in CORS_ORIGINS.

**Fix:**
1. Add your frontend URL to `CORS_ORIGINS` in Render
2. Ensure no spaces in the comma-separated list
3. Include protocol: `https://yourapp.com` not `yourapp.com`
4. Redeploy if needed

### Issue: Rate limiting not working

**Cause:** `TRUST_PROXY` not set to `true`.

**Fix:**
1. Set `TRUST_PROXY=true` in Render environment variables
2. Redeploy

---

## 📊 Monitoring

### View Logs

Render dashboard → Your service → **Logs** tab

Real-time logs show:
- All Winston logs (JSON format)
- Request logs with UIDs
- Error traces (if Sentry not configured)

### Sentry Integration (Optional)

For better error tracking:

1. Sign up at https://sentry.io (free tier available)
2. Create a Node.js project
3. Copy DSN from Project Settings → Client Keys
4. Add to Render environment variables:
   - `SENTRY_ENABLED=true`
   - `SENTRY_DSN=https://...`
5. Redeploy

Sentry will capture:
- Unhandled errors
- API errors (500s)
- Performance metrics (if `SENTRY_TRACES_SAMPLE_RATE > 0`)

---

## 🔐 Security Best Practices

1. **Never commit `.env` to git** ✅ Already in `.gitignore`
2. **Use strong JWT_SECRET** ✅ At least 48 characters (generated with `openssl rand -base64 48`)
3. **Restrict CORS origins** ✅ Only add your actual frontend domains
4. **Keep dependencies updated** → Run `npm audit` and `npm update` regularly
5. **Monitor logs** → Check Render logs or Sentry for suspicious activity
6. **Use MongoDB Atlas IP whitelist** (optional) → More secure than 0.0.0.0/0

---

## 📈 Scaling

### Free Tier Limitations

Render's free tier:
- ✅ 750 hours/month (enough for 1 service 24/7)
- ✅ Auto-sleep after 15 min inactivity (first request takes ~30s to wake)
- ✅ 512 MB RAM
- ⚠️ Shared CPU

### Upgrade to Paid Plan

When your app grows:
1. Go to Render dashboard → Your service → **Settings**
2. Change plan to **Starter ($7/month)** or higher
3. Benefits:
   - No auto-sleep
   - Dedicated CPU
   - More RAM
   - Priority support

---

## ✅ Production Readiness Checklist

Before going live:

- [ ] MongoDB Atlas cluster created and accessible
- [ ] Strong JWT_SECRET generated (48+ chars)
- [ ] All required env vars set in Render
- [ ] Health endpoint returns 200 OK
- [ ] CORS configured for frontend domain
- [ ] Sentry configured (optional but recommended)
- [ ] Frontend updated with production API URL
- [ ] Test key user flows (signup, login, create bill, etc.)
- [ ] Monitor logs for 24 hours after launch
- [ ] Set up alerts (Sentry or Render email notifications)

---

## 🆘 Support

If you encounter issues:

1. **Check Render logs** for error messages
2. **Verify environment variables** match `.env.production.example`
3. **Test MongoDB connection** using MongoDB Compass or mongosh
4. **Review this README** troubleshooting section
5. **Contact Render support** (free tier has community support)

---

**Your backend is now production-ready and live on Render!** 🚀

Next step: Deploy your React Native frontend and connect it to this API.

