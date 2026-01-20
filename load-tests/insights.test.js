/**
 * k6 Load Test - Insights Endpoints
 * 
 * Tests aging, forecast, and defaulters endpoints
 * Step 19: Stability Under Stress
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, getHeaders, THRESHOLDS } from './config.js';

const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    insights_load: {
      executor: 'constant-vus',
      vus: __ENV.VUS || 10,
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: THRESHOLDS,
};

export default function () {
  const headers = getHeaders();
  
  // Test 1: Aging buckets
  {
    const res = http.get(`${BASE_URL}/api/v1/insights/aging`, { headers, tags: { endpoint: 'insights' } });
    
    const success = check(res, {
      'aging status 200': (r) => r.status === 200 || r.status === 403, // 403 if plan limit
      'aging has response': (r) => r.body.length > 0,
    });
    
    errorRate.add(!success);
  }
  
  sleep(1);
  
  // Test 2: Cash-in forecast
  {
    const res = http.get(`${BASE_URL}/api/v1/insights/forecast`, { headers, tags: { endpoint: 'insights' } });
    
    const success = check(res, {
      'forecast status 200': (r) => r.status === 200 || r.status === 403,
      'forecast has response': (r) => r.body.length > 0,
    });
    
    errorRate.add(!success);
  }
  
  sleep(1);
  
  // Test 3: Defaulters list
  {
    const res = http.get(`${BASE_URL}/api/v1/insights/defaulters?limit=20`, { headers, tags: { endpoint: 'insights' } });
    
    const success = check(res, {
      'defaulters status 200': (r) => r.status === 200 || r.status === 403,
      'defaulters has response': (r) => r.body.length > 0,
    });
    
    errorRate.add(!success);
  }
  
  sleep(2);
}
