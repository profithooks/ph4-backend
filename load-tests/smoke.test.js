/**
 * K6 Smoke Test
 * Quick validation that the system works under minimal load
 * Duration: ~3-5 minutes
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const loginErrors = new Counter('login_errors');
const authErrors = new Counter('auth_errors');

// Test configuration
export const options = {
  stages: [
    { duration: '1m', target: 2 },  // Ramp up to 2 users
    { duration: '3m', target: 2 },  // Hold at 2 users
    { duration: '1m', target: 0 },  // Ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],      // Less than 1% errors
    http_req_duration: ['p(95)<500'],    // 95% requests under 500ms
    checks: ['rate>0.95'],               // 95% checks pass
  },
};

// Environment variables
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5055';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'Test123456!';

// Get auth token
function authenticate() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'Login' },
    }
  );

  const loginSuccess = check(loginRes, {
    'login: status 200': (r) => r.status === 200,
    'login: has token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success && body.data && body.data.token;
      } catch (e) {
        return false;
      }
    },
  });

  if (!loginSuccess) {
    loginErrors.add(1);
    console.error(`Login failed: ${loginRes.status} - ${loginRes.body}`);
    return null;
  }

  try {
    const body = JSON.parse(loginRes.body);
    return body.data.token;
  } catch (e) {
    loginErrors.add(1);
    console.error(`Failed to parse login response: ${e.message}`);
    return null;
  }
}

export default function () {
  // 1. Health check (no auth)
  const healthRes = http.get(`${BASE_URL}/api/health`, {
    tags: { name: 'Health' },
  });

  check(healthRes, {
    'health: status 200': (r) => r.status === 200,
    'health: has status field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'OK' || body.status === 'DEGRADED';
      } catch (e) {
        return false;
      }
    },
  });

  // 2. Authenticate
  const token = authenticate();
  if (!token) {
    sleep(1);
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // 3. Get customers
  const customersRes = http.get(
    `${BASE_URL}/api/customers`,
    { headers, tags: { name: 'Customers' } }
  );

  const customersOk = check(customersRes, {
    'customers: status 200': (r) => r.status === 200,
    'customers: is array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.data);
      } catch (e) {
        return false;
      }
    },
  });

  if (!customersOk) {
    authErrors.add(1);
  }

  sleep(1);

  // 4. Get bills
  const billsRes = http.get(
    `${BASE_URL}/api/bills?limit=20`,
    { headers, tags: { name: 'Bills' } }
  );

  const billsOk = check(billsRes, {
    'bills: status 200': (r) => r.status === 200,
    'bills: has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.data);
      } catch (e) {
        return false;
      }
    },
  });

  if (!billsOk) {
    authErrors.add(1);
  }

  sleep(1);

  // 5. Get bills summary
  const summaryRes = http.get(
    `${BASE_URL}/api/bills/summary`,
    { headers, tags: { name: 'BillsSummary' } }
  );

  const summaryOk = check(summaryRes, {
    'summary: status 200': (r) => r.status === 200,
    'summary: has counts': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.data === 'object' && 'totalCount' in body.data;
      } catch (e) {
        return false;
      }
    },
  });

  if (!summaryOk) {
    authErrors.add(1);
  }

  sleep(2);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  
  console.log('\n' + '='.repeat(70));
  console.log('SMOKE TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Requests: ${metrics.http_reqs.values.count}`);
  console.log(`Failed Requests: ${metrics.http_req_failed.values.rate.toFixed(4)} (${(metrics.http_req_failed.values.rate * 100).toFixed(2)}%)`);
  console.log(`Request Duration p95: ${metrics.http_req_duration.values['p(95)'].toFixed(2)}ms`);
  console.log(`Request Duration p99: ${metrics.http_req_duration.values['p(99)'].toFixed(2)}ms`);
  console.log(`Checks Passed: ${(metrics.checks.values.rate * 100).toFixed(2)}%`);
  console.log(`Login Errors: ${metrics.login_errors ? metrics.login_errors.values.count : 0}`);
  console.log(`Auth Errors: ${metrics.auth_errors ? metrics.auth_errors.values.count : 0}`);
  console.log('='.repeat(70));
  
  // Check thresholds
  const failedReqs = metrics.http_req_failed.values.rate;
  const p95Duration = metrics.http_req_duration.values['p(95)'];
  const checksRate = metrics.checks.values.rate;
  
  const thresholdsPassed = 
    failedReqs < 0.01 &&
    p95Duration < 500 &&
    checksRate > 0.95;
  
  console.log(`\nTHRESHOLDS: ${thresholdsPassed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('  - http_req_failed < 1%:', failedReqs < 0.01 ? '✅' : '❌', `(${(failedReqs * 100).toFixed(2)}%)`);
  console.log('  - http_req_duration p95 < 500ms:', p95Duration < 500 ? '✅' : '❌', `(${p95Duration.toFixed(2)}ms)`);
  console.log('  - checks > 95%:', checksRate > 0.95 ? '✅' : '❌', `(${(checksRate * 100).toFixed(2)}%)`);
  console.log('='.repeat(70) + '\n');
  
  return {
    'stdout': '', // Don't output default summary
  };
}
