/**
 * Today Summary Reliability Test
 * 
 * Tests the reliability and observability of Today summary endpoints
 * 
 * Usage:
 *   MONGO_URI=mongodb://localhost:27017/ph4-test JWT_SECRET=test node scripts/test-today-summary-reliability.js
 */

const mongoose = require('mongoose');
const User = require('../src/models/User');
const Bill = require('../src/models/Bill');
const Customer = require('../src/models/Customer');
const logger = require('../src/utils/logger');

// Suppress console logs during test
const originalInfo = logger.info;
const originalError = logger.error;
logger.info = () => {};
logger.error = () => {};

console.log('\n🧪 Today Summary Reliability Tests');
console.log('='.repeat(50));

// Database connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/ph4-test';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Create test user
const createTestUser = async () => {
  let testUser = await User.findOne({email: 'test-today-reliability@example.com'});
  
  if (!testUser) {
    testUser = await User.create({
      name: 'Test Today Reliability User',
      email: 'test-today-reliability@example.com',
      password: 'testpass123',
      mobile: '+919999999998',
      planStatus: 'trial',
    });
    console.log('✅ Created test user:', testUser._id);
  } else {
    console.log('✅ Using existing test user:', testUser._id);
  }
  
  return testUser;
};

// Create test customer
const createTestCustomer = async (userId) => {
  let customer = await Customer.findOne({
    userId,
    name: 'Test Today Customer',
  });
  
  if (!customer) {
    customer = await Customer.create({
      userId,
      name: 'Test Today Customer',
      phone: '9876543211',
    });
    console.log('✅ Created test customer:', customer._id);
  } else {
    console.log('✅ Using existing test customer:', customer._id);
  }
  
  return customer;
};

// Create test bills
const createTestBills = async (userId, customerId) => {
  // Clear existing test bills
  await Bill.deleteMany({
    userId,
    billNo: {$regex: /^TEST-TODAY-/},
  });
  
  const bills = [];
  
  // Overdue bill
  bills.push(await Bill.create({
    userId,
    customerId,
    billNo: `TEST-TODAY-OVERDUE-${Date.now()}`,
    items: [{name: 'Overdue Item', qty: 1, price: 1000, total: 1000}],
    subTotal: 1000,
    grandTotal: 1000,
    paidAmount: 0,
    status: 'unpaid',
    dueDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
  }));
  
  // Due today bill
  bills.push(await Bill.create({
    userId,
    customerId,
    billNo: `TEST-TODAY-DUE-${Date.now()}`,
    items: [{name: 'Due Today Item', qty: 1, price: 500, total: 500}],
    subTotal: 500,
    grandTotal: 500,
    paidAmount: 0,
    status: 'unpaid',
    dueDate: new Date(), // Today
  }));
  
  // Upcoming bill
  bills.push(await Bill.create({
    userId,
    customerId,
    billNo: `TEST-TODAY-UPCOMING-${Date.now()}`,
    items: [{name: 'Upcoming Item', qty: 1, price: 750, total: 750}],
    subTotal: 750,
    grandTotal: 750,
    paidAmount: 0,
    status: 'unpaid',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days ahead
  }));
  
  console.log('✅ Created 3 test bills (overdue, due today, upcoming)');
  return bills;
};

// Test 1: Call Today summary and check reliabilityMeta
const testTodaySummary = async (userId) => {
  console.log('\n📝 Test 1: Today Summary with Reliability Meta');
  
  // Import controller after DB connected
  const {getTodaySummary} = require('../src/controllers/today.controller');
  
  // Mock req/res
  const req = {
    user: {_id: userId},
    query: {},
    requestId: 'test-' + Date.now(),
  };
  
  let responseData = null;
  const res = {
    success: (data) => {
      responseData = data;
    },
  };
  
  try {
    await getTodaySummary(req, res, () => {});
    
    if (!responseData) {
      console.log('❌ FAIL: No response data returned');
      return false;
    }
    
    // Check reliabilityMeta exists
    if (!responseData.reliabilityMeta) {
      console.log('❌ FAIL: reliabilityMeta missing from response');
      return false;
    }
    
    console.log('✅ PASS: reliabilityMeta present in response');
    
    // Check reliabilityMeta structure
    const meta = responseData.reliabilityMeta;
    
    if (typeof meta.ok !== 'boolean') {
      console.log('❌ FAIL: reliabilityMeta.ok is not a boolean');
      return false;
    }
    console.log(`   - ok: ${meta.ok}`);
    
    if (!Array.isArray(meta.queriesSucceeded)) {
      console.log('❌ FAIL: reliabilityMeta.queriesSucceeded is not an array');
      return false;
    }
    console.log(`   - queriesSucceeded: ${meta.queriesSucceeded.length} [${meta.queriesSucceeded.join(', ')}]`);
    
    if (!Array.isArray(meta.queriesFailed)) {
      console.log('❌ FAIL: reliabilityMeta.queriesFailed is not an array');
      return false;
    }
    console.log(`   - queriesFailed: ${meta.queriesFailed.length} [${meta.queriesFailed.join(', ')}]`);
    
    if (typeof meta.queryDurations !== 'object') {
      console.log('❌ FAIL: reliabilityMeta.queryDurations is not an object');
      return false;
    }
    console.log(`   - queryDurations:`, meta.queryDurations);
    
    // Check that we have expected queries
    const expectedQueries = ['receivable', 'overdue', 'dueToday', 'brokenPromises', 'chaseCounts'];
    for (const query of expectedQueries) {
      if (!meta.queriesSucceeded.includes(query) && !meta.queriesFailed.includes(query)) {
        console.log(`❌ FAIL: Query "${query}" not tracked in reliability meta`);
        return false;
      }
    }
    
    // Check that all queries have durations
    for (const query of expectedQueries) {
      if (!(query in meta.queryDurations)) {
        console.log(`❌ FAIL: Query "${query}" missing duration`);
        return false;
      }
      if (typeof meta.queryDurations[query] !== 'number') {
        console.log(`❌ FAIL: Query "${query}" duration is not a number`);
        return false;
      }
    }
    
    console.log('✅ PASS: All query durations tracked correctly');
    
    // Check data integrity
    if (!responseData.moneyAtRisk) {
      console.log('❌ FAIL: moneyAtRisk missing');
      return false;
    }
    
    if (!responseData.chaseCounts) {
      console.log('❌ FAIL: chaseCounts missing');
      return false;
    }
    
    if (!responseData.meta) {
      console.log('❌ FAIL: meta missing');
      return false;
    }
    
    console.log('✅ PASS: Response structure intact');
    console.log('\n📊 Response Data:');
    console.log('   Money at Risk:', responseData.moneyAtRisk);
    console.log('   Chase Counts:', responseData.chaseCounts);
    
    return true;
  } catch (error) {
    console.log('❌ FAIL: Exception thrown:', error.message);
    console.error(error.stack);
    return false;
  }
};

// Test 2: Verify fallback on query failure
const testFallbackBehavior = () => {
  console.log('\n📝 Test 2: Fallback Behavior on Query Failure');
  
  // Simulate executeQuery helper
  const reliabilityMeta = {
    ok: true,
    queriesSucceeded: [],
    queriesFailed: [],
    queryDurations: {},
  };
  
  const executeQuery = async (name, queryFn, fallbackValue) => {
    const startTime = Date.now();
    try {
      const result = await queryFn();
      const durationMs = Date.now() - startTime;
      reliabilityMeta.queriesSucceeded.push(name);
      reliabilityMeta.queryDurations[name] = durationMs;
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      reliabilityMeta.ok = false;
      reliabilityMeta.queriesFailed.push(name);
      reliabilityMeta.queryDurations[name] = durationMs;
      return fallbackValue;
    }
  };
  
  // Test successful query
  const testSuccessQuery = async () => {
    return executeQuery(
      'test-success',
      async () => ({total: 1000, count: 5}),
      {total: 0, count: 0}
    );
  };
  
  // Test failed query
  const testFailQuery = async () => {
    return executeQuery(
      'test-fail',
      async () => {
        throw new Error('Simulated failure');
      },
      {total: 0, count: 0}
    );
  };
  
  return (async () => {
    const result1 = await testSuccessQuery();
    if (result1.total === 1000 && reliabilityMeta.queriesSucceeded.includes('test-success')) {
      console.log('✅ PASS: Successful query returns correct data');
    } else {
      console.log('❌ FAIL: Successful query failed');
      return false;
    }
    
    const result2 = await testFailQuery();
    if (result2.total === 0 && result2.count === 0 && reliabilityMeta.queriesFailed.includes('test-fail')) {
      console.log('✅ PASS: Failed query returns fallback value');
    } else {
      console.log('❌ FAIL: Failed query did not return fallback');
      return false;
    }
    
    if (reliabilityMeta.ok === false) {
      console.log('✅ PASS: reliabilityMeta.ok set to false on failure');
    } else {
      console.log('❌ FAIL: reliabilityMeta.ok not set to false');
      return false;
    }
    
    console.log('   Final reliabilityMeta:', JSON.stringify(reliabilityMeta, null, 2));
    
    return true;
  })();
};

// Main test runner
const runTests = async () => {
  await connectDB();
  
  const testUser = await createTestUser();
  const testCustomer = await createTestCustomer(testUser._id);
  await createTestBills(testUser._id, testCustomer._id);
  
  const test1Pass = await testTodaySummary(testUser._id);
  const test2Pass = await testFallbackBehavior();
  
  // Restore logger
  logger.info = originalInfo;
  logger.error = originalError;
  
  // Cleanup (optional)
  // await Bill.deleteMany({userId: testUser._id, billNo: {$regex: /^TEST-TODAY-/}});
  
  await mongoose.connection.close();
  console.log('\n✅ Database connection closed');
  
  console.log('\n📊 Test Summary');
  console.log('='.repeat(50));
  console.log(`Test 1 (Today Summary): ${test1Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (Fallback Behavior): ${test2Pass ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPass = test1Pass && test2Pass;
  console.log(`\nOverall: ${allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  console.log('\n💡 Usage:');
  console.log('   GET /api/v1/today/summary');
  console.log('   Response includes reliabilityMeta with:');
  console.log('     - ok: boolean (false if any query failed)');
  console.log('     - queriesSucceeded: string[]');
  console.log('     - queriesFailed: string[]');
  console.log('     - queryDurations: { [key]: ms }');
  
  process.exit(allPass ? 0 : 1);
};

// Run tests if executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('❌ Test runner error:', error);
    process.exit(1);
  });
}

module.exports = {runTests};
