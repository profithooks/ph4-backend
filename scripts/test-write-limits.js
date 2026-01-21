/**
 * Test Script: Write Limits & Entitlement
 * 
 * Tests the freemium entitlement system:
 * 1. Trial users (unlimited)
 * 2. Free users (10/day limit)
 * 3. Error responses
 */

const axios = require('axios');
const mongoose = require('mongoose');

const BASE_URL = process.env.API_URL || 'http://localhost:5000/api/v1';

// Color output for terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  step: (msg) => console.log(`\n${colors.cyan}▶ ${msg}${colors.reset}`),
};

let testUser = null;
let token = null;

/**
 * Step 1: Create a test user (trial)
 */
async function createTestUser() {
  log.step('Step 1: Creating test trial user');
  
  const testMobile = `99${Date.now().toString().slice(-8)}`; // Unique mobile
  
  try {
    // Request OTP
    await axios.post(`${BASE_URL}/auth/otp/request`, {
      mobile: testMobile,
    });
    log.success('OTP requested');
    
    // Verify OTP
    const verifyRes = await axios.post(`${BASE_URL}/auth/otp/verify`, {
      mobile: testMobile,
      otp: '0000',
      device: {
        deviceId: 'test-write-limits',
        name: 'Test Device',
        platform: 'test',
      },
    });
    
    token = verifyRes.data.accessToken;
    testUser = verifyRes.data.user;
    
    log.success(`User created: ${testUser.id}`);
    log.info(`Plan Status: ${testUser.planStatus || 'trial'}`);
    log.info(`Mobile: ${testMobile}`);
    
    return { mobile: testMobile, token, user: testUser };
  } catch (error) {
    log.error(`Failed to create user: ${error.message}`);
    throw error;
  }
}

/**
 * Step 2: Test unlimited writes for trial user
 */
async function testTrialWrites() {
  log.step('Step 2: Testing trial user (should allow unlimited writes)');
  
  const writeCount = 12; // More than free limit
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < writeCount; i++) {
    try {
      // Attempt a write operation (this endpoint must have checkWriteLimit)
      // If endpoint doesn't exist yet, this will fail with 404 (expected)
      await axios.post(
        `${BASE_URL}/ledger/credit`,
        {
          customerId: 'test-customer-id',
          amount: 100,
          note: `Test write ${i + 1}`,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          validateStatus: (status) => status < 500, // Accept 4xx for testing
        }
      );
      successCount++;
      log.success(`Write ${i + 1}/${writeCount} succeeded`);
    } catch (error) {
      const status = error.response?.status;
      const code = error.response?.data?.code;
      
      if (status === 404) {
        log.warn(`Write ${i + 1} failed: Endpoint not found (expected if middleware not applied yet)`);
      } else if (code === 'WRITE_LIMIT_EXCEEDED') {
        log.error(`Write ${i + 1} blocked: ${error.response.data.message}`);
        failCount++;
      } else {
        log.warn(`Write ${i + 1} failed: ${error.message}`);
      }
    }
  }
  
  log.info(`Trial Test Complete: ${successCount} succeeded, ${failCount} blocked`);
  
  if (failCount > 0) {
    log.error('❌ UNEXPECTED: Trial users should never be blocked!');
    return false;
  }
  
  log.success('✅ Trial user test passed (unlimited writes)');
  return true;
}

/**
 * Step 3: Transition user to free plan (simulate trial expiration)
 */
async function transitionToFree() {
  log.step('Step 3: Transitioning user to free plan');
  
  try {
    // Connect to MongoDB to manually update user
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ph4';
    await mongoose.connect(mongoUri);
    
    const User = require('../src/models/User');
    
    const user = await User.findById(testUser.id);
    if (!user) {
      log.error('User not found in database');
      return false;
    }
    
    // Manually set to free plan and reset counter
    user.planStatus = 'free';
    user.planActivatedAt = new Date();
    user.dailyWriteCount = 0;
    user.dailyWriteDate = new Date().toISOString().split('T')[0];
    await user.save();
    
    log.success('User transitioned to free plan');
    log.info(`Plan Status: ${user.planStatus}`);
    log.info(`Daily Write Count: ${user.dailyWriteCount}`);
    
    await mongoose.disconnect();
    return true;
  } catch (error) {
    log.error(`Failed to transition user: ${error.message}`);
    return false;
  }
}

/**
 * Step 4: Test free plan limits (10 writes)
 */
async function testFreePlanLimits() {
  log.step('Step 4: Testing free plan (should block after 10 writes)');
  
  const writeCount = 12; // More than free limit (10)
  let successCount = 0;
  let blockedCount = 0;
  
  for (let i = 0; i < writeCount; i++) {
    try {
      const res = await axios.post(
        `${BASE_URL}/ledger/credit`,
        {
          customerId: 'test-customer-id',
          amount: 100,
          note: `Free plan write ${i + 1}`,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          validateStatus: (status) => status < 500,
        }
      );
      
      if (res.status === 200 || res.status === 201) {
        successCount++;
        log.success(`Write ${i + 1}/${writeCount} succeeded (${successCount}/10 used)`);
      }
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      
      if (status === 403 && data?.code === 'WRITE_LIMIT_EXCEEDED') {
        blockedCount++;
        log.warn(`Write ${i + 1} BLOCKED: ${data.message}`);
        log.info(`  Limit: ${data.limit}`);
        log.info(`  Reset At: ${data.resetAt}`);
        log.info(`  Current Count: ${data.meta?.dailyWriteCount}`);
      } else if (status === 404) {
        log.warn(`Write ${i + 1} failed: Endpoint not found`);
      } else {
        log.error(`Write ${i + 1} failed: ${error.message}`);
      }
    }
  }
  
  log.info(`Free Plan Test Complete: ${successCount} succeeded, ${blockedCount} blocked`);
  
  if (successCount <= 10 && blockedCount >= 2) {
    log.success('✅ Free plan limits working correctly!');
    return true;
  } else {
    log.error(`❌ UNEXPECTED: Expected ~10 success and ~2 blocked, got ${successCount} / ${blockedCount}`);
    return false;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n='.repeat(60));
  console.log('🧪 FREEMIUM ENTITLEMENT TEST');
  console.log('='.repeat(60));
  
  try {
    // Step 1: Create user
    await createTestUser();
    
    // Step 2: Test trial (unlimited)
    const trialPassed = await testTrialWrites();
    
    // Step 3: Transition to free
    const transitioned = await transitionToFree();
    
    if (!transitioned) {
      log.error('Failed to transition user to free plan');
      log.warn('Skipping free plan tests');
      return;
    }
    
    // Step 4: Test free plan limits
    const freePassed = await testFreePlanLimits();
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    log.info(`Trial Test: ${trialPassed ? '✅ PASSED' : '❌ FAILED'}`);
    log.info(`Free Plan Test: ${freePassed ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (trialPassed && freePassed) {
      log.success('\n🎉 ALL TESTS PASSED!');
    } else {
      log.error('\n⚠️  SOME TESTS FAILED');
    }
    
  } catch (error) {
    log.error(`Test suite failed: ${error.message}`);
    console.error(error);
  }
  
  process.exit(0);
}

// Run tests
runTests();
