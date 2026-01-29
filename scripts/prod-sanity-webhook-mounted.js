#!/usr/bin/env node
/**
 * Smoke Test: Webhook Endpoint Mounted
 * 
 * Verifies that POST /webhooks/razorpay is correctly mounted and reachable.
 * 
 * Expected behavior:
 * - Endpoint exists (NOT 404)
 * - Returns 400 or 401 with signature validation error (NOT 404/500)
 * 
 * Usage:
 *   node scripts/prod-sanity-webhook-mounted.js
 * 
 * Exit codes:
 *   0 - PASS (endpoint mounted correctly)
 *   1 - FAIL (endpoint not mounted or unexpected error)
 */

const http = require('http');

// Configuration
const HOST = process.env.TEST_HOST || 'localhost';
const PORT = process.env.PORT || 5055;
const WEBHOOK_PATH = '/webhooks/razorpay';

/**
 * Make HTTP POST request
 */
function makeRequest(host, port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    
    const options = {
      hostname: host,
      port: port,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        // Intentionally missing X-Razorpay-Signature header
      },
    };
    
    const req = http.request(options, (res) => {
      let responseBody = '';
      
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: responseBody,
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(data);
    req.end();
  });
}

/**
 * Run smoke test
 */
async function runTest() {
  console.log('===========================================');
  console.log('Smoke Test: Webhook Endpoint Mounted');
  console.log('===========================================');
  console.log(`Target: http://${HOST}:${PORT}${WEBHOOK_PATH}`);
  console.log('');
  
  try {
    // Step 1: Send dummy webhook payload (no signature)
    console.log('[Test] Sending POST request with dummy payload (no signature)...');
    
    const dummyPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_123',
            order_id: 'order_test_123',
            amount: 29900,
            currency: 'INR',
            status: 'captured',
            notes: {
              userId: '507f1f77bcf86cd799439011',
              planId: 'ph4_pro_monthly',
            },
          },
        },
      },
    };
    
    const response = await makeRequest(HOST, PORT, WEBHOOK_PATH, dummyPayload);
    
    console.log('[Test] Response received:');
    console.log(`  Status: ${response.statusCode} ${response.statusMessage}`);
    console.log(`  Body: ${response.body}`);
    console.log('');
    
    // Step 2: Validate response
    let testResult = 'FAIL';
    let reason = '';
    
    if (response.statusCode === 404) {
      reason = 'Endpoint NOT mounted (404 Not Found)';
    } else if (response.statusCode === 500) {
      reason = 'Server error (500) - check server logs';
    } else if (response.statusCode === 400 || response.statusCode === 401) {
      // Expected: signature missing or invalid
      try {
        const responseData = JSON.parse(response.body);
        const message = responseData.message || '';
        
        if (
          message.includes('signature') ||
          message.includes('Missing signature') ||
          message.includes('Invalid signature')
        ) {
          testResult = 'PASS';
          reason = 'Endpoint mounted correctly, signature validation working';
        } else {
          reason = `Unexpected error message: ${message}`;
        }
      } catch (e) {
        reason = `Could not parse response JSON: ${response.body}`;
      }
    } else {
      reason = `Unexpected status code: ${response.statusCode}`;
    }
    
    // Step 3: Print result
    console.log('===========================================');
    console.log(`Result: ${testResult}`);
    console.log(`Reason: ${reason}`);
    console.log('===========================================');
    
    if (testResult === 'PASS') {
      console.log('✅ Webhook endpoint is correctly mounted');
      console.log('');
      console.log('Next steps:');
      console.log('1. Set RAZORPAY_WEBHOOK_SECRET in .env');
      console.log('2. Configure webhook URL in Razorpay dashboard');
      console.log('3. Test with real Razorpay webhook payload');
      process.exit(0);
    } else {
      console.log('❌ Webhook endpoint test failed');
      console.log('');
      console.log('Troubleshooting:');
      console.log('1. Ensure server is running: npm start');
      console.log('2. Check server logs for errors');
      console.log('3. Verify webhook routes are mounted in src/app.js');
      console.log('4. Check PORT environment variable');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error.message);
    console.error('');
    console.error('Possible causes:');
    console.error('- Server is not running');
    console.error('- Incorrect HOST or PORT');
    console.error('- Network connectivity issue');
    process.exit(1);
  }
}

// Run test
runTest();
