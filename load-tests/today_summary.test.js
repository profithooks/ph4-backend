/**
 * k6 Load Test - Today Summary & Chase List
 * 
 * Tests the hottest endpoints: /today/summary and /today/chase
 * Step 19: Stability Under Stress
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, getHeaders, THRESHOLDS } from './config.js';

// Custom metrics
const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    today_load: {
      executor: 'constant-vus',
      vus: __ENV.VUS || 10,
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: THRESHOLDS,
};

export default function () {
  const headers = getHeaders();
  
  // Test 1: Get today summary
  {
    const res = http.get(`${BASE_URL}/api/v1/today/summary`, { headers, tags: { endpoint: 'today' } });
    
    const success = check(res, {
      'today summary status 200': (r) => r.status === 200,
      'today summary has ok': (r) => {
        try {
          return JSON.parse(r.body).ok === true;
        } catch {
          return false;
        }
      },
      'today summary has moneyAtRisk': (r) => {
        try {
          return JSON.parse(r.body).data.moneyAtRisk !== undefined;
        } catch {
          return false;
        }
      },
    });
    
    errorRate.add(!success);
  }
  
  sleep(1);
  
  // Test 2: Get chase list
  {
    const res = http.get(`${BASE_URL}/api/v1/today/chase?limit=50`, { headers, tags: { endpoint: 'today' } });
    
    const success = check(res, {
      'chase list status 200': (r) => r.status === 200,
      'chase list has ok': (r) => {
        try {
          return JSON.parse(r.body).ok === true;
        } catch {
          return false;
        }
      },
      'chase list has items': (r) => {
        try {
          return JSON.parse(r.body).data.chaseItems !== undefined;
        } catch {
          return false;
        }
      },
    });
    
    errorRate.add(!success);
  }
  
  sleep(2);
}
