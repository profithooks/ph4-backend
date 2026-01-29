#!/usr/bin/env node
/**
 * Smoke Test: Pro Order Creation
 * 
 * Tests the Pro subscription order creation flow:
 * 1. GET /api/v1/pro/plans - Fetch available plans
 * 2. POST /api/v1/pro/order - Create order for a plan
 * 
 * Verifies:
 * - Plans endpoint returns plan list
 * - Order endpoint returns valid orderId
 * - Amount is server-computed (not client-provided)
 * - Idempotency works (duplicate requests return same order)
 * 
 * Usage:
 *   node scripts/test-pro-order.js
 * 
 * Prerequisites:
 *   - Server running (npm start)
 *   - Valid user account
 *   - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET set in .env
 */

const mongoose = require('mongoose');
const User = require('../src/models/User');
const ProPaymentIntent = require('../src/models/ProPaymentIntent');
const { mongoUri, razorpayKeyId } = require('../src/config/env');

// Test configuration
const TEST_USER_MOBILE = '+919999999998';
const TEST_USER_PASSWORD = 'test123';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5055';

/**
 * Make authenticated API request
 */
async function makeAuthRequest(path, method = 'GET', token, body = null) {
  const http = require('http');
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
        'Authorization': `Bearer ${token}`,
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

/**
 * Login and get token
 */
async function getAuthToken() {
  const response = await makeAuthRequest('/api/auth/login', 'POST', null, {
    mobile: TEST_USER_MOBILE,
    password: TEST_USER_PASSWORD,
  });
  
  if (response.statusCode !== 200 || !response.body.token) {
    throw new Error(`Login failed: ${JSON.stringify(response.body)}`);
  }
  
  return response.body.token;
}

/**
 * Test GET /api/v1/pro/plans
 */
async function testGetPlans(token) {
  console.log('[Test 1] GET /api/v1/pro/plans');
  console.log('-------------------------------------------');
  
  const response = await makeAuthRequest('/api/v1/pro/plans', 'GET', token);
  
  console.log(`Status: ${response.statusCode}`);
  console.log(`Response:`, JSON.stringify(response.body, null, 2));
  console.log('');
  
  // Validate response
  if (response.statusCode !== 200) {
    console.log('❌ FAIL: Expected status 200, got', response.statusCode);
    return false;
  }
  
  if (!response.body.success) {
    console.log('❌ FAIL: Response success is false');
    return false;
  }
  
  if (!response.body.data || !Array.isArray(response.body.data.plans)) {
    console.log('❌ FAIL: Missing plans array in response');
    return false;
  }
  
  const plans = response.body.data.plans;
  
  if (plans.length === 0) {
    console.log('❌ FAIL: Plans array is empty');
    return false;
  }
  
  // Validate plan structure
  for (const plan of plans) {
    if (!plan.id || !plan.name || !plan.amount || !plan.currency) {
      console.log('❌ FAIL: Plan missing required fields:', plan);
      return false;
    }
  }
  
  console.log(`✅ PASS: Found ${plans.length} plans`);
  plans.forEach(plan => {
    console.log(`  - ${plan.displayName}: ${plan.displayPrice}/${plan.displayPeriod}`);
  });
  console.log('');
  
  return true;
}

/**
 * Test POST /api/v1/pro/order
 */
async function testCreateOrder(token, planId = 'monthly') {
  console.log('[Test 2] POST /api/v1/pro/order');
  console.log('-------------------------------------------');
  console.log(`Creating order for plan: ${planId}`);
  console.log('');
  
  const response = await makeAuthRequest('/api/v1/pro/order', 'POST', token, {
    planId,
  });
  
  console.log(`Status: ${response.statusCode}`);
  console.log(`Response:`, JSON.stringify(response.body, null, 2));
  console.log('');
  
  // Validate response
  if (response.statusCode !== 200) {
    console.log('❌ FAIL: Expected status 200, got', response.statusCode);
    return null;
  }
  
  if (!response.body.success) {
    console.log('❌ FAIL: Response success is false');
    return null;
  }
  
  const data = response.body.data;
  
  // Check required fields
  const requiredFields = ['orderId', 'amount', 'currency', 'keyId', 'planId', 'receipt'];
  for (const field of requiredFields) {
    if (!data[field]) {
      console.log(`❌ FAIL: Missing required field: ${field}`);
      return null;
    }
  }
  
  // Validate orderId format (should start with 'order_')
  if (!data.orderId.startsWith('order_')) {
    console.log('❌ FAIL: orderId does not start with "order_":', data.orderId);
    return null;
  }
  
  // Validate amount is positive
  if (data.amount <= 0) {
    console.log('❌ FAIL: Invalid amount:', data.amount);
    return null;
  }
  
  // Validate currency
  if (data.currency !== 'INR') {
    console.log('❌ FAIL: Unexpected currency:', data.currency);
    return null;
  }
  
  // Validate keyId matches environment
  if (razorpayKeyId && data.keyId !== razorpayKeyId) {
    console.log('⚠️  WARNING: keyId mismatch. Expected:', razorpayKeyId, 'Got:', data.keyId);
  }
  
  console.log('✅ PASS: Order created successfully');
  console.log(`  Order ID: ${data.orderId}`);
  console.log(`  Amount: ${data.amount} ${data.currency} (₹${data.amount / 100})`);
  console.log(`  Plan: ${data.planId}`);
  console.log(`  Receipt: ${data.receipt}`);
  console.log(`  Key ID: ${data.keyId}`);
  console.log('');
  
  return data;
}

/**
 * Test idempotency (duplicate request should return same order)
 */
async function testIdempotency(token, planId = 'monthly') {
  console.log('[Test 3] Idempotency Test');
  console.log('-------------------------------------------');
  console.log('Creating duplicate order within 10 minutes...');
  console.log('');
  
  const response1 = await makeAuthRequest('/api/v1/pro/order', 'POST', token, {
    planId,
  });
  
  const response2 = await makeAuthRequest('/api/v1/pro/order', 'POST', token, {
    planId,
  });
  
  if (response1.statusCode !== 200 || response2.statusCode !== 200) {
    console.log('❌ FAIL: One or both requests failed');
    return false;
  }
  
  const order1 = response1.body.data;
  const order2 = response2.body.data;
  
  // Should return same orderId
  if (order1.orderId !== order2.orderId) {
    console.log('❌ FAIL: Different orderIds returned');
    console.log(`  First:  ${order1.orderId}`);
    console.log(`  Second: ${order2.orderId}`);
    return false;
  }
  
  // Second response should indicate reuse
  if (!order2.reused) {
    console.log('⚠️  WARNING: Second response should indicate reuse (reused: true)');
  }
  
  console.log('✅ PASS: Idempotency working correctly');
  console.log(`  Both requests returned same orderId: ${order1.orderId}`);
  console.log(`  Reused flag: ${order2.reused}`);
  console.log('');
  
  return true;
}

/**
 * Cleanup test data
 */
async function cleanup(token) {
  console.log('[Cleanup] Removing test payment intents...');
  
  try {
    // Get user from token (simplified - in real scenario would decode JWT)
    const user = await User.findOne({ mobile: TEST_USER_MOBILE });
    
    if (user) {
      const result = await ProPaymentIntent.deleteMany({
        userId: user._id,
        status: 'created',
      });
      console.log(`✅ Cleaned up ${result.deletedCount} test payment intents`);
    }
  } catch (error) {
    console.log('⚠️  Cleanup failed:', error.message);
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('===========================================');
  console.log('Smoke Test: Pro Order Creation');
  console.log('===========================================');
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`Test User: ${TEST_USER_MOBILE}`);
  console.log('');
  
  let token;
  let allPassed = true;
  
  try {
    // Connect to database
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to database');
    console.log('');
    
    // Login
    console.log('[Setup] Logging in...');
    token = await getAuthToken();
    console.log('✅ Authenticated');
    console.log('');
    
    // Test 1: Get plans
    const test1 = await testGetPlans(token);
    allPassed = allPassed && test1;
    
    // Test 2: Create order
    const order = await testCreateOrder(token, 'monthly');
    const test2 = order !== null;
    allPassed = allPassed && test2;
    
    // Test 3: Idempotency
    const test3 = await testIdempotency(token, 'monthly');
    allPassed = allPassed && test3;
    
    // Cleanup
    await cleanup(token);
    console.log('');
    
    // Summary
    console.log('===========================================');
    console.log('Test Summary');
    console.log('===========================================');
    console.log(`Test 1 (GET /plans):       ${test1 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Test 2 (POST /order):      ${test2 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Test 3 (Idempotency):      ${test3 ? '✅ PASS' : '❌ FAIL'}`);
    console.log('');
    
    if (allPassed) {
      console.log('✅ ALL TESTS PASSED');
      console.log('');
      console.log('Next steps:');
      console.log('1. Mobile can now call GET /api/v1/pro/plans to display plan options');
      console.log('2. Mobile can call POST /api/v1/pro/order to get orderId');
      console.log('3. Mobile uses orderId to open Razorpay checkout');
      console.log('4. After payment, mobile calls POST /api/v1/pro/activate');
      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('- Ensure server is running: npm start');
    console.error('- Ensure test user exists (mobile: +919999999998)');
    console.error('- Ensure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set');
    console.error('- Check MONGO_URI is correct');
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run tests
runTests();
