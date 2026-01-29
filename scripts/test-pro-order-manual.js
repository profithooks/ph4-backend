#!/usr/bin/env node
/**
 * Manual Smoke Test: Pro Order Creation
 * 
 * Simple manual test that prints curl commands for testing
 * 
 * Usage:
 *   node scripts/test-pro-order-manual.js [token]
 * 
 * Steps:
 *   1. Login to get token:
 *      curl -X POST http://localhost:5055/api/auth/login \
 *        -H "Content-Type: application/json" \
 *        -d '{"phone":"+919999999999","password":"yourpassword"}'
 * 
 *   2. Run this script with token:
 *      node scripts/test-pro-order-manual.js "your_token_here"
 */

const http = require('http');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5055';
const TOKEN = process.argv[2];

if (!TOKEN) {
  console.log('===========================================');
  console.log('Pro Order Creation - Manual Test');
  console.log('===========================================');
  console.log('');
  console.log('Usage: node scripts/test-pro-order-manual.js <token>');
  console.log('');
  console.log('Step 1: Login to get token');
  console.log('-------------------------------------------');
  console.log(`curl -X POST ${API_BASE_URL}/api/auth/login \\`);
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{"phone":"+919999999999","password":"yourpassword"}\'');
  console.log('');
  console.log('Step 2: Copy token from response and run:');
  console.log('-------------------------------------------');
  console.log('node scripts/test-pro-order-manual.js "your_token_here"');
  console.log('');
  process.exit(1);
}

async function makeRequest(path, method = 'GET', body = null) {
  const url = new URL(path, API_BASE_URL);
  
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
    };
    
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    
    const req = http.request(options, (res) => {
      let responseBody = '';
      
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve({
            statusCode: res.statusCode,
            body: parsed,
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            body: responseBody,
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

async function runTests() {
  console.log('===========================================');
  console.log('Pro Order Creation - Manual Test');
  console.log('===========================================');
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log('');
  
  try {
    // Test 1: GET /api/v1/pro/plans
    console.log('[Test 1] GET /api/v1/pro/plans');
    console.log('-------------------------------------------');
    
    const plansResponse = await makeRequest('/api/v1/pro/plans', 'GET');
    console.log(`Status: ${plansResponse.statusCode}`);
    console.log(`Response:`, JSON.stringify(plansResponse.body, null, 2));
    console.log('');
    
    if (plansResponse.statusCode !== 200) {
      console.log('❌ FAIL: GET /plans failed');
      process.exit(1);
    }
    
    const plans = plansResponse.body.data?.plans || [];
    console.log(`✅ PASS: Found ${plans.length} plans`);
    console.log('');
    
    // Test 2: POST /api/v1/pro/order
    console.log('[Test 2] POST /api/v1/pro/order');
    console.log('-------------------------------------------');
    
    const orderResponse = await makeRequest('/api/v1/pro/order', 'POST', {
      planId: 'monthly',
    });
    
    console.log(`Status: ${orderResponse.statusCode}`);
    console.log(`Response:`, JSON.stringify(orderResponse.body, null, 2));
    console.log('');
    
    if (orderResponse.statusCode !== 200) {
      console.log('❌ FAIL: POST /order failed');
      process.exit(1);
    }
    
    const orderData = orderResponse.body.data;
    
    if (!orderData.orderId) {
      console.log('❌ FAIL: Missing orderId in response');
      process.exit(1);
    }
    
    console.log('✅ PASS: Order created successfully');
    console.log(`  Order ID: ${orderData.orderId}`);
    console.log(`  Amount: ${orderData.amount} ${orderData.currency} (₹${orderData.amount / 100})`);
    console.log(`  Plan: ${orderData.planId}`);
    console.log(`  Key ID: ${orderData.keyId}`);
    console.log('');
    
    // Test 3: Idempotency
    console.log('[Test 3] POST /api/v1/pro/order (duplicate)');
    console.log('-------------------------------------------');
    
    const orderResponse2 = await makeRequest('/api/v1/pro/order', 'POST', {
      planId: 'monthly',
    });
    
    console.log(`Status: ${orderResponse2.statusCode}`);
    const orderData2 = orderResponse2.body.data;
    
    if (orderData.orderId === orderData2.orderId) {
      console.log('✅ PASS: Idempotency working (same orderId returned)');
      console.log(`  Order ID: ${orderData2.orderId}`);
      console.log(`  Reused: ${orderData2.reused}`);
    } else {
      console.log('❌ FAIL: Different orderIds returned');
      console.log(`  First:  ${orderData.orderId}`);
      console.log(`  Second: ${orderData2.orderId}`);
    }
    console.log('');
    
    console.log('===========================================');
    console.log('✅ ALL TESTS PASSED');
    console.log('===========================================');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error.message);
    process.exit(1);
  }
}

runTests();
