/**
 * Entitlement Rules Verification Script
 * 
 * Tests the complete entitlement flow:
 * 1. Trial users get unlimited access + can create bills
 * 2. Free users (after trial) get 10 customer writes/day + can VIEW bills
 * 3. Pro users get unlimited everything
 * 4. Bill creation blocked for free users
 * 5. 11th customer write blocked for free users
 */

const axios = require('axios');

// Configuration
const BASE_URL_V1 = 'http://localhost:5055/api/v1';
const BASE_URL = 'http://localhost:5055/api';
const TEST_MOBILE = `9${Date.now().toString().slice(-9)}`; // Generate unique mobile each run

// Store tokens and user IDs
let testUserId;
let testToken;
let testCustomerId;

/**
 * Colored console output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = (msg, color = 'reset') => {
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

const pass = (msg) => log(`✅ PASS: ${msg}`, 'green');
const fail = (msg) => log(`❌ FAIL: ${msg}`, 'red');
const info = (msg) => log(`ℹ️  ${msg}`, 'blue');
const warn = (msg) => log(`⚠️  ${msg}`, 'yellow');

/**
 * Test utilities
 */
const assert = (condition, message) => {
  if (condition) {
    pass(message);
  } else {
    fail(message);
    throw new Error(`Assertion failed: ${message}`);
  }
};

const assertEqual = (actual, expected, message) => {
  assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
};

/**
 * API Helpers
 */
const api = {
  async call(method, endpoint, data = null, token = null, useV1 = true) {
    try {
      const baseUrl = useV1 ? BASE_URL_V1 : BASE_URL;
      const config = {
        method,
        url: `${baseUrl}${endpoint}`,
        headers: {},
      };
      
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      
      if (data) {
        config.data = data;
      }
      
      const response = await axios(config);
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || error.message,
        status: error.response?.status,
      };
    }
  },
  
  async createUser() {
    // Request OTP
    const otpRes = await this.call('POST', '/auth/otp/request', {
      mobile: TEST_MOBILE,
      countryCode: '+91',
    });
    
    if (!otpRes.success) {
      console.error('[DEBUG] OTP Request failed:', JSON.stringify(otpRes, null, 2));
      throw new Error(`Failed to request OTP: ${otpRes.error || 'Unknown error'}`);
    }
    
    // Verify OTP
    const verifyRes = await this.call('POST', '/auth/otp/verify', {
      mobile: TEST_MOBILE,
      otp: '0000',
    });
    
    if (!verifyRes.success) {
      throw new Error('Failed to verify OTP');
    }
    
    testToken = verifyRes.data.accessToken;
    testUserId = verifyRes.data.user._id || verifyRes.data.user.id;
    
    // Set business name
    await this.call('PATCH', '/auth/me/business', { businessName: 'Test Business' }, testToken);
    
    return { token: testToken, userId: testUserId };
  },
  
  async getEntitlement() {
    return await this.call('GET', '/auth/me/entitlement', null, testToken);
  },
  
  async createCustomer() {
    return await this.call('POST', '/customers', {
      name: 'Test Customer',
      mobile: '9999999990',
    }, testToken, false); // false = use /api not /api/v1
  },
  
  async createCustomerWrite() {
    // Create a simple ledger credit (counts as customer write)
    // First ensure we have a customer
    if (!testCustomerId) {
      const custRes = await this.createCustomer();
      if (custRes.success) {
        testCustomerId = custRes.data._id || custRes.data.id;
      }
    }
    
    return await this.call('POST', '/ledger/credit', {
      customerId: testCustomerId || testUserId,
      amount: 100,
      description: 'Test write',
    }, testToken, false); // false = use /api not /api/v1
  },
  
  async createBill() {
    // First ensure we have a customer
    if (!testCustomerId) {
      const custRes = await this.createCustomer();
      if (custRes.success) {
        testCustomerId = custRes.data._id || custRes.data.id;
      }
    }
    
    return await this.call('POST', '/bills', {
      customerId: testCustomerId || testUserId,
      items: [{ description: 'Test Item', quantity: 1, rate: 100 }],
      subTotal: 100,
      grandTotal: 100,
    }, testToken, false); // false = use /api not /api/v1
  },
  
  async viewBills() {
    return await this.call('GET', '/bills', null, testToken);
  },
  
  async addBillPayment(billId, amount) {
    return await this.call('PATCH', `/bills/${billId}/pay`, {
      amount,
      paymentDate: new Date().toISOString(),
      note: 'Test payment',
    }, testToken);
  },
  
  async deleteBill(billId) {
    return await this.call('DELETE', `/bills/${billId}`, null, testToken);
  },
  
  async cancelBill(billId) {
    return await this.call('PATCH', `/bills/${billId}/cancel`, {
      reason: 'Test cancellation',
    }, testToken);
  },
  
  async setPlanStatus(status) {
    // Direct DB manipulation (for testing only)
    const mongoose = require('mongoose');
    const User = require('../src/models/User');
    
    await User.findByIdAndUpdate(testUserId, {
      planStatus: status,
      trialEndsAt: status === 'trial' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : new Date(Date.now() - 1000),
      dailyWriteCount: 0,
    });
  },
  
  async setTrialExpired() {
    const mongoose = require('mongoose');
    const User = require('../src/models/User');
    
    await User.findByIdAndUpdate(testUserId, {
      planStatus: 'trial',
      trialEndsAt: new Date(Date.now() - 1000), // Expired 1 second ago
    });
  },
};

/**
 * Test Suite
 */
const runTests = async () => {
  log('\n========================================', 'blue');
  log('  ENTITLEMENT RULES VERIFICATION', 'blue');
  log('========================================\n', 'blue');
  
  // Connect to DB (for direct manipulation in tests)
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/ph4-dev');
  
  try {
    // ====================================
    // TEST 1: Trial User - Unlimited Access
    // ====================================
    log('\n📋 TEST 1: Trial User - Unlimited Access\n', 'yellow');
    
    info('Creating new user...');
    await api.createUser();
    pass('User created with trial status');
    
    info('Fetching entitlement...');
    const trialEnt = await api.getEntitlement();
    assert(trialEnt.success, 'Entitlement API call succeeded');
    
    const trialData = trialEnt.data.data;
    assertEqual(trialData.planStatus, 'trial', 'Plan status is trial');
    assertEqual(trialData.isTrialActive, true, 'Trial is active');
    assertEqual(trialData.limits.customerWritesPerDay, null, 'No daily limit (unlimited)');
    assertEqual(trialData.permissions.canCreateBills, true, 'Can create bills');
    assertEqual(trialData.permissions.canCreateCustomerWrites, true, 'Can create customer writes');
    
    info('Testing bill creation (should succeed)...');
    const billRes1 = await api.createBill();
    if (!billRes1.success) {
      console.error('[DEBUG] Bill creation failed:', JSON.stringify(billRes1, null, 2));
    }
    assert(billRes1.success, 'Trial user can create bills');
    
    info('Testing customer write (should succeed, no limit)...');
    for (let i = 0; i < 15; i++) {
      const writeRes = await api.createCustomerWrite();
      assert(writeRes.success, `Customer write ${i + 1}/15 succeeded`);
    }
    pass('Trial user has unlimited customer writes');
    
    // ====================================
    // TEST 2: Free User - Limited Access
    // ====================================
    log('\n📋 TEST 2: Free User (Expired Trial) - Limited Access\n', 'yellow');
    
    info('Simulating trial expiry...');
    await api.setTrialExpired();
    
    info('Fetching entitlement (should auto-downgrade to free)...');
    const freeEnt = await api.getEntitlement();
    const freeData = freeEnt.data.data;
    
    assertEqual(freeData.planStatus, 'free', 'Plan status downgraded to free');
    assertEqual(freeData.isTrialActive, false, 'Trial is not active');
    assertEqual(freeData.limits.customerWritesPerDay, 10, 'Daily limit is 10');
    assertEqual(freeData.permissions.canCreateBills, false, 'Cannot create bills');
    assertEqual(freeData.permissions.canViewBills, true, 'Can view bills');
    
    info('Testing bill viewing (should succeed)...');
    const viewRes = await api.viewBills();
    assert(viewRes.success, 'Free user can view bills');
    
    info('Testing bill creation (should fail - Pro required)...');
    const billRes2 = await api.createBill();
    assert(!billRes2.success, 'Free user cannot create bills');
    assertEqual(billRes2.status, 403, 'Returns 403 Forbidden');
    assertEqual(billRes2.error.code, 'PRO_REQUIRED', 'Error code is PRO_REQUIRED');
    
    // Store bill ID from trial user for mutation tests
    const trialBillId = billRes1.data?.data?._id || billRes1.data?.data?.id;
    if (trialBillId) {
      info('Testing bill payment (should fail - Pro required)...');
      const payRes = await api.addBillPayment(trialBillId, 50);
      assert(!payRes.success, 'Free user cannot add bill payment');
      assertEqual(payRes.status, 403, 'Returns 403 Forbidden');
      assertEqual(payRes.error.code, 'PRO_REQUIRED', 'Error code is PRO_REQUIRED');
      
      info('Testing bill cancellation (should fail - Pro required)...');
      const cancelRes = await api.cancelBill(trialBillId);
      assert(!cancelRes.success, 'Free user cannot cancel bill');
      assertEqual(cancelRes.status, 403, 'Returns 403 Forbidden');
      assertEqual(cancelRes.error.code, 'PRO_REQUIRED', 'Error code is PRO_REQUIRED');
      
      info('Testing bill deletion (should fail - Pro required)...');
      const deleteRes = await api.deleteBill(trialBillId);
      assert(!deleteRes.success, 'Free user cannot delete bill');
      assertEqual(deleteRes.status, 403, 'Returns 403 Forbidden');
      assertEqual(deleteRes.error.code, 'PRO_REQUIRED', 'Error code is PRO_REQUIRED');
      
      pass('All bill mutations blocked for free user');
    } else {
      warn('No bill ID available - skipping mutation tests');
    }
    
    info('Testing 10 customer writes (should succeed)...');
    for (let i = 0; i < 10; i++) {
      const writeRes = await api.createCustomerWrite();
      assert(writeRes.success, `Customer write ${i + 1}/10 succeeded`);
    }
    pass('Free user can make 10 customer writes');
    
    info('Testing 11th customer write (should fail - limit exceeded)...');
    const write11 = await api.createCustomerWrite();
    assert(!write11.success, '11th customer write blocked');
    assertEqual(write11.status, 403, 'Returns 403 Forbidden');
    assertEqual(write11.error.code, 'WRITE_LIMIT_EXCEEDED', 'Error code is WRITE_LIMIT_EXCEEDED');
    pass('Daily limit enforced correctly');
    
    // ====================================
    // TEST 3: Pro User - Unlimited Everything
    // ====================================
    log('\n📋 TEST 3: Pro User - Unlimited Everything\n', 'yellow');
    
    info('Upgrading user to Pro...');
    await api.setPlanStatus('pro');
    
    info('Fetching entitlement...');
    const proEnt = await api.getEntitlement();
    const proData = proEnt.data.data;
    
    assertEqual(proData.planStatus, 'pro', 'Plan status is pro');
    assertEqual(proData.limits.customerWritesPerDay, null, 'No daily limit (unlimited)');
    assertEqual(proData.permissions.canCreateBills, true, 'Can create bills');
    
    info('Testing bill creation (should succeed)...');
    const billRes3 = await api.createBill();
    assert(billRes3.success, 'Pro user can create bills');
    
    info('Testing unlimited customer writes...');
    for (let i = 0; i < 20; i++) {
      const writeRes = await api.createCustomerWrite();
      assert(writeRes.success, `Customer write ${i + 1}/20 succeeded`);
    }
    pass('Pro user has unlimited customer writes');
    
    // ====================================
    // SUMMARY
    // ====================================
    log('\n========================================', 'green');
    log('  ✅ ALL TESTS PASSED', 'green');
    log('========================================\n', 'green');
    
    log('Summary:', 'blue');
    log('  ✅ Trial users: Unlimited access + can create bills', 'green');
    log('  ✅ Free users: 10 writes/day + can VIEW bills + cannot CREATE bills', 'green');
    log('  ✅ Pro users: Unlimited everything', 'green');
    log('  ✅ Limits enforced correctly', 'green');
    log('  ✅ Permissions returned correctly', 'green');
    
  } catch (error) {
    log('\n========================================', 'red');
    log('  ❌ TESTS FAILED', 'red');
    log('========================================\n', 'red');
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

// Run tests
if (require.main === module) {
  runTests()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runTests };
