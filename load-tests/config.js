/**
 * k6 Load Test Configuration
 * 
 * Step 19: Stability Under Stress
 */

// Base URL from environment or default
export const BASE_URL = __ENV.LOAD_BASE_URL || 'http://localhost:5055';

// Auth token for authenticated requests
export const AUTH_TOKEN = __ENV.LOAD_TOKEN || '';

// Business ID (optional, for targeted tests)
export const BUSINESS_ID = __ENV.LOAD_BUSINESS_ID || '';

// Test thresholds
export const THRESHOLDS = {
  // 95% of requests should be faster than 500ms
  'http_req_duration{endpoint:today}': ['p(95)<500'],
  'http_req_duration{endpoint:insights}': ['p(95)<800'],
  'http_req_duration{endpoint:list}': ['p(95)<300'],
  
  // Error rate should be less than 1%
  'http_req_failed': ['rate<0.01'],
  
  // Success rate should be greater than 99%
  'checks': ['rate>0.99'],
};

// Common headers
export function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : '',
  };
}

// Scenarios for different load levels
export const SCENARIOS = {
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '1m',
  },
  normal: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 5 },   // Ramp up to 5 VUs
      { duration: '3m', target: 10 },  // Stay at 10 VUs
      { duration: '1m', target: 0 },   // Ramp down
    ],
  },
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '2m', target: 20 },   // Ramp up to 20
      { duration: '5m', target: 50 },   // Spike to 50
      { duration: '2m', target: 20 },   // Back down to 20
      { duration: '1m', target: 0 },    // Ramp down
    ],
  },
};
