/**
 * Verification Script: Ledger Credit Control
 * 
 * Tests Rockefeller-grade credit control for manual ledger transactions
 * 
 * Test Cases:
 * 1. addCredit with limit enabled and near limit => BLOCKS
 * 2. addCredit with override => PASSES
 * 3. addDebit releases headroom
 * 4. Idempotency handling for addCredit (no double reserve)
 * 
 * Usage:
 *   node scripts/verify-ledger-credit-control.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Customer = require('../src/models/Customer');
const LedgerTransaction = require('../src/models/LedgerTransaction');
const {atomicReserveCredit, atomicReleaseCredit} = require('../src/services/creditControlAtomic.service');
const {addCredit, addDebit} = require('../src/controllers/ledger.controller');

const COLORS = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
};

function log(msg, color = COLORS.RESET) {
  console.log(`${color}${msg}${COLORS.RESET}`);
}

function logStep(step, msg) {
  log(`\n[${'═'.repeat(70)}]`, COLORS.BLUE);
  log(`  ${step}. ${msg}`, COLORS.CYAN);
  log(`[${'═'.repeat(70)}]`, COLORS.BLUE);
}

function logSuccess(msg) {
  log(`  ✅ ${msg}`, COLORS.GREEN);
}

function logError(msg) {
  log(`  ❌ ${msg}`, COLORS.RED);
}

function logInfo(msg) {
  log(`  ℹ️  ${msg}`, COLORS.YELLOW);
}

/**
 * Test 1: addCredit with limit enabled, outstanding near limit => BLOCKS
 */
async function testCreditLimitBlocksLedgerCredit(user, customer) {
  logStep(1, 'Test: addCredit with limit enabled, outstanding near limit => BLOCKS');
  
  // Setup: Set credit limit and push outstanding near limit
  await Customer.findByIdAndUpdate(customer._id, {
    creditLimitEnabled: true,
    creditLimitAmount: 10000,
    creditLimitGraceAmount: 1000,
    creditOutstanding: 10500, // Near threshold (11000)
  });
  
  const updatedCustomer = await Customer.findById(customer._id);
  logInfo(`Credit Limit: ₹${updatedCustomer.creditLimitAmount}`);
  logInfo(`Grace: ₹${updatedCustomer.creditLimitGraceAmount}`);
  logInfo(`Threshold: ₹${updatedCustomer.creditLimitAmount + updatedCustomer.creditLimitGraceAmount}`);
  logInfo(`Current Outstanding: ₹${updatedCustomer.creditOutstanding}`);
  
  // Attempt to add credit that would breach limit
  const attemptAmount = 1000; // Would push to 11500 (over threshold)
  logInfo(`Attempting to add credit: ₹${attemptAmount}`);
  
  const mockReq = {
    user: {_id: user._id},
    body: {
      customerId: customer._id,
      amount: attemptAmount,
      note: 'Test credit - should be blocked',
    },
    headers: {},
    requestId: 'test-req-1',
  };
  
  const mockRes = {
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.body = data;
      return this;
    },
  };
  
  let errorThrown = null;
  const mockNext = (error) => {
    errorThrown = error;
  };
  
  await addCredit(mockReq, mockRes, mockNext);
  
  if (errorThrown && errorThrown.statusCode === 409 && errorThrown.code === 'CREDIT_LIMIT_EXCEEDED') {
    logSuccess('Credit limit enforcement BLOCKED transaction as expected');
    logInfo(`Error: ${errorThrown.message}`);
    
    // Verify outstanding didn't change
    const customerAfter = await Customer.findById(customer._id);
    if (customerAfter.creditOutstanding === 10500) {
      logSuccess(`Outstanding unchanged: ₹${customerAfter.creditOutstanding}`);
      return true;
    } else {
      logError(`Outstanding changed unexpectedly: ₹${customerAfter.creditOutstanding}`);
      return false;
    }
  } else {
    logError('Credit limit enforcement FAILED - transaction was not blocked');
    return false;
  }
}

/**
 * Test 2: addCredit with override => PASSES
 */
async function testCreditWithOverride(user, customer) {
  logStep(2, 'Test: addCredit with owner override => PASSES');
  
  // Attempt to add credit with override
  const attemptAmount = 1000;
  logInfo(`Attempting to add credit with override: ₹${attemptAmount}`);
  
  const outstandingBefore = (await Customer.findById(customer._id)).creditOutstanding;
  
  const mockReq = {
    user: {_id: user._id},
    body: {
      customerId: customer._id,
      amount: attemptAmount,
      note: 'Test credit - with override',
      overrideReason: 'Testing override mechanism',
    },
    headers: {
      'x-owner-override': 'true',
    },
    requestId: 'test-req-2',
    header: function(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  
  const mockRes = {
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.body = data;
      return this;
    },
  };
  
  let errorThrown = null;
  const mockNext = (error) => {
    errorThrown = error;
  };
  
  await addCredit(mockReq, mockRes, mockNext);
  
  if (!errorThrown && mockRes.statusCode === 201) {
    logSuccess('Override PASSED - transaction created');
    
    // Verify outstanding increased
    const customerAfter = await Customer.findById(customer._id);
    const expectedOutstanding = outstandingBefore + attemptAmount;
    
    if (customerAfter.creditOutstanding === expectedOutstanding) {
      logSuccess(`Outstanding increased: ₹${outstandingBefore} → ₹${customerAfter.creditOutstanding}`);
      return true;
    } else {
      logError(`Outstanding mismatch: expected ₹${expectedOutstanding}, got ₹${customerAfter.creditOutstanding}`);
      return false;
    }
  } else {
    logError('Override FAILED - transaction was blocked');
    if (errorThrown) {
      logError(`Error: ${errorThrown.message}`);
    }
    return false;
  }
}

/**
 * Test 3: addDebit releases headroom
 */
async function testDebitReleasesCredit(user, customer) {
  logStep(3, 'Test: addDebit releases headroom');
  
  const outstandingBefore = (await Customer.findById(customer._id)).creditOutstanding;
  logInfo(`Outstanding before debit: ₹${outstandingBefore}`);
  
  const paymentAmount = 5000;
  logInfo(`Recording payment (debit): ₹${paymentAmount}`);
  
  const mockReq = {
    user: {_id: user._id},
    body: {
      customerId: customer._id,
      amount: paymentAmount,
      note: 'Test payment - should release credit',
    },
    headers: {},
    requestId: 'test-req-3',
    header: function(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  
  const mockRes = {
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.body = data;
      return this;
    },
  };
  
  let errorThrown = null;
  const mockNext = (error) => {
    errorThrown = error;
  };
  
  await addDebit(mockReq, mockRes, mockNext);
  
  if (!errorThrown && mockRes.statusCode === 201) {
    logSuccess('Debit transaction created');
    
    // Verify outstanding decreased
    const customerAfter = await Customer.findById(customer._id);
    const expectedOutstanding = Math.max(0, outstandingBefore - paymentAmount);
    
    if (customerAfter.creditOutstanding === expectedOutstanding) {
      logSuccess(`Outstanding decreased: ₹${outstandingBefore} → ₹${customerAfter.creditOutstanding}`);
      logSuccess(`Headroom released: ₹${paymentAmount}`);
      return true;
    } else {
      logError(`Outstanding mismatch: expected ₹${expectedOutstanding}, got ₹${customerAfter.creditOutstanding}`);
      return false;
    }
  } else {
    logError('Debit transaction FAILED');
    if (errorThrown) {
      logError(`Error: ${errorThrown.message}`);
    }
    return false;
  }
}

/**
 * Test 4: Idempotency - no double reserve
 */
async function testIdempotencyNoDoubleReserve(user, customer) {
  logStep(4, 'Test: Idempotency - addCredit doesn\'t double reserve');
  
  // Reset outstanding to safe level
  await Customer.findByIdAndUpdate(customer._id, {
    creditOutstanding: 5000,
  });
  
  const outstandingBefore = (await Customer.findById(customer._id)).creditOutstanding;
  logInfo(`Outstanding before: ₹${outstandingBefore}`);
  
  const creditAmount = 1000;
  const idempotencyKey = `test-idem-${Date.now()}`;
  logInfo(`Adding credit with idempotency key: ${idempotencyKey}`);
  
  // First request
  const mockReq1 = {
    user: {_id: user._id},
    body: {
      customerId: customer._id,
      amount: creditAmount,
      note: 'Test credit - idempotency test',
      idempotencyKey,
    },
    headers: {},
    requestId: 'test-req-4a',
    header: function(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  
  const mockRes1 = {
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.body = data;
      return this;
    },
  };
  
  await addCredit(mockReq1, mockRes1, (error) => {
    throw error;
  });
  
  const outstandingAfterFirst = (await Customer.findById(customer._id)).creditOutstanding;
  logInfo(`Outstanding after first request: ₹${outstandingAfterFirst}`);
  
  // Second request with same idempotency key
  const mockReq2 = {
    user: {_id: user._id},
    body: {
      customerId: customer._id,
      amount: creditAmount,
      note: 'Test credit - idempotency test',
      idempotencyKey,
    },
    headers: {},
    requestId: 'test-req-4b',
    header: function(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  
  const mockRes2 = {
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.body = data;
      return this;
    },
  };
  
  await addCredit(mockReq2, mockRes2, (error) => {
    throw error;
  });
  
  const outstandingAfterSecond = (await Customer.findById(customer._id)).creditOutstanding;
  logInfo(`Outstanding after second request: ₹${outstandingAfterSecond}`);
  
  if (outstandingAfterFirst === outstandingAfterSecond) {
    logSuccess('Idempotency CORRECT - outstanding not double-incremented');
    logSuccess(`Outstanding remained: ₹${outstandingAfterSecond}`);
    return true;
  } else {
    logError('Idempotency FAILED - outstanding was double-incremented');
    logError(`Expected ₹${outstandingAfterFirst}, got ₹${outstandingAfterSecond}`);
    return false;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  log('\n╔════════════════════════════════════════════════════════════════════════╗', COLORS.BLUE);
  log('║  VERIFICATION: Ledger Credit Control                                  ║', COLORS.BLUE);
  log('║  Rockefeller-Grade Credit Limit Enforcement                           ║', COLORS.BLUE);
  log('╚════════════════════════════════════════════════════════════════════════╝', COLORS.BLUE);
  
  try {
    // Connect to MongoDB
    log('\nConnecting to MongoDB...', COLORS.YELLOW);
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/ph4-test', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logSuccess('Connected to MongoDB');
    
    // Find or create test user
    let user = await User.findOne({phone: '+919999999999'});
    if (!user) {
      user = await User.create({
        phone: '+919999999999',
        role: 'OWNER',
      });
      logInfo('Created test user');
    } else {
      logInfo('Using existing test user');
    }
    
    // Find or create test customer
    let customer = await Customer.findOne({userId: user._id, phone: '+919999999998'});
    if (!customer) {
      customer = await Customer.create({
        userId: user._id,
        name: 'Test Customer - Credit Control',
        phone: '+919999999998',
        creditLimitEnabled: true,
        creditLimitAmount: 10000,
        creditLimitGraceAmount: 1000,
        creditLimitAllowOverride: true,
        creditOutstanding: 0,
      });
      logInfo('Created test customer');
    } else {
      logInfo('Using existing test customer');
    }
    
    // Run tests
    const results = {
      test1: await testCreditLimitBlocksLedgerCredit(user, customer),
      test2: await testCreditWithOverride(user, customer),
      test3: await testDebitReleasesCredit(user, customer),
      test4: await testIdempotencyNoDoubleReserve(user, customer),
    };
    
    // Summary
    log('\n╔════════════════════════════════════════════════════════════════════════╗', COLORS.BLUE);
    log('║  TEST SUMMARY                                                          ║', COLORS.BLUE);
    log('╚════════════════════════════════════════════════════════════════════════╝', COLORS.BLUE);
    
    const totalTests = Object.keys(results).length;
    const passedTests = Object.values(results).filter(r => r).length;
    
    Object.entries(results).forEach(([test, passed]) => {
      const status = passed ? '✅ PASS' : '❌ FAIL';
      const color = passed ? COLORS.GREEN : COLORS.RED;
      log(`  ${status} - ${test}`, color);
    });
    
    log(`\n  Total: ${passedTests}/${totalTests} tests passed`, passedTests === totalTests ? COLORS.GREEN : COLORS.RED);
    
    if (passedTests === totalTests) {
      log('\n🎉 ALL TESTS PASSED! Credit control is working correctly.', COLORS.GREEN);
    } else {
      log('\n⚠️  SOME TESTS FAILED. Review the logs above.', COLORS.RED);
    }
    
    // Cleanup
    log('\nCleaning up test data...', COLORS.YELLOW);
    await LedgerTransaction.deleteMany({
      userId: user._id,
      customerId: customer._id,
      note: /Test/,
    });
    logSuccess('Test transactions cleaned up');
    
  } catch (error) {
    logError(`Test execution failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    logSuccess('Database connection closed');
  }
}

// Run tests
runTests()
  .then(() => {
    log('\n✨ Verification complete\n', COLORS.CYAN);
    process.exit(0);
  })
  .catch(error => {
    logError(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
