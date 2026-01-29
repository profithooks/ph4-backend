#!/usr/bin/env node
/**
 * Test: Webhook Charset Handling
 * 
 * Tests that webhook endpoint handles various Content-Type variations:
 * - application/json
 * - application/json; charset=utf-8
 * - application/json; charset=UTF-8
 * 
 * Verifies raw body middleware accepts all variants.
 * 
 * Usage:
 *   node scripts/test-webhook-charset.js
 */

const http = require('http');

// Configuration
const HOST = process.env.TEST_HOST || 'localhost';
const PORT = process.env.PORT || 5055;
const WEBHOOK_PATH = '/webhooks/razorpay';

// Test payload
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
      },
    },
  },
};

/**
 * Make HTTP POST request with specific Content-Type
 */
function makeRequest(contentType) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(dummyPayload);
    
    const options = {
      hostname: HOST,
      port: PORT,
      path: WEBHOOK_PATH,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
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
 * Test a single Content-Type variant
 */
async function testContentType(contentType) {
  console.log(`\n📝 Testing: ${contentType}`);
  
  try {
    const response = await makeRequest(contentType);
    
    // Parse response
    let responseData;
    try {
      responseData = JSON.parse(response.body);
    } catch (e) {
      console.log('  ❌ FAIL: Could not parse response JSON');
      return false;
    }
    
    // Check if endpoint was reached
    if (response.statusCode === 404) {
      console.log('  ❌ FAIL: 404 Not Found');
      return false;
    }
    
    // Check if signature validation is working
    if (response.statusCode === 400 || response.statusCode === 401) {
      const message = responseData.message || '';
      if (
        message.includes('signature') ||
        message.includes('Missing signature') ||
        message.includes('Invalid signature')
      ) {
        console.log(`  ✅ PASS: ${response.statusCode} - ${message}`);
        return true;
      } else {
        console.log(`  ❌ FAIL: Unexpected message - ${message}`);
        return false;
      }
    }
    
    console.log(`  ❌ FAIL: Unexpected status ${response.statusCode}`);
    return false;
  } catch (error) {
    console.log(`  ❌ FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('='.repeat(60));
  console.log('Webhook Charset Handling Tests');
  console.log('='.repeat(60));
  console.log(`Target: http://${HOST}:${PORT}${WEBHOOK_PATH}`);
  
  const contentTypes = [
    'application/json',
    'application/json; charset=utf-8',
    'application/json; charset=UTF-8',
    'application/json;charset=utf-8',  // No space
    'application/json;charset=UTF-8',  // No space
  ];
  
  const results = [];
  
  for (const contentType of contentTypes) {
    const passed = await testContentType(contentType);
    results.push({ contentType, passed });
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  
  results.forEach(({ contentType, passed }) => {
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${contentType}`);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passedCount}/${totalCount} passed`);
  console.log('='.repeat(60));
  
  if (passedCount === totalCount) {
    console.log('\n✅ All Content-Type variants handled correctly!');
    console.log('\nWebhook is charset-safe and production-ready.');
    process.exit(0);
  } else {
    console.log('\n❌ Some Content-Type variants failed');
    console.log('\nCheck server logs and middleware configuration.');
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('❌ Test suite failed with error:');
  console.error(error.message);
  process.exit(1);
});
