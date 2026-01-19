# Load Testing Guide

This directory contains k6 load tests for the PH4 backend API.

## Quick Start

1. **Install k6:**
   ```bash
   brew install k6  # macOS
   ```

2. **Create test user:**
   ```bash
   # Start the backend server first
   npm run dev
   
   # In another terminal, create test user
   curl -X POST http://localhost:5055/api/auth/signup \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test User",
       "email": "test@example.com",
       "password": "Test123456!"
     }'
   ```

3. **Run tests:**
   ```bash
   # Smoke test (5 min)
   BASE_URL=http://localhost:5055 \
   TEST_EMAIL=test@example.com \
   TEST_PASSWORD=Test123456! \
   npm run load:smoke
   
   # Normal load (10 min)
   BASE_URL=http://localhost:5055 \
   TEST_EMAIL=test@example.com \
   TEST_PASSWORD=Test123456! \
   npm run load:normal
   
   # Stress test (13 min)
   BASE_URL=http://localhost:5055 \
   TEST_EMAIL=test@example.com \
   TEST_PASSWORD=Test123456! \
   npm run load:stress
   ```

## Test Files

| File | Duration | VUs | Purpose |
|------|----------|-----|---------|
| `smoke.test.js` | ~5 min | 2 | Quick validation |
| `load.test.js` | ~10 min | 20 | Normal production load |
| `stress.test.js` | ~13 min | 50 | Edge of capacity |

## Endpoints Tested

All tests authenticate first, then test:

- **Smoke:**
  - `GET /api/health`
  - `GET /api/customers`
  - `GET /api/bills?limit=20`
  - `GET /api/bills/summary`

- **Load & Stress (weighted mix):**
  - 35%: `GET /api/bills?limit=20`
  - 25%: `GET /api/bills/summary`
  - 25%: `GET /api/customers?limit=20`
  - 15%: `GET /api/settings`

## Thresholds

| Test | Error Rate | p95 Latency | Checks |
|------|------------|-------------|--------|
| Smoke | < 1% | < 500ms | > 95% |
| Load | < 1% | < 800ms | > 95% |
| Stress | < 2% | < 1500ms | > 90% |

## Troubleshooting

**"login: status 200" check fails:**
- Verify test user exists (run signup curl command)
- Check credentials match env vars
- Verify backend is running

**High error rate:**
- Check MongoDB is running
- Check server logs for errors
- Verify database has seed data

**High latency:**
- Add database indexes (see models)
- Check system resources (CPU, memory)
- Consider query optimization

**"k6: command not found":**
- Install k6: `brew install k6`

## Environment Variables

Create `.env.loadtest` file:

```bash
BASE_URL=http://localhost:5055
TEST_EMAIL=test@example.com
TEST_PASSWORD=Test123456!
```

Then run:
```bash
source .env.loadtest && npm run load:smoke
```
