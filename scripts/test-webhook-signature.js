/**
 * Webhook Signature Verification Test
 * 
 * Tests Razorpay webhook signature verification
 * 
 * Usage:
 *   node scripts/test-webhook-signature.js
 */

const crypto = require('crypto');
const {verifyWebhookSignature} = require('../src/utils/razorpayWebhook');

console.log('\n🧪 Webhook Signature Verification Tests');
console.log('='.repeat(50));

// Test data
const testSecret = 'test_webhook_secret_12345';
const testPayload = {
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_test123',
        order_id: 'order_test123',
        amount: 100000,
        currency: 'INR',
        status: 'captured',
        notes: {
          billId: '507f1f77bcf86cd799439011',
          type: 'bill_payment',
        },
      },
    },
  },
};

const testPayloadString = JSON.stringify(testPayload);

// Generate valid signature
function generateSignature(body, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
}

// Test 1: Valid signature
console.log('\n📝 Test 1: Valid Signature');
const validSignature = generateSignature(testPayloadString, testSecret);
const isValid = verifyWebhookSignature(testPayloadString, validSignature, testSecret);

if (isValid) {
  console.log('✅ PASS: Valid signature accepted');
} else {
  console.log('❌ FAIL: Valid signature rejected');
  process.exit(1);
}

// Test 2: Invalid signature
console.log('\n📝 Test 2: Invalid Signature');
const invalidSignature = 'invalid_signature_12345';
const isInvalid = verifyWebhookSignature(testPayloadString, invalidSignature, testSecret);

if (!isInvalid) {
  console.log('✅ PASS: Invalid signature rejected');
} else {
  console.log('❌ FAIL: Invalid signature accepted');
  process.exit(1);
}

// Test 3: Tampered payload
console.log('\n📝 Test 3: Tampered Payload');
const tamperedPayload = JSON.stringify({
  ...testPayload,
  payload: {
    ...testPayload.payload,
    payment: {
      ...testPayload.payload.payment,
      entity: {
        ...testPayload.payload.payment.entity,
        amount: 500000, // Changed amount
      },
    },
  },
});

const isTamperedInvalid = verifyWebhookSignature(tamperedPayload, validSignature, testSecret);

if (!isTamperedInvalid) {
  console.log('✅ PASS: Tampered payload rejected');
} else {
  console.log('❌ FAIL: Tampered payload accepted');
  process.exit(1);
}

// Test 4: Wrong secret
console.log('\n📝 Test 4: Wrong Secret');
const wrongSecret = 'wrong_secret_12345';
const isWrongSecret = verifyWebhookSignature(testPayloadString, validSignature, wrongSecret);

if (!isWrongSecret) {
  console.log('✅ PASS: Wrong secret rejected');
} else {
  console.log('❌ FAIL: Wrong secret accepted');
  process.exit(1);
}

// Test 5: Empty body
console.log('\n📝 Test 5: Empty Body');
const emptyBodySignature = generateSignature('', testSecret);
const isEmptyValid = verifyWebhookSignature('', emptyBodySignature, testSecret);

if (isEmptyValid) {
  console.log('✅ PASS: Empty body signature works (edge case)');
} else {
  console.log('❌ FAIL: Empty body signature failed');
  process.exit(1);
}

// Test 6: Real-world example payload
console.log('\n📝 Test 6: Real-world Example Payload');
const realWorldPayload = {
  entity: 'event',
  account_id: 'acc_test123',
  event: 'payment.captured',
  contains: ['payment'],
  payload: {
    payment: {
      entity: {
        id: 'pay_MfGaEUx1234567',
        entity: 'payment',
        amount: 100000,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_MfGaEUx1234567',
        invoice_id: null,
        international: false,
        method: 'upi',
        amount_refunded: 0,
        refund_status: null,
        captured: true,
        description: 'Payment for Bill INV-001',
        card_id: null,
        bank: null,
        wallet: null,
        vpa: 'test@razorpay',
        email: 'customer@example.com',
        contact: '+919876543210',
        notes: {
          billId: '507f1f77bcf86cd799439011',
          billNo: 'INV-001',
          type: 'bill_payment',
        },
        fee: 2360,
        tax: 360,
        error_code: null,
        error_description: null,
        error_source: null,
        error_step: null,
        error_reason: null,
        acquirer_data: {
          rrn: '123456789012',
        },
        created_at: 1672531200,
      },
    },
  },
  created_at: 1672531205,
};

const realWorldPayloadString = JSON.stringify(realWorldPayload);
const realWorldSignature = generateSignature(realWorldPayloadString, testSecret);
const isRealWorldValid = verifyWebhookSignature(
  realWorldPayloadString,
  realWorldSignature,
  testSecret
);

if (isRealWorldValid) {
  console.log('✅ PASS: Real-world payload signature verified');
} else {
  console.log('❌ FAIL: Real-world payload signature failed');
  process.exit(1);
}

// Summary
console.log('\n📊 Test Summary');
console.log('='.repeat(50));
console.log('✅ All signature verification tests passed');
console.log('\n💡 Usage Notes:');
console.log('   1. Set RAZORPAY_WEBHOOK_SECRET in .env');
console.log('   2. Webhook endpoint: POST /webhooks/razorpay');
console.log('   3. Signature header: x-razorpay-signature');
console.log('   4. Body must be raw (not JSON-parsed) for verification');
console.log('\n🔐 Signature Algorithm:');
console.log('   HMAC SHA-256 of raw request body using webhook secret');
console.log('\n📝 Example cURL:');
console.log('   curl -X POST http://localhost:5055/webhooks/razorpay \\');
console.log('     -H "Content-Type: application/json" \\');
console.log('     -H "x-razorpay-signature: <generated_signature>" \\');
console.log('     -d \'{"event":"payment.captured","payload":{...}}\'');

process.exit(0);
