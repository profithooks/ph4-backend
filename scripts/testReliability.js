/**
 * Reliability Implementation Test Script
 * 
 * Tests request ID, envelope format, and error logging
 * Usage: node scripts/testReliability.js
 */

const axios = require('axios');
const {v4: uuidv4} = require('uuid');

const BASE_URL = process.env.API_URL || 'http://localhost:5055';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || '';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = {
  success: msg => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  error: msg => console.log(`${colors.red}✗ ${msg}${colors.reset}`),
  info: msg => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
  warn: msg => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
};

/**
 * Test 1: Request ID is generated and returned
 */
async function testRequestId() {
  log.info('Test 1: Request ID Generation');
  
  try {
    const requestId = uuidv4();
    const response = await axios.get(`${BASE_URL}/api/health`, {
      headers: {
        'X-Request-Id': requestId,
      },
    });
    
    // Check response header
    const returnedRequestId = response.headers['x-request-id'];
    if (returnedRequestId === requestId) {
      log.success('Request ID preserved in response header');
    } else if (returnedRequestId) {
      log.warn(`Request ID changed: sent=${requestId}, received=${returnedRequestId}`);
    } else {
      log.error('No Request ID in response header');
      return false;
    }
    
    return true;
  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: Success responses use envelope format
 */
async function testSuccessEnvelope() {
  log.info('Test 2: Success Response Envelope');
  
  try {
    const response = await axios.get(`${BASE_URL}/api/health`);
    const data = response.data;
    
    // Check for envelope fields
    if (typeof data.ok === 'boolean' && data.ok === true) {
      log.success('Response has envelope format (ok: true)');
    } else if (data.success === true) {
      log.warn('Response uses legacy format (success: true)');
      log.info('This is expected for non-migrated endpoints');
    } else {
      log.error('Response missing ok/success field');
      return false;
    }
    
    if (data.requestId) {
      log.success(`Response includes requestId: ${data.requestId}`);
    } else {
      log.warn('Response missing requestId (legacy endpoint)');
    }
    
    return true;
  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: Error responses use envelope format
 */
async function testErrorEnvelope() {
  log.info('Test 3: Error Response Envelope');
  
  try {
    // Try to access a route that doesn't exist
    await axios.get(`${BASE_URL}/api/nonexistent-route-test-12345`);
    log.warn('Expected 404 error but request succeeded');
    return false;
  } catch (error) {
    if (!error.response) {
      log.error('No response from server');
      return false;
    }
    
    const data = error.response.data;
    
    // Check envelope format
    if (data.ok === false) {
      log.success('Error response has envelope format (ok: false)');
    } else if (data.success === false) {
      log.warn('Error response uses legacy format (success: false)');
    } else {
      log.error('Error response missing ok/success field');
      return false;
    }
    
    if (data.requestId) {
      log.success(`Error response includes requestId: ${data.requestId}`);
    } else {
      log.warn('Error response missing requestId');
    }
    
    if (data.error) {
      log.success('Error response has error object');
      if (data.error.code) {
        log.success(`Error code: ${data.error.code}`);
      }
      if (typeof data.error.retryable === 'boolean') {
        log.success(`Retryable flag: ${data.error.retryable}`);
      } else {
        log.warn('Error missing retryable flag');
      }
    } else {
      log.warn('Error response missing error object (legacy format)');
    }
    
    return true;
  }
}

/**
 * Test 4: Diagnostics API (requires auth)
 */
async function testDiagnosticsAPI() {
  log.info('Test 4: Diagnostics API');
  
  if (!AUTH_TOKEN) {
    log.warn('Skipping (no AUTH_TOKEN set)');
    log.info('Set TEST_AUTH_TOKEN env var to test diagnostics API');
    return true; // Not a failure, just skipped
  }
  
  try {
    const response = await axios.get(
      `${BASE_URL}/api/v1/diagnostics/reliability?limit=5`,
      {
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
      },
    );
    
    const data = response.data;
    
    if (data.ok === true || data.success === true) {
      log.success('Diagnostics API accessible');
    } else {
      log.error('Unexpected response format');
      return false;
    }
    
    const events = data.data?.events || data.events || [];
    log.success(`Retrieved ${events.length} reliability events`);
    
    if (events.length > 0) {
      const event = events[0];
      log.info('Sample event:');
      log.info(`  - Kind: ${event.kind}`);
      log.info(`  - Code: ${event.code}`);
      log.info(`  - Message: ${event.message}`);
      log.info(`  - RequestId: ${event.requestId}`);
    }
    
    return true;
  } catch (error) {
    if (error.response?.status === 401) {
      log.error('Authentication failed (invalid token)');
    } else {
      log.error(`Test failed: ${error.message}`);
    }
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  Reliability Implementation Tests');
  console.log('='.repeat(60) + '\n');
  
  log.info(`Testing API at: ${BASE_URL}`);
  console.log();
  
  const results = [];
  
  results.push(await testRequestId());
  console.log();
  
  results.push(await testSuccessEnvelope());
  console.log();
  
  results.push(await testErrorEnvelope());
  console.log();
  
  results.push(await testDiagnosticsAPI());
  console.log();
  
  // Summary
  console.log('='.repeat(60));
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  if (passed === total) {
    log.success(`All ${total} tests passed!`);
  } else {
    log.warn(`${passed}/${total} tests passed`);
  }
  console.log('='.repeat(60) + '\n');
  
  process.exit(passed === total ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
