#!/usr/bin/env node
/**
 * Smoke Test: Dual-Mode Backend Verification
 * Tests recovery + followup endpoints with idempotency checks
 */

const axios = require('axios');
const mongoose = require('mongoose');

// Config
const BASE_URL = process.env.BASE_URL || 'http://localhost:5055';
const SMOKE_EMAIL = process.env.SMOKE_EMAIL || 'test@example.com';
const SMOKE_PASS = process.env.SMOKE_PASS || 'password123';
const SMOKE_TOKEN = process.env.SMOKE_TOKEN;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ph4';

let authToken = null;
let testUserId = null;
let testCustomerId = null;
let testCaseId = null;

// Test results
const results = [];
let exitCode = 0;

function pass(step) {
  console.log(`✅ PASS: ${step}`);
  results.push({step, status: 'PASS'});
}

function fail(step, error) {
  console.log(`❌ FAIL: ${step}`);
  console.log(`   Error: ${error}`);
  results.push({step, status: 'FAIL', error});
  exitCode = 1;
}

async function setup() {
  // Check if backend is running
  try {
    await axios.get(`${BASE_URL}/api/health`, {timeout: 2000});
    pass('Setup: Backend is running');
  } catch (err) {
    fail('Setup: Backend not running', `Start backend first: npm run dev`);
    process.exit(1);
  }

  // Get auth token
  if (SMOKE_TOKEN) {
    authToken = SMOKE_TOKEN;
    // Decode JWT to get userId
    try {
      const payload = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64').toString());
      testUserId = payload.id || payload._id || payload.userId;
      pass('Setup: Using SMOKE_TOKEN');
    } catch (err) {
      fail('Setup: Decode SMOKE_TOKEN', err.message);
      process.exit(1);
    }
  } else {
    // Try to signup then login
    try {
      // Try signup first (might fail if exists)
      try {
        await axios.post(`${BASE_URL}/api/auth/signup`, {
          email: SMOKE_EMAIL,
          password: SMOKE_PASS,
          name: 'Smoke Test User',
        });
      } catch (signupErr) {
        // User might already exist, continue to login
      }

      // Login
      const res = await axios.post(`${BASE_URL}/api/auth/login`, {
        email: SMOKE_EMAIL,
        password: SMOKE_PASS,
      });
      authToken = res.data.token;
      testUserId = res.data.user?._id || res.data.user?.id;
      pass('Setup: Login');
    } catch (err) {
      fail('Setup: Auth failed', 'Set SMOKE_TOKEN env var or check auth endpoints');
      process.exit(1);
    }
  }

  if (!testUserId) {
    fail('Setup: Extract userId', 'Could not determine userId from token');
    process.exit(1);
  }

  // Create test customer
  try {
    const res = await axios.post(
      `${BASE_URL}/api/customers`,
      {
        name: 'Smoke Test Customer',
        phone: '9999999999',
      },
      {
        headers: {Authorization: `Bearer ${authToken}`},
      },
    );
    testCustomerId = res.data.data._id || res.data.data.id;
    pass('Setup: Create test customer');
  } catch (err) {
    fail('Setup: Create customer', err.response?.data?.error || err.message);
    process.exit(1);
  }

  // Connect to MongoDB
  try {
    await mongoose.connect(MONGO_URI);
    pass('Setup: MongoDB connection');
  } catch (err) {
    fail('Setup: MongoDB connection', err.message);
    process.exit(1);
  }
}

async function testHealth() {
  try {
    const res = await axios.get(`${BASE_URL}/api/health`);
    if (res.status === 200 && res.data.ok) {
      pass('Health endpoint');
    } else {
      fail('Health endpoint', `Unexpected response: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    fail('Health endpoint', err.message);
  }
}

async function testRecoveryList() {
  try {
    const res = await axios.get(`${BASE_URL}/api/recovery`, {
      headers: {Authorization: `Bearer ${authToken}`},
    });
    if (res.status === 200 && Array.isArray(res.data.data)) {
      pass('Recovery list');
    } else {
      fail('Recovery list', 'Expected 200 with array data');
    }
  } catch (err) {
    fail('Recovery list', err.response?.data?.error || err.message);
  }
}

async function testFollowupList() {
  try {
    const res = await axios.get(`${BASE_URL}/api/followups`, {
      headers: {Authorization: `Bearer ${authToken}`},
    });
    if (res.status === 200 && Array.isArray(res.data.data)) {
      pass('Followup list');
    } else {
      fail('Followup list', 'Expected 200 with array data');
    }
  } catch (err) {
    fail('Followup list', err.response?.data?.error || err.message);
  }
}

async function testRecoveryOpen() {
  const payload = {
    customerId: testCustomerId,
    outstandingSnapshot: 1000,
    notes: 'Smoke test recovery case',
  };
  const headers = {
    Authorization: `Bearer ${authToken}`,
    'Idempotency-Key': 'smoke_recovery_open_1',
    'X-Request-Id': 'smoke:recovery:open:1',
  };

  try {
    // First request
    const res1 = await axios.post(`${BASE_URL}/api/recovery/open`, payload, {headers});
    if (res1.status === 201 || res1.status === 200) {
      testCaseId = res1.data.data._id || res1.data.data.id;
      pass('Recovery open (first)');
    } else {
      fail('Recovery open (first)', `Unexpected status: ${res1.status}`);
      return;
    }

    // Replay with same idempotency key
    const res2 = await axios.post(`${BASE_URL}/api/recovery/open`, payload, {headers});
    if (res2.status === 200) {
      const returnedId = res2.data.data._id || res2.data.data.id;
      if (returnedId === testCaseId) {
        pass('Recovery open (replay idempotent)');
      } else {
        fail('Recovery open (replay)', 'Returned different case ID');
      }
    } else {
      fail('Recovery open (replay)', `Expected 200, got ${res2.status}`);
    }
  } catch (err) {
    fail('Recovery open', err.response?.data?.error || err.message);
  }
}

async function testRecoveryPromise() {
  if (!testCaseId) {
    fail('Recovery promise', 'No testCaseId from previous step');
    return;
  }

  const payload = {
    caseId: testCaseId,
    promiseAt: new Date(Date.now() + 86400000).toISOString(),
    notes: 'Smoke test promise',
  };
  const headers = {
    Authorization: `Bearer ${authToken}`,
    'Idempotency-Key': 'smoke_recovery_promise_1',
    'X-Request-Id': 'smoke:recovery:promise:1',
  };

  try {
    // First request
    const res1 = await axios.post(`${BASE_URL}/api/recovery/promise`, payload, {headers});
    if (res1.status === 200) {
      pass('Recovery promise (first)');
    } else {
      fail('Recovery promise (first)', `Unexpected status: ${res1.status}`);
      return;
    }

    // Replay with same idempotency key
    const res2 = await axios.post(`${BASE_URL}/api/recovery/promise`, payload, {headers});
    if (res2.status === 200) {
      pass('Recovery promise (replay idempotent)');
    } else {
      fail('Recovery promise (replay)', `Expected 200, got ${res2.status}`);
    }
  } catch (err) {
    fail('Recovery promise', err.response?.data?.error || err.message);
  }
}

async function testFollowupCreate() {
  const payload = {
    customerId: testCustomerId,
    channel: 'call',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    balance: 1000,
    note: 'Smoke test followup',
  };
  const headers = {
    Authorization: `Bearer ${authToken}`,
    'Idempotency-Key': 'smoke_followup_create_1',
    'X-Request-Id': 'smoke:followup:create:1',
  };

  try {
    // First request
    const res1 = await axios.post(`${BASE_URL}/api/followups`, payload, {headers});
    if (res1.status === 201 || res1.status === 200) {
      pass('Followup create (first)');
    } else {
      fail('Followup create (first)', `Unexpected status: ${res1.status}`);
      return;
    }

    // Replay with same idempotency key
    const res2 = await axios.post(`${BASE_URL}/api/followups`, payload, {headers});
    if (res2.status === 200) {
      pass('Followup create (replay idempotent)');
    } else {
      fail('Followup create (replay)', `Expected 200, got ${res2.status}`);
    }
  } catch (err) {
    fail('Followup create', err.response?.data?.error || err.message);
  }
}

async function verifyDB() {
  try {
    const RecoveryCase = mongoose.model('RecoveryCase', new mongoose.Schema({}, {strict: false}));
    const RecoveryEvent = mongoose.model('RecoveryEvent', new mongoose.Schema({}, {strict: false}));
    const FollowUpTask = mongoose.model('FollowUpTask', new mongoose.Schema({}, {strict: false}));

    // Check RecoveryCase
    const caseCount = await RecoveryCase.countDocuments({
      idempotencyKey: 'smoke_recovery_open_1',
      userId: testUserId,
    });
    if (caseCount === 1) {
      pass('DB: RecoveryCase idempotency (1 record)');
    } else {
      fail('DB: RecoveryCase idempotency', `Expected 1 record, found ${caseCount}`);
    }

    // Check RecoveryEvent
    const eventCount = await RecoveryEvent.countDocuments({
      idempotencyKey: 'smoke_recovery_promise_1',
      userId: testUserId,
    });
    if (eventCount === 1) {
      pass('DB: RecoveryEvent idempotency (1 record)');
    } else {
      fail('DB: RecoveryEvent idempotency', `Expected 1 record, found ${eventCount}`);
    }

    // Check FollowUpTask
    const taskCount = await FollowUpTask.countDocuments({
      idempotencyKey: 'smoke_followup_create_1',
      userId: testUserId,
    });
    if (taskCount === 1) {
      pass('DB: FollowUpTask idempotency (1 record)');
    } else {
      fail('DB: FollowUpTask idempotency', `Expected 1 record, found ${taskCount}`);
    }
  } catch (err) {
    fail('DB verification', err.message);
  }
}

async function testBillCreate() {
  try {
    const res = await axios.post(
      `${BASE_URL}/api/bills`,
      {
        customerId: testCustomerId,
        items: [
          {name: 'Product A', qty: 2, price: 1000, total: 2000},
          {name: 'Product B', qty: 3, price: 1000, total: 3000},
        ],
        subTotal: 5000,
        discount: 0,
        tax: 0,
        grandTotal: 5000,
        paidAmount: 0,
        notes: 'Smoke test bill',
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Idempotency-Key': 'smoke_bill_create_1',
          'X-Request-Id': 'smoke:bill:create:1',
        },
      },
    );
    
    if (res.status === 201 && res.data.success) {
      pass('Bill: Create bill (₹5000, unpaid)');
      return res.data.data._id;
    } else {
      fail('Bill: Create bill', `Unexpected response status ${res.status}`);
      return null;
    }
  } catch (err) {
    fail('Bill: Create bill', err.response?.data?.error || err.message);
    return null;
  }
}

async function testBillCreateIdempotency(billId) {
  try {
    const res = await axios.post(
      `${BASE_URL}/api/bills`,
      {
        customerId: testCustomerId,
        items: [
          {name: 'Product A', qty: 2, price: 1000, total: 2000},
          {name: 'Product B', qty: 3, price: 1000, total: 3000},
        ],
        subTotal: 5000,
        discount: 0,
        tax: 0,
        grandTotal: 5000,
        paidAmount: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Idempotency-Key': 'smoke_bill_create_1',
          'X-Request-Id': 'smoke:bill:create:1:replay',
        },
      },
    );
    
    if (res.status === 200 && res.data.data._id === billId) {
      pass('Bill: Create idempotency (same bill returned)');
    } else {
      fail('Bill: Create idempotency', 'Different bill returned on replay');
    }
  } catch (err) {
    fail('Bill: Create idempotency', err.response?.data?.error || err.message);
  }
}

async function testBillLedgerCredit() {
  try {
    // Connect to DB
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGO_URI);
    }
    
    const LedgerTransaction = mongoose.model('LedgerTransaction');
    
    // Find ledger credit for bill
    const ledgerTx = await LedgerTransaction.findOne({
      userId: testUserId,
      customerId: testCustomerId,
      type: 'credit',
      'metadata.source': 'bill_create',
    });
    
    if (ledgerTx && ledgerTx.amount === 5000) {
      pass('Bill: Auto-created ledger CREDIT ₹5000');
    } else if (!ledgerTx) {
      fail('Bill: Auto-created ledger CREDIT', 'Ledger transaction not found');
    } else {
      fail('Bill: Auto-created ledger CREDIT', `Expected ₹5000, found ₹${ledgerTx.amount}`);
    }
  } catch (err) {
    fail('Bill: Auto-created ledger CREDIT', err.message);
  }
}

async function testBillPayment(billId) {
  try {
    const res = await axios.patch(
      `${BASE_URL}/api/bills/${billId}/pay`,
      {
        amount: 2000,
        note: 'Partial payment',
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Idempotency-Key': 'smoke_bill_pay_1',
          'X-Request-Id': 'smoke:bill:pay:1',
        },
      },
    );
    
    if (res.status === 200 && res.data.data.paidAmount === 2000 && res.data.data.status === 'partial') {
      pass('Bill: Add payment ₹2000 (status → partial)');
    } else {
      fail('Bill: Add payment', `Expected paidAmount=2000, status=partial, got ${res.data.data.paidAmount}, ${res.data.data.status}`);
    }
  } catch (err) {
    fail('Bill: Add payment', err.response?.data?.error || err.message);
  }
}

async function testBillPaymentIdempotency(billId) {
  try {
    const res = await axios.patch(
      `${BASE_URL}/api/bills/${billId}/pay`,
      {
        amount: 2000,
        note: 'Partial payment',
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Idempotency-Key': 'smoke_bill_pay_1',
          'X-Request-Id': 'smoke:bill:pay:1:replay',
        },
      },
    );
    
    if (res.status === 200 && res.data.data.paidAmount === 2000) {
      pass('Bill: Payment idempotency (paidAmount still 2000)');
    } else {
      fail('Bill: Payment idempotency', `Expected paidAmount=2000, got ${res.data.data.paidAmount}`);
    }
  } catch (err) {
    fail('Bill: Payment idempotency', err.response?.data?.error || err.message);
  }
}

async function testBillLedgerDebit() {
  try {
    // Connect to DB
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGO_URI);
    }
    
    const LedgerTransaction = mongoose.model('LedgerTransaction');
    
    // Find ledger debit for payment
    const ledgerTx = await LedgerTransaction.findOne({
      userId: testUserId,
      customerId: testCustomerId,
      type: 'debit',
      'metadata.source': 'bill_payment',
    });
    
    if (ledgerTx && ledgerTx.amount === 2000) {
      pass('Bill: Auto-created ledger DEBIT ₹2000');
    } else if (!ledgerTx) {
      fail('Bill: Auto-created ledger DEBIT', 'Ledger transaction not found');
    } else {
      fail('Bill: Auto-created ledger DEBIT', `Expected ₹2000, found ₹${ledgerTx.amount}`);
    }
  } catch (err) {
    fail('Bill: Auto-created ledger DEBIT', err.message);
  }
}

async function cleanup() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
}

async function main() {
  console.log('========================================');
  console.log('SMOKE TEST: Dual-Mode Backend');
  console.log('========================================\n');

  await setup();
  await testHealth();
  await testRecoveryList();
  await testFollowupList();
  await testRecoveryOpen();
  await testRecoveryPromise();
  await testFollowupCreate();
  
  // Billing tests
  const billId = await testBillCreate();
  if (billId) {
    await testBillCreateIdempotency(billId);
    await testBillLedgerCredit();
    await testBillPayment(billId);
    await testBillPaymentIdempotency(billId);
    await testBillLedgerDebit();
  }
  
  await verifyDB();
  await cleanup();

  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  
  if (exitCode === 0) {
    console.log('\n✅ ALL TESTS PASSED\n');
  } else {
    console.log('\n❌ SOME TESTS FAILED\n');
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR:', err.message);
  process.exit(1);
});
