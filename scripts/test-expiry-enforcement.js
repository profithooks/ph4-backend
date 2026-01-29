/**
 * Smoke Test: Expiry Enforcement
 * 
 * Tests that expired Pro users are blocked by requirePro middleware
 * even if planStatus is still 'pro' (prevents Pro leakage).
 * 
 * Run: node scripts/test-expiry-enforcement.js
 */

const mongoose = require('mongoose');
const User = require('../src/models/User');
const Subscription = require('../src/models/Subscription');
const { mongoUri } = require('../src/config/env');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5055';
const TEST_EMAIL = `expiry-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPassword123!';

let testUserId;
let testToken;
let testSubscriptionId;

async function setup() {
  console.log('\n[Setup] Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('[Setup] Connected');
}

async function cleanup() {
  console.log('\n[Cleanup] Removing test user and subscription...');
  if (testUserId) {
    await User.findByIdAndDelete(testUserId);
  }
  if (testSubscriptionId) {
    await Subscription.findByIdAndDelete(testSubscriptionId);
  }
  await mongoose.connection.close();
  console.log('[Cleanup] Done');
}

async function createTestUser() {
  console.log('\n[Step 1] Creating test user...');
  
  // Create user directly in DB
  const user = await User.create({
    name: 'Expiry Test User',
    email: TEST_EMAIL,
    phone: `9999${Date.now().toString().slice(-6)}`,
    password: TEST_PASSWORD,
    planStatus: 'pro', // Mark as Pro
    planActivatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
  });
  
  testUserId = user._id;
  console.log(`[Step 1] User created: ${testUserId}`);
  console.log(`[Step 1] planStatus: ${user.planStatus}`);
  
  return user;
}

async function createExpiredSubscription() {
  console.log('\n[Step 2] Creating EXPIRED subscription...');
  
  const subscription = await Subscription.create({
    userId: testUserId,
    planId: 'monthly',
    provider: 'manual',
    status: 'active', // Still marked active (simulates race condition)
    startedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
    expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // Expired 10 days ago
    providerPaymentId: `test_pay_${Date.now()}`,
    providerOrderId: `test_order_${Date.now()}`,
    amountPaid: 29900,
    currency: 'INR',
  });
  
  testSubscriptionId = subscription._id;
  console.log(`[Step 2] Subscription created: ${testSubscriptionId}`);
  console.log(`[Step 2] expiresAt: ${subscription.expiresAt} (expired: ${subscription.expiresAt < new Date()})`);
  
  return subscription;
}

async function loginAndGetToken() {
  console.log('\n[Step 3] Logging in to get JWT...');
  
  try {
    const response = await axios.post(`${BASE_URL}/api/v1/auth/login/simple`, {
      phone: (await User.findById(testUserId)).phone,
      password: TEST_PASSWORD,
    });
    
    testToken = response.data.data.token;
    console.log(`[Step 3] Login successful, token obtained`);
    return testToken;
  } catch (error) {
    console.error('[Step 3] Login failed:', error.response?.data || error.message);
    throw error;
  }
}

async function testProEndpoint(shouldPass = false) {
  console.log(`\n[Step 4] Testing Pro-protected endpoint (expect ${shouldPass ? 'PASS' : 'FAIL'})...`);
  
  try {
    const response = await axios.get(`${BASE_URL}/api/bills`, {
      headers: {
        Authorization: `Bearer ${testToken}`,
      },
    });
    
    if (shouldPass) {
      console.log('[Step 4] ✅ PASS - Request allowed (expected)');
      return true;
    } else {
      console.log('[Step 4] ❌ FAIL - Request allowed but should have been blocked');
      return false;
    }
  } catch (error) {
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const message = error.response?.data?.message;
    
    if (!shouldPass) {
      if (status === 403 && (code === 'PRO_EXPIRED' || code === 'PRO_REQUIRED')) {
        console.log(`[Step 4] ✅ PASS - Request blocked as expected (${status} ${code})`);
        console.log(`[Step 4] Message: "${message}"`);
        return true;
      } else {
        console.log(`[Step 4] ❌ FAIL - Wrong error: ${status} ${code}`);
        return false;
      }
    } else {
      console.log(`[Step 4] ❌ FAIL - Request blocked but should have passed: ${status} ${code}`);
      return false;
    }
  }
}

async function extendSubscription() {
  console.log('\n[Step 5] Extending subscription to future date...');
  
  const subscription = await Subscription.findById(testSubscriptionId);
  subscription.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
  await subscription.save();
  
  console.log(`[Step 5] Subscription extended to: ${subscription.expiresAt}`);
}

async function runTest() {
  let passed = true;
  
  try {
    await setup();
    await createTestUser();
    await createExpiredSubscription();
    await loginAndGetToken();
    
    // Test 1: Expired subscription should block
    const test1 = await testProEndpoint(false);
    if (!test1) passed = false;
    
    // Test 2: After extending, should allow
    await extendSubscription();
    const test2 = await testProEndpoint(true);
    if (!test2) passed = false;
    
    await cleanup();
    
    console.log('\n' + '='.repeat(60));
    if (passed) {
      console.log('✅ ALL TESTS PASSED');
      console.log('   - Expired subscriptions are blocked');
      console.log('   - Valid subscriptions are allowed');
      console.log('   - requirePro correctly enforces expiry');
    } else {
      console.log('❌ SOME TESTS FAILED');
      console.log('   - Check logs above for details');
    }
    console.log('='.repeat(60));
    
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    await cleanup();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runTest();
}

module.exports = { runTest };
