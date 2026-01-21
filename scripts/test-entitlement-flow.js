/**
 * Dev Test Script - Entitlement Flow End-to-End
 * 
 * Usage:
 *   node scripts/test-entitlement-flow.js YOUR_AUTH_TOKEN YOUR_MOBILE
 * 
 * This script tests the complete entitlement flow:
 * 1. Fresh user (trial)
 * 2. Trial expiry → free
 * 3. Write limit enforcement
 */

const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:5055';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ph4';

// Get CLI args
const token = process.argv[2];
const mobile = process.argv[3];

if (!token || !mobile) {
  console.error('Usage: node scripts/test-entitlement-flow.js YOUR_AUTH_TOKEN YOUR_MOBILE');
  process.exit(1);
}

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});

// Test utilities
const log = (section, message) => {
  console.log(`\n[${ section }] ${message}`);
};

const pass = (test) => {
  console.log(`  ✅ ${test}`);
};

const fail = (test, error) => {
  console.log(`  ❌ ${test}`);
  console.error(`     Error: ${error}`);
};

// Tests
const testFreshUserEntitlement = async () => {
  log('TEST 1', 'Fresh User Entitlement');
  
  try {
    const res = await client.get('/api/v1/auth/me/entitlement');
    const data = res.data.data;
    
    console.log('  Response:', JSON.stringify(data, null, 2));
    
    if (data.planStatus === 'trial') {
      pass('Plan status is "trial"');
    } else {
      fail('Plan status is "trial"', `Got: ${data.planStatus}`);
    }
    
    if (data.dailyLimit === null) {
      pass('Daily limit is null (unlimited)');
    } else {
      fail('Daily limit is null', `Got: ${data.dailyLimit}`);
    }
    
    if (data.writesRemainingToday === null) {
      pass('Writes remaining is null (unlimited)');
    } else {
      fail('Writes remaining is null', `Got: ${data.writesRemainingToday}`);
    }
    
    if (data.trialDaysLeft > 0) {
      pass(`Trial days left: ${data.trialDaysLeft}`);
    } else {
      fail('Trial days left > 0', `Got: ${data.trialDaysLeft}`);
    }
    
    return true;
  } catch (error) {
    fail('Fetch entitlement', error.message);
    return false;
  }
};

const testForceTrialExpiry = async () => {
  log('TEST 2', 'Force Trial Expiry → Free');
  
  try {
    // Connect to DB
    await mongoose.connect(MONGO_URI);
    const User = mongoose.model('User', new mongoose.Schema({}, {strict: false}));
    
    // Find user
    const user = await User.findOne({ mobile });
    if (!user) {
      fail('Find user', `No user found with mobile: ${mobile}`);
      return false;
    }
    
    log('DB', `Found user: ${user._id}`);
    
    // Set trial to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    await User.updateOne(
      { mobile },
      { $set: { trialEndsAt: yesterday } }
    );
    
    pass('Set trialEndsAt to yesterday');
    
    // Make API call to trigger downgrade
    const res = await client.get('/api/v1/auth/me/entitlement');
    const data = res.data.data;
    
    console.log('  Response:', JSON.stringify(data, null, 2));
    
    if (data.planStatus === 'free') {
      pass('Plan status downgraded to "free"');
    } else {
      fail('Plan status is "free"', `Got: ${data.planStatus}`);
    }
    
    if (data.dailyLimit === 10) {
      pass('Daily limit is 10');
    } else {
      fail('Daily limit is 10', `Got: ${data.dailyLimit}`);
    }
    
    if (typeof data.writesRemainingToday === 'number') {
      pass(`Writes remaining: ${data.writesRemainingToday}`);
    } else {
      fail('Writes remaining is a number', `Got: ${data.writesRemainingToday}`);
    }
    
    await mongoose.disconnect();
    return true;
  } catch (error) {
    fail('Force trial expiry', error.message);
    await mongoose.disconnect();
    return false;
  }
};

const testResetToTrial = async () => {
  log('CLEANUP', 'Reset User to Trial');
  
  try {
    await mongoose.connect(MONGO_URI);
    const User = mongoose.model('User', new mongoose.Schema({}, {strict: false}));
    
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    
    await User.updateOne(
      { mobile },
      {
        $set: {
          planStatus: 'trial',
          trialEndsAt: futureDate,
          dailyWriteCount: 0,
        },
      }
    );
    
    pass('User reset to trial status');
    
    await mongoose.disconnect();
    return true;
  } catch (error) {
    fail('Reset to trial', error.message);
    await mongoose.disconnect();
    return false;
  }
};

// Run all tests
(async () => {
  console.log('\n='.repeat(60));
  console.log('ENTITLEMENT FLOW END-TO-END TEST');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Mobile: ${mobile}`);
  console.log('='.repeat(60));
  
  let allPassed = true;
  
  // Test 1: Fresh user entitlement
  allPassed = await testFreshUserEntitlement() && allPassed;
  
  // Test 2: Force trial expiry
  allPassed = await testForceTrialExpiry() && allPassed;
  
  // Cleanup: Reset to trial
  await testResetToTrial();
  
  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
  } else {
    console.log('❌ SOME TESTS FAILED');
  }
  console.log('='.repeat(60) + '\n');
  
  process.exit(allPassed ? 0 : 1);
})();
