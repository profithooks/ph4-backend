/**
 * k6 Load Test - Customers & Bills Lists
 * 
 * Tests list endpoints with pagination
 * Step 19: Stability Under Stress
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, getHeaders, THRESHOLDS } from './config.js';

const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    list_load: {
      executor: 'constant-vus',
      vus: __ENV.VUS || 10,
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: THRESHOLDS,
};

export default function () {
  const headers = getHeaders();
  
  // Test 1: List customers
  {
    const res = http.get(`${BASE_URL}/api/customers`, { headers, tags: { endpoint: 'list' } });
    
    const success = check(res, {
      'customers status 200': (r) => r.status === 200,
      'customers has data': (r) => {
        try {
          const data = JSON.parse(r.body);
          return Array.isArray(data) || Array.isArray(data.data);
        } catch {
          return false;
        }
      },
    });
    
    errorRate.add(!success);
  }
  
  sleep(1);
  
  // Test 2: List bills
  {
    const res = http.get(`${BASE_URL}/api/bills`, { headers, tags: { endpoint: 'list' } });
    
    const success = check(res, {
      'bills status 200': (r) => r.status === 200,
      'bills has data': (r) => {
        try {
          const data = JSON.parse(r.body);
          return Array.isArray(data) || Array.isArray(data.data);
        } catch {
          return false;
        }
      },
    });
    
    errorRate.add(!success);
  }
  
  sleep(2);
}
