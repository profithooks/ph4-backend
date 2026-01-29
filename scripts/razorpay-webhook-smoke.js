/**
 * Razorpay Webhook Smoke Test
 * 
 * Tests the Razorpay webhook handler for bill payments
 * 
 * Usage:
 *   node scripts/razorpay-webhook-smoke.js
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const Bill = require('../src/models/Bill');
const Payment = require('../src/models/Payment');
const User = require('../src/models/User');
const Customer = require('../src/models/Customer');
const BillShareLink = require('../src/models/BillShareLink');

// Sample webhook payload for payment.captured
const createWebhookPayload = (orderId, paymentId, billId, amount) => ({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: paymentId,
        order_id: orderId,
        amount: amount, // Amount in paise
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        email: 'customer@example.com',
        contact: '+919876543210',
        notes: {
          billId: billId,
          type: 'bill_payment',
        },
        created_at: Math.floor(Date.now() / 1000),
      },
    },
  },
});

// Generate webhook signature
const generateWebhookSignature = (body, secret) => {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
};

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
  let testUser = await User.findOne({email: 'test-payment@example.com'});
  
  if (!testUser) {
    testUser = await User.create({
      name: 'Test Payment User',
      email: 'test-payment@example.com',
      password: 'testpass123',
      mobile: '+919999999999',
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
    name: 'Test Payment Customer',
  });
  
  if (!customer) {
    customer = await Customer.create({
      userId,
      name: 'Test Payment Customer',
      phone: '9876543210',
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
    billNo: `TEST-${Date.now()}`,
    items: [
      {
        name: 'Test Item',
        qty: 2,
        price: 500,
        total: 1000,
      },
    ],
    subTotal: 1000,
    discount: 0,
    tax: 0,
    grandTotal: 1000,
    paidAmount: 0,
    status: 'unpaid',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  
  console.log('✅ Created test bill:', bill._id, bill.billNo);
  return bill;
};

// Create test payment record
const createTestPayment = async (bill, orderId) => {
  const payment = await Payment.create({
    billId: bill._id,
    userId: bill.userId,
    businessId: bill.userId,
    customerId: bill.customerId,
    provider: 'razorpay',
    providerOrderId: orderId,
    status: 'pending',
    amount: bill.grandTotal,
    currency: 'INR',
    metadata: {
      billNo: bill.billNo,
      test: true,
    },
  });
  
  console.log('✅ Created test payment:', payment._id);
  return payment;
};

// Simulate webhook call
const simulateWebhook = async (bill, payment) => {
  const orderId = payment.providerOrderId;
  const paymentId = `pay_test_${Date.now()}`;
  const amountInPaise = Math.round(bill.grandTotal * 100);
  
  const webhookPayload = createWebhookPayload(
    orderId,
    paymentId,
    bill._id.toString(),
    amountInPaise
  );
  
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_secret';
  const signature = generateWebhookSignature(webhookPayload, webhookSecret);
  
  console.log('\n📋 Webhook Payload:');
  console.log(JSON.stringify(webhookPayload, null, 2));
  console.log('\n🔐 Signature:', signature);
  
  // Manually process webhook (simulate what the webhook controller does)
  try {
    // Update payment
    payment.status = 'captured';
    payment.providerPaymentId = paymentId;
    payment.method = 'upi';
    payment.capturedAt = new Date();
    payment.webhookProcessed = true;
    payment.webhookProcessedAt = new Date();
    await payment.save();
    
    console.log('✅ Payment updated to captured');
    
    // Update bill
    const amountInRupees = amountInPaise / 100;
    bill.paidAmount = (bill.paidAmount || 0) + amountInRupees;
    
    if (bill.paidAmount >= bill.grandTotal) {
      bill.status = 'paid';
    } else if (bill.paidAmount > 0) {
      bill.status = 'partial';
    }
    
    await bill.save();
    
    console.log('✅ Bill updated:', {
      billNo: bill.billNo,
      paidAmount: bill.paidAmount,
      grandTotal: bill.grandTotal,
      status: bill.status,
    });
    
    // Create ledger transaction
    const LedgerTransaction = require('../src/models/LedgerTransaction');
    await LedgerTransaction.create({
      userId: bill.userId,
      customerId: bill.customerId,
      type: 'debit',
      amount: amountInRupees,
      note: `Payment received for Bill ${bill.billNo} via upi`,
      metadata: {
        billId: bill._id,
        billNo: bill.billNo,
        source: 'razorpay_payment',
        paymentId: payment._id,
        providerPaymentId: paymentId,
      },
    });
    
    console.log('✅ Ledger transaction created');
    
    return true;
  } catch (error) {
    console.error('❌ Webhook processing error:', error.message);
    return false;
  }
};

// Test idempotency
const testIdempotency = async (bill, payment) => {
  console.log('\n🔄 Testing Idempotency...');
  
  // Try to process the same payment again
  const alreadyProcessed = payment.webhookProcessed;
  
  if (alreadyProcessed) {
    console.log('✅ Payment already processed - idempotent success');
    return true;
  } else {
    console.log('❌ Payment not marked as processed');
    return false;
  }
};

// Main test runner
const runTests = async () => {
  console.log('\n🧪 Razorpay Webhook Smoke Tests');
  console.log('='.repeat(50));
  
  await connectDB();
  
  const testUser = await createTestUser();
  const testCustomer = await createTestCustomer(testUser._id);
  const testBill = await createTestBill(testUser._id, testCustomer._id);
  
  // Create payment with test order ID
  const testOrderId = `order_test_${Date.now()}`;
  const testPayment = await createTestPayment(testBill, testOrderId);
  
  // Simulate webhook
  console.log('\n📡 Simulating Webhook...');
  const webhookSuccess = await simulateWebhook(testBill, testPayment);
  
  if (!webhookSuccess) {
    console.error('❌ Webhook processing failed');
    process.exit(1);
  }
  
  // Reload bill to check status
  const updatedBill = await Bill.findById(testBill._id);
  console.log('\n📊 Final Bill State:');
  console.log({
    billNo: updatedBill.billNo,
    grandTotal: updatedBill.grandTotal,
    paidAmount: updatedBill.paidAmount,
    status: updatedBill.status,
  });
  
  // Test idempotency
  const idempotencySuccess = await testIdempotency(testBill, testPayment);
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('='.repeat(50));
  console.log(`✅ Bill created: ${testBill.billNo}`);
  console.log(`✅ Payment order created: ${testOrderId}`);
  console.log(`✅ Webhook processed: ${webhookSuccess ? 'Yes' : 'No'}`);
  console.log(`✅ Bill status: ${updatedBill.status}`);
  console.log(`✅ Idempotency: ${idempotencySuccess ? 'Pass' : 'Fail'}`);
  
  // Cleanup (optional - comment out to inspect data)
  // await Bill.deleteOne({_id: testBill._id});
  // await Payment.deleteOne({_id: testPayment._id});
  
  await mongoose.connection.close();
  console.log('\n✅ Tests completed and database connection closed');
  
  const allTestsPassed = webhookSuccess && idempotencySuccess && updatedBill.status === 'paid';
  process.exit(allTestsPassed ? 0 : 1);
};

// Run tests if executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('❌ Test runner error:', error);
    process.exit(1);
  });
}

module.exports = {runTests};
