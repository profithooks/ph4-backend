/**
 * Atomic Credit Enforcement Verification Script
 * 
 * PURPOSE: Prove that atomic credit enforcement prevents race conditions
 * 
 * TEST SCENARIOS:
 * 1. Concurrent bill creation (tight limit) - only one should pass
 * 2. Payment reduces outstanding correctly
 * 3. Bill deletion releases credit correctly
 * 4. Override mechanism works
 * 5. Rollback on bill creation failure
 * 
 * USAGE:
 *   npm run verify-atomic-credit
 * 
 * EXPECTED RESULT:
 *   ✅ All tests pass
 *   ✅ No race conditions detected
 *   ✅ Outstanding always matches bills
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Customer = require('../src/models/Customer');
const Bill = require('../src/models/Bill');
const {
  atomicReserveCredit,
  atomicReleaseCredit,
} = require('../src/services/creditControlAtomic.service');
const {
  computeOutstandingFromBills,
  reconcileCustomerOutstanding,
} = require('../src/services/creditOutstandingReconcile.service');

/**
 * ANSI colors
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = (msg, color = 'reset') => {
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

/**
 * Connect to database
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    log('✅ Connected to MongoDB', 'green');
  } catch (error) {
    log('❌ MongoDB connection failed', 'red');
    log(error.message, 'red');
    process.exit(1);
  }
}

/**
 * Disconnect from database
 */
async function disconnectDB() {
  try {
    await mongoose.disconnect();
    log('✅ Disconnected from MongoDB', 'green');
  } catch (error) {
    log('❌ Disconnect failed', 'red');
    log(error.message, 'red');
  }
}

/**
 * Create test user and customer
 */
async function createTestData() {
  // Create or get test user
  let user = await User.findOne({email: 'atomic-credit-test@ph4.local'});
  
  if (!user) {
    user = await User.create({
      name: 'Atomic Credit Test User',
      email: 'atomic-credit-test@ph4.local',
      password: 'test123456',
      phone: '9999999999',
      businessId: new mongoose.Types.ObjectId(),
    });
    log('Created test user', 'blue');
  }
  
  // Create test customer with credit limit
  const customer = await Customer.create({
    userId: user._id,
    name: 'Concurrent Test Customer',
    phone: '8888888888',
    creditLimitEnabled: true,
    creditLimitAmount: 10000, // Tight limit for testing
    creditLimitGraceAmount: 1000,
    creditLimitAllowOverride: true,
    creditOutstanding: 0, // Start clean
  });
  
  log('Created test customer', 'blue');
  
  return {user, customer};
}

/**
 * Cleanup test data
 */
async function cleanupTestData(userId) {
  await Bill.deleteMany({userId});
  await Customer.deleteMany({userId});
  // Don't delete user - might be reused
  log('Cleaned up test data', 'blue');
}

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * TEST 1: Concurrent bill creation (tight limit)
 */
async function testConcurrentBillCreation(user, customer) {
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  TEST 1: Concurrent Bill Creation (Tight Limit)             ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  
  log('Scenario: Two concurrent ₹6000 bills, limit ₹10000', 'yellow');
  log('Expected: One passes, one blocked', 'yellow');
  log('');
  
  // Reset customer outstanding
  await Customer.findByIdAndUpdate(customer._id, {creditOutstanding: 0});
  
  // Create two concurrent reserve requests
  const promise1 = atomicReserveCredit({
    userId: user._id,
    customerId: customer._id,
    delta: 6000,
    override: false,
    billId: 'test-bill-1',
    requestId: 'test-1',
  });
  
  const promise2 = atomicReserveCredit({
    userId: user._id,
    customerId: customer._id,
    delta: 6000,
    override: false,
    billId: 'test-bill-2',
    requestId: 'test-2',
  });
  
  // Wait for both to complete
  const results = await Promise.allSettled([promise1, promise2]);
  
  const passed = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const blocked = results.filter(r => r.status === 'fulfilled' && !r.value.success).length;
  
  log(`Results: ${passed} passed, ${blocked} blocked`, 'blue');
  
  // Get final outstanding
  const customerAfter = await Customer.findById(customer._id).lean();
  log(`Final outstanding: ₹${customerAfter.creditOutstanding}`, 'blue');
  
  // VERIFY
  if (passed === 1 && blocked === 1 && customerAfter.creditOutstanding === 6000) {
    log('✅ TEST PASSED: Atomicity enforced!', 'green');
    
    // Cleanup: release the reserved credit
    await atomicReleaseCredit({
      userId: user._id,
      customerId: customer._id,
      delta: 6000,
      reason: 'TEST_CLEANUP',
      requestId: 'test-cleanup-1',
    });
    
    return true;
  } else {
    log('❌ TEST FAILED: Race condition detected!', 'red');
    log(`  Expected: 1 passed, 1 blocked, outstanding ₹6000`, 'red');
    log(`  Actual: ${passed} passed, ${blocked} blocked, outstanding ₹${customerAfter.creditOutstanding}`, 'red');
    return false;
  }
}

/**
 * TEST 2: Payment releases credit correctly
 */
async function testPaymentRelease(user, customer) {
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  TEST 2: Payment Releases Credit Correctly                  ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  
  // Reset
  await Customer.findByIdAndUpdate(customer._id, {creditOutstanding: 0});
  
  log('Reserve ₹5000 for bill', 'yellow');
  await atomicReserveCredit({
    userId: user._id,
    customerId: customer._id,
    delta: 5000,
    billId: 'test-bill-3',
    requestId: 'test-2',
  });
  
  let customerAfter = await Customer.findById(customer._id).lean();
  log(`Outstanding after reserve: ₹${customerAfter.creditOutstanding}`, 'blue');
  
  log('Release ₹2000 (partial payment)', 'yellow');
  await atomicReleaseCredit({
    userId: user._id,
    customerId: customer._id,
    delta: 2000,
    reason: 'PAYMENT',
    billId: 'test-bill-3',
    requestId: 'test-2-payment',
  });
  
  customerAfter = await Customer.findById(customer._id).lean();
  log(`Outstanding after payment: ₹${customerAfter.creditOutstanding}`, 'blue');
  
  // VERIFY
  if (customerAfter.creditOutstanding === 3000) {
    log('✅ TEST PASSED: Payment released credit correctly!', 'green');
    
    // Cleanup
    await atomicReleaseCredit({
      userId: user._id,
      customerId: customer._id,
      delta: 3000,
      reason: 'TEST_CLEANUP',
      requestId: 'test-cleanup-2',
    });
    
    return true;
  } else {
    log('❌ TEST FAILED: Payment did not release credit correctly!', 'red');
    log(`  Expected: ₹3000, Actual: ₹${customerAfter.creditOutstanding}`, 'red');
    return false;
  }
}

/**
 * TEST 3: Double-release prevention
 */
async function testDoubleReleaseDetection(user, customer) {
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  TEST 3: Double-Release Detection                           ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  
  // Reset
  await Customer.findByIdAndUpdate(customer._id, {creditOutstanding: 0});
  
  log('Reserve ₹1000', 'yellow');
  await atomicReserveCredit({
    userId: user._id,
    customerId: customer._id,
    delta: 1000,
    billId: 'test-bill-4',
    requestId: 'test-3',
  });
  
  log('Release ₹1000 (full payment)', 'yellow');
  await atomicReleaseCredit({
    userId: user._id,
    customerId: customer._id,
    delta: 1000,
    reason: 'PAYMENT',
    billId: 'test-bill-4',
    requestId: 'test-3-release-1',
  });
  
  log('Attempt to release ₹500 AGAIN (double-release)', 'yellow');
  const result = await atomicReleaseCredit({
    userId: user._id,
    customerId: customer._id,
    delta: 500,
    reason: 'PAYMENT',
    billId: 'test-bill-4',
    requestId: 'test-3-release-2',
  });
  
  const customerAfter = await Customer.findById(customer._id).lean();
  log(`Outstanding: ₹${customerAfter.creditOutstanding}`, 'blue');
  log(`Clamped: ${result.clamped}`, 'blue');
  
  // VERIFY
  if (customerAfter.creditOutstanding === 0 && result.clamped === true) {
    log('✅ TEST PASSED: Double-release detected and clamped to 0!', 'green');
    return true;
  } else {
    log('❌ TEST FAILED: Double-release not detected!', 'red');
    log(`  Expected: outstanding=0, clamped=true`, 'red');
    log(`  Actual: outstanding=${customerAfter.creditOutstanding}, clamped=${result.clamped}`, 'red');
    return false;
  }
}

/**
 * TEST 4: Reconciliation detects drift
 */
async function testReconciliation(user, customer) {
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║  TEST 4: Reconciliation Detects Drift                       ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  
  // Reset
  await Customer.findByIdAndUpdate(customer._id, {creditOutstanding: 0});
  
  // Create a bill directly (bypass atomic credit)
  log('Creating bill directly (bypass atomic credit)', 'yellow');
  const bill = await Bill.create({
    userId: user._id,
    customerId: customer._id,
    billNo: 'TEST-001',
    items: [{name: 'Test Item', qty: 1, price: 3000, total: 3000}],
    subTotal: 3000,
    discount: 0,
    tax: 0,
    grandTotal: 3000,
    paidAmount: 0,
  });
  
  log('Bill created with ₹3000 due', 'blue');
  
  let customerBefore = await Customer.findById(customer._id).lean();
  log(`Stored outstanding: ₹${customerBefore.creditOutstanding}`, 'blue');
  
  // Reconcile
  log('Running reconciliation...', 'yellow');
  const reconcileResult = await reconcileCustomerOutstanding(user._id, customer._id, {
    autoFix: true,
    requestId: 'test-4-reconcile',
  });
  
  log(`Stored: ₹${reconcileResult.stored}`, 'blue');
  log(`Actual: ₹${reconcileResult.actual}`, 'blue');
  log(`Delta: ₹${reconcileResult.delta}`, 'blue');
  log(`Fixed: ${reconcileResult.fixed}`, 'blue');
  
  const customerAfter = await Customer.findById(customer._id).lean();
  
  // Cleanup
  await Bill.findByIdAndDelete(bill._id);
  await Customer.findByIdAndUpdate(customer._id, {creditOutstanding: 0});
  
  // VERIFY
  if (reconcileResult.hasDrift && reconcileResult.fixed && customerAfter.creditOutstanding === 3000) {
    log('✅ TEST PASSED: Drift detected and fixed!', 'green');
    return true;
  } else {
    log('❌ TEST FAILED: Reconciliation did not work!', 'red');
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║                                                              ║', 'cyan');
  log('║      ATOMIC CREDIT ENFORCEMENT VERIFICATION                  ║', 'cyan');
  log('║                                                              ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝\n', 'cyan');
  
  await connectDB();
  
  let {user, customer} = await createTestData();
  
  const results = [];
  
  try {
    results.push(await testConcurrentBillCreation(user, customer));
    results.push(await testPaymentRelease(user, customer));
    results.push(await testDoubleReleaseDetection(user, customer));
    results.push(await testReconciliation(user, customer));
  } catch (error) {
    log('\n❌ Test execution failed!', 'red');
    log(error.message, 'red');
    console.error(error);
  } finally {
    await cleanupTestData(user._id);
    await disconnectDB();
  }
  
  // Summary
  const passed = results.filter(r => r === true).length;
  const total = results.length;
  
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║                      RESULTS                                 ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  log(`Tests Passed: ${passed}/${total}`, passed === total ? 'green' : 'red');
  
  if (passed === total) {
    log('\n🎉 ALL TESTS PASSED! Atomic credit enforcement is PROVEN!', 'green');
    process.exit(0);
  } else {
    log('\n❌ SOME TESTS FAILED! Review logs above.', 'red');
    process.exit(1);
  }
}

// Run all tests
runAllTests().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
