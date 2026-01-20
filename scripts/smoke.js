/**
 * Smoke Tests
 * 
 * Tests key endpoints to verify app is working
 * Step 15: Release Candidate
 * 
 * Usage: npm run smoke
 * 
 * Env vars:
 *   BASE_URL - API base URL (default: http://localhost:5055)
 *   AUTH_TOKEN - Bearer token for auth (or use DEMO_PHONE/DEMO_PASSWORD)
 */
require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5055';
const AUTH_TOKEN = process.env.AUTH_TOKEN || null;
const DEMO_PHONE = process.env.DEMO_PHONE || '9999999999';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo123';

/**
 * ANSI colors
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

const log = (msg, color = 'reset') => {
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

/**
 * Test results tracker
 */
let passed = 0;
let failed = 0;
let authToken = AUTH_TOKEN;

/**
 * Make API request
 */
async function request(method, endpoint, data = null, skipAuth = false) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {};

  if (!skipAuth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (data) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await axios({
      method,
      url,
      data,
      headers,
      validateStatus: () => true, // Don't throw on any status
    });

    return response;
  } catch (error) {
    return {
      status: 0,
      data: {error: error.message},
    };
  }
}

/**
 * Run a test
 */
async function test(name, fn) {
  try {
    process.stdout.write(`  ${name}... `);
    await fn();
    console.log(`${colors.green}✓${colors.reset}`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset}`);
    log(`    Error: ${error.message}`, 'red');
    failed++;
  }
}

/**
 * Assert response
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Test Suite
 */
async function runTests() {
  log('\n🧪 PH4 Smoke Tests\n', 'blue');
  log(`Base URL: ${BASE_URL}`, 'blue');

  // Group 1: Infrastructure
  log('\n📋 Infrastructure Tests', 'yellow');

  await test('GET /health returns 200', async () => {
    const res = await request('GET', '/health', null, true);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true, 'Expected ok: true');
  });

  await test('GET /ready returns 200', async () => {
    const res = await request('GET', '/ready', null, true);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true || res.data.ready === true, 'Expected ok or ready: true');
  });

  // Group 2: Authentication
  log('\n🔐 Authentication Tests', 'yellow');

  if (!authToken) {
    await test('Login with demo credentials', async () => {
      const res = await request('POST', '/api/auth/login', {
        phone: DEMO_PHONE,
        password: DEMO_PASSWORD,
      }, true);
      
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.token || res.data.data?.token, 'Expected token in response');
      
      authToken = res.data.token || res.data.data?.token;
    });
  } else {
    log('  Using provided AUTH_TOKEN', 'blue');
  }

  // Group 3: Core Features
  log('\n📊 Core Feature Tests', 'yellow');

  await test('GET /api/customers returns list', async () => {
    const res = await request('GET', '/api/customers');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true || Array.isArray(res.data) || Array.isArray(res.data.data), 'Expected customers array');
  });

  // Group 4: Control Features
  log('\n🎛️  Control Feature Tests', 'yellow');

  await test('GET /api/v1/today/summary returns data', async () => {
    const res = await request('GET', '/api/v1/today/summary');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true || res.data.data, 'Expected ok: true or data');
  });

  await test('GET /api/v1/insights/aging returns data', async () => {
    const res = await request('GET', '/api/v1/insights/aging');
    // May return 403 if plan limit, but should not be 500
    assert(res.status === 200 || res.status === 403, `Expected 200 or 403, got ${res.status}`);
    if (res.status === 200) {
      assert(res.data.ok === true || res.data.data, 'Expected ok: true or data');
    }
  });

  await test('GET /api/v1/insights/forecast returns data', async () => {
    const res = await request('GET', '/api/v1/insights/forecast');
    assert(res.status === 200 || res.status === 403, `Expected 200 or 403, got ${res.status}`);
    if (res.status === 200) {
      assert(res.data.ok === true || res.data.data, 'Expected ok: true or data');
    }
  });

  await test('GET /api/v1/audit returns data', async () => {
    const res = await request('GET', '/api/v1/audit');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.ok === true || res.data.data || Array.isArray(res.data), 'Expected audit data');
  });

  await test('POST /api/v1/support/tickets creates ticket', async () => {
    const res = await request('POST', '/api/v1/support/tickets', {
      subject: 'Smoke test ticket',
      message: 'This is an automated smoke test ticket',
      category: 'OTHER',
      priority: 'LOW',
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    assert(res.data.ok === true || res.data.data, 'Expected ok: true or ticket data');
  });

  // Group 5: Spec Compliance (dev only)
  if (process.env.NODE_ENV === 'development' || process.env.ENABLE_DEV_ENDPOINTS === 'true') {
    log('\n🔍 Spec Compliance Tests (Dev Only)', 'yellow');

    await test('GET /api/v1/dev/compliance returns PASS', async () => {
      const res = await request('GET', '/api/v1/dev/compliance');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.data?.compliant === true, 'Expected compliant: true');
      assert(res.data.data?.status === 'PASS', 'Expected status: PASS');
    });
  }

  // Summary
  log('\n' + '='.repeat(50), 'blue');
  if (failed === 0) {
    log(`✅ All tests passed (${passed}/${passed + failed})`, 'green');
    log('='.repeat(50) + '\n', 'blue');
    process.exit(0);
  } else {
    log(`❌ Some tests failed (${passed} passed, ${failed} failed)`, 'red');
    log('='.repeat(50) + '\n', 'blue');
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('\n❌ Smoke tests crashed:', error);
  process.exit(1);
});
