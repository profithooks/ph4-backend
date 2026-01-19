/**
 * K6 Normal Load Test
 * Tests system behavior under typical production load
 * Duration: ~10 minutes
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

// Custom metrics
const loginErrors = new Counter('login_errors');
const authErrors = new Counter('auth_errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 20 },  // Ramp up to 20 users
    { duration: '6m', target: 20 },  // Hold at 20 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],      // Less than 1% errors
    http_req_duration: ['p(95)<800'],    // 95% requests under 800ms
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
    return null;
  }

  try {
    const body = JSON.parse(loginRes.body);
    return body.data.token;
  } catch (e) {
    loginErrors.add(1);
    return null;
  }
}

export default function () {
  // Authenticate once per iteration
  const token = authenticate();
  if (!token) {
    sleep(2);
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // Weighted endpoint mix (100% total)
  const rand = Math.random();

  if (rand < 0.35) {
    // 35%: Get bills list
    const billsRes = http.get(
      `${BASE_URL}/api/bills?limit=20`,
      { headers, tags: { name: 'BillsList' } }
    );

    const ok = check(billsRes, {
      'bills list: status 200': (r) => r.status === 200,
      'bills list: has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data);
        } catch (e) {
          return false;
        }
      },
    });

    if (!ok) authErrors.add(1);
    
  } else if (rand < 0.60) {
    // 25%: Get bills summary
    const summaryRes = http.get(
      `${BASE_URL}/api/bills/summary`,
      { headers, tags: { name: 'BillsSummary' } }
    );

    const ok = check(summaryRes, {
      'bills summary: status 200': (r) => r.status === 200,
      'bills summary: has counts': (r) => {
        try {
          const body = JSON.parse(r.body);
          return typeof body.data === 'object';
        } catch (e) {
          return false;
        }
      },
    });

    if (!ok) authErrors.add(1);
    
  } else if (rand < 0.85) {
    // 25%: Get customers list
    const customersRes = http.get(
      `${BASE_URL}/api/customers?limit=20`,
      { headers, tags: { name: 'CustomersList' } }
    );

    const ok = check(customersRes, {
      'customers list: status 200': (r) => r.status === 200,
      'customers list: has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data);
        } catch (e) {
          return false;
        }
      },
    });

    if (!ok) authErrors.add(1);
    
  } else {
    // 15%: Get settings (lightweight)
    const settingsRes = http.get(
      `${BASE_URL}/api/settings`,
      { headers, tags: { name: 'Settings' } }
    );

    const ok = check(settingsRes, {
      'settings: status 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    if (!ok && settingsRes.status !== 404) authErrors.add(1);
  }

  // Realistic think time between requests
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

export function handleSummary(data) {
  const metrics = data.metrics;
  
  console.log('\n' + '='.repeat(70));
  console.log('NORMAL LOAD TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Requests: ${metrics.http_reqs.values.count}`);
  console.log(`Failed Requests: ${metrics.http_req_failed.values.rate.toFixed(4)} (${(metrics.http_req_failed.values.rate * 100).toFixed(2)}%)`);
  console.log(`Request Duration p95: ${metrics.http_req_duration.values['p(95)'].toFixed(2)}ms`);
  console.log(`Request Duration p99: ${metrics.http_req_duration.values['p(99)'].toFixed(2)}ms`);
  console.log(`Request Duration median: ${metrics.http_req_duration.values['p(50)'].toFixed(2)}ms`);
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
    p95Duration < 800 &&
    checksRate > 0.95;
  
  console.log(`\nTHRESHOLDS: ${thresholdsPassed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('  - http_req_failed < 1%:', failedReqs < 0.01 ? '✅' : '❌', `(${(failedReqs * 100).toFixed(2)}%)`);
  console.log('  - http_req_duration p95 < 800ms:', p95Duration < 800 ? '✅' : '❌', `(${p95Duration.toFixed(2)}ms)`);
  console.log('  - checks > 95%:', checksRate > 0.95 ? '✅' : '❌', `(${(checksRate * 100).toFixed(2)}%)`);
  console.log('='.repeat(70) + '\n');
  
  return {
    'stdout': '',
  };
}
