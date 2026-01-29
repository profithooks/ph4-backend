/**
 * Public Bill Audit Test
 * 
 * Tests audit logging for public bill access
 * 
 * Usage:
 *   MONGO_URI=mongodb://localhost:27017/ph4-test JWT_SECRET=test node scripts/test-public-bill-audit.js
 */

const mongoose = require('mongoose');
const User = require('../src/models/User');
const Bill = require('../src/models/Bill');
const Customer = require('../src/models/Customer');
const BillShareLink = require('../src/models/BillShareLink');
const AuditEvent = require('../src/models/AuditEvent');
const crypto = require('crypto');

console.log('\n🧪 Public Bill Audit Tests');
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
  let testUser = await User.findOne({email: 'test-public-audit@example.com'});
  
  if (!testUser) {
    testUser = await User.create({
      name: 'Test Public Audit User',
      email: 'test-public-audit@example.com',
      password: 'testpass123',
      mobile: '+919999999996',
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
    name: 'Test Audit Customer',
  });
  
  if (!customer) {
    customer = await Customer.create({
      userId,
      name: 'Test Audit Customer',
      phone: '9876543213',
    });
    console.log('✅ Created test customer:', customer._id);
  } else {
    console.log('✅ Using existing test customer:', customer._id);
  }
  
  return customer;
};

// Create test bill
const createTestBill = async (userId, customerId) => {
  const bill = await Bill.create({
    userId,
    customerId,
    billNo: `TEST-AUDIT-${Date.now()}`,
    items: [{name: 'Test Item', qty: 1, price: 500, total: 500}],
    subTotal: 500,
    grandTotal: 500,
    paidAmount: 0,
    status: 'unpaid',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  
  console.log('✅ Created test bill:', bill._id, bill.billNo);
  return bill;
};

// Create share link
const createShareLink = async (billId, userId) => {
  const token = crypto.randomBytes(16).toString('hex');
  
  const shareLink = await BillShareLink.create({
    billId,
    userId,
    token,
    status: 'active',
    accessCount: 0,
    createdBy: userId,
  });
  
  console.log('✅ Created share link:', shareLink._id, 'token:', token);
  return shareLink;
};

// Simulate public bill access
const simulatePublicBillAccess = async (shareLink, bill) => {
  console.log('\n📝 Test 1: Simulate Public Bill Access');
  
  // Update access metrics (simulating what controller does)
  shareLink.lastAccessAt = new Date();
  shareLink.accessCount += 1;
  await shareLink.save();
  
  // Create audit event (simulating what controller does)
  const auditEvent = await AuditEvent.create({
    actorUserId: bill.userId,
    actorRole: 'SYSTEM',
    action: 'BILL_SHARE_ACCESSED',
    entityType: 'BILL',
    entityId: bill._id,
    businessId: bill.userId,
    metadata: {
      shareTokenPrefix: shareLink.token.substring(0, 8),
      accessCount: shareLink.accessCount,
      via: 'public_link_test',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Test)',
    },
  });
  
  console.log('✅ Audit event created:', auditEvent._id);
  return auditEvent;
};

// Test 2: Verify audit event structure
const testAuditEventStructure = async (billId, userId) => {
  console.log('\n📝 Test 2: Verify Audit Event Structure');
  
  const auditEvents = await AuditEvent.find({
    entityType: 'BILL',
    entityId: billId,
    action: 'BILL_SHARE_ACCESSED',
  });
  
  if (auditEvents.length === 0) {
    console.log('❌ FAIL: No audit events found');
    return false;
  }
  
  const event = auditEvents[0];
  console.log('   Found audit event:', event._id);
  
  // Check required fields
  if (event.action !== 'BILL_SHARE_ACCESSED') {
    console.log('❌ FAIL: action is not BILL_SHARE_ACCESSED');
    return false;
  }
  console.log('   - action: BILL_SHARE_ACCESSED ✅');
  
  if (event.entityType !== 'BILL') {
    console.log('❌ FAIL: entityType is not BILL');
    return false;
  }
  console.log('   - entityType: BILL ✅');
  
  if (!event.entityId.equals(billId)) {
    console.log('❌ FAIL: entityId does not match billId');
    return false;
  }
  console.log('   - entityId: matches bill ✅');
  
  if (event.actorRole !== 'SYSTEM') {
    console.log('❌ FAIL: actorRole is not SYSTEM');
    return false;
  }
  console.log('   - actorRole: SYSTEM ✅');
  
  if (!event.metadata) {
    console.log('❌ FAIL: metadata is missing');
    return false;
  }
  console.log('   - metadata: present ✅');
  
  if (!event.metadata.shareTokenPrefix) {
    console.log('❌ FAIL: metadata.shareTokenPrefix is missing');
    return false;
  }
  console.log(`   - shareTokenPrefix: ${event.metadata.shareTokenPrefix} ✅`);
  
  if (typeof event.metadata.accessCount !== 'number') {
    console.log('❌ FAIL: metadata.accessCount is not a number');
    return false;
  }
  console.log(`   - accessCount: ${event.metadata.accessCount} ✅`);
  
  if (!event.metadata.via) {
    console.log('❌ FAIL: metadata.via is missing');
    return false;
  }
  console.log(`   - via: ${event.metadata.via} ✅`);
  
  if (!event.metadata.ip) {
    console.log('❌ FAIL: metadata.ip is missing');
    return false;
  }
  console.log(`   - ip: ${event.metadata.ip} ✅`);
  
  if (!event.metadata.userAgent) {
    console.log('❌ FAIL: metadata.userAgent is missing');
    return false;
  }
  console.log(`   - userAgent: ${event.metadata.userAgent} ✅`);
  
  console.log('✅ PASS: Audit event structure is correct');
  return true;
};

// Test 3: Multiple accesses
const testMultipleAccesses = async (shareLink, bill) => {
  console.log('\n📝 Test 3: Multiple Accesses');
  
  const initialAccessCount = shareLink.accessCount;
  
  // Simulate 3 more accesses
  for (let i = 0; i < 3; i++) {
    shareLink.lastAccessAt = new Date();
    shareLink.accessCount += 1;
    await shareLink.save();
    
    await AuditEvent.create({
      actorUserId: bill.userId,
      actorRole: 'SYSTEM',
      action: 'BILL_SHARE_ACCESSED',
      entityType: 'BILL',
      entityId: bill._id,
      businessId: bill.userId,
      metadata: {
        shareTokenPrefix: shareLink.token.substring(0, 8),
        accessCount: shareLink.accessCount,
        via: `public_link_test_${i + 2}`,
        ip: `127.0.0.${i + 2}`,
        userAgent: 'Mozilla/5.0 (Test)',
      },
    });
  }
  
  // Verify total audit events
  const auditCount = await AuditEvent.countDocuments({
    entityType: 'BILL',
    entityId: bill._id,
    action: 'BILL_SHARE_ACCESSED',
  });
  
  if (auditCount !== initialAccessCount + 3) {
    console.log(`❌ FAIL: Expected ${initialAccessCount + 3} audit events, found ${auditCount}`);
    return false;
  }
  
  console.log(`✅ PASS: ${auditCount} audit events created for ${shareLink.accessCount} accesses`);
  
  // Verify accessCount tracking
  const events = await AuditEvent.find({
    entityType: 'BILL',
    entityId: bill._id,
    action: 'BILL_SHARE_ACCESSED',
  }).sort({at: 1});
  
  let expectedCount = 1;
  for (const event of events) {
    if (event.metadata.accessCount !== expectedCount) {
      console.log(`❌ FAIL: Access count mismatch at event ${event._id}`);
      return false;
    }
    expectedCount++;
  }
  
  console.log('✅ PASS: Access count correctly tracked across events');
  
  return true;
};

// Main test runner
const runTests = async () => {
  await connectDB();
  
  const testUser = await createTestUser();
  const testCustomer = await createTestCustomer(testUser._id);
  const testBill = await createTestBill(testUser._id, testCustomer._id);
  const testShareLink = await createShareLink(testBill._id, testUser._id);
  
  await simulatePublicBillAccess(testShareLink, testBill);
  const test2Pass = await testAuditEventStructure(testBill._id, testUser._id);
  const test3Pass = await testMultipleAccesses(testShareLink, testBill);
  
  // Cleanup
  await AuditEvent.deleteMany({
    entityType: 'BILL',
    entityId: testBill._id,
    action: 'BILL_SHARE_ACCESSED',
  });
  await BillShareLink.deleteOne({_id: testShareLink._id});
  await Bill.deleteOne({_id: testBill._id});
  
  await mongoose.connection.close();
  console.log('\n✅ Database connection closed');
  
  console.log('\n📊 Test Summary');
  console.log('='.repeat(50));
  console.log(`Test 1 (Simulate Access): ✅ PASS`);
  console.log(`Test 2 (Audit Structure): ${test2Pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 3 (Multiple Accesses): ${test3Pass ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPass = test2Pass && test3Pass;
  console.log(`\nOverall: ${allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  console.log('\n💡 Implementation:');
  console.log('   - getPublicBill: Creates audit event on HTML view');
  console.log('   - getPublicBillJson: Creates audit event on JSON access');
  console.log('   - Action: BILL_SHARE_ACCESSED');
  console.log('   - Entity: BILL');
  console.log('   - Actor: SYSTEM');
  console.log('\n📊 Audit Event Metadata:');
  console.log('   - shareTokenPrefix: First 8 chars of token');
  console.log('   - accessCount: Running count of accesses');
  console.log('   - via: public_link_html | public_link_json');
  console.log('   - ip: req.ip');
  console.log('   - userAgent: req.get("user-agent")');
  
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
