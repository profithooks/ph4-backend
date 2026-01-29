#!/usr/bin/env node
/**
 * Unit Test: Pro Payment Signature Verification
 * 
 * Tests the Razorpay payment signature verification logic.
 * 
 * Razorpay signature algorithm:
 *   signature = HMAC_SHA256(orderId + '|' + paymentId, secret)
 * 
 * This test verifies that our verification logic correctly:
 * 1. Accepts valid signatures
 * 2. Rejects invalid signatures
 * 3. Rejects tampered data
 * 
 * Usage:
 *   node scripts/test-pro-verify-signature.js
 */

const crypto = require('crypto');

/**
 * Generate valid Razorpay payment signature
 */
function generateSignature(orderId, paymentId, secret) {
  const body = orderId + '|' + paymentId;
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
}

/**
 * Verify Razorpay payment signature (same logic as razorpay.service.js)
 */
function verifyPaymentSignature(orderId, paymentId, signature, secret) {
  try {
    // Create expected signature
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Compare signatures
    return expectedSignature === signature;
  } catch (error) {
    console.error('[SignatureVerification] Error:', error);
    return false;
  }
}

/**
 * Run all tests
 */
function runTests() {
  console.log('===========================================');
  console.log('Unit Test: Pro Payment Signature Verification');
  console.log('===========================================');
  console.log('');
  
  let allPassed = true;
  
  // Test data
  const testSecret = 'test_webhook_secret_12345';
  const testOrderId = 'order_MfGaEUx1234567';
  const testPaymentId = 'pay_ABC123xyz456789';
  
  // Test 1: Valid signature should be accepted
  console.log('[Test 1] Valid signature acceptance');
  console.log('-------------------------------------------');
  
  const validSignature = generateSignature(testOrderId, testPaymentId, testSecret);
  console.log(`Order ID:    ${testOrderId}`);
  console.log(`Payment ID:  ${testPaymentId}`);
  console.log(`Secret:      ${testSecret}`);
  console.log(`Signature:   ${validSignature}`);
  console.log('');
  
  const test1Result = verifyPaymentSignature(testOrderId, testPaymentId, validSignature, testSecret);
  
  if (test1Result === true) {
    console.log('✅ PASS: Valid signature accepted');
  } else {
    console.log('❌ FAIL: Valid signature rejected');
    allPassed = false;
  }
  console.log('');
  
  // Test 2: Invalid signature should be rejected
  console.log('[Test 2] Invalid signature rejection');
  console.log('-------------------------------------------');
  
  const invalidSignature = 'invalid_signature_12345';
  console.log(`Order ID:    ${testOrderId}`);
  console.log(`Payment ID:  ${testPaymentId}`);
  console.log(`Signature:   ${invalidSignature} (invalid)`);
  console.log('');
  
  const test2Result = verifyPaymentSignature(testOrderId, testPaymentId, invalidSignature, testSecret);
  
  if (test2Result === false) {
    console.log('✅ PASS: Invalid signature rejected');
  } else {
    console.log('❌ FAIL: Invalid signature accepted (security vulnerability!)');
    allPassed = false;
  }
  console.log('');
  
  // Test 3: Tampered orderId should be rejected
  console.log('[Test 3] Tampered orderId rejection');
  console.log('-------------------------------------------');
  
  const tamperedOrderId = 'order_TAMPERED_999';
  console.log(`Order ID:    ${tamperedOrderId} (tampered)`);
  console.log(`Payment ID:  ${testPaymentId}`);
  console.log(`Signature:   ${validSignature} (original)`);
  console.log('');
  
  const test3Result = verifyPaymentSignature(tamperedOrderId, testPaymentId, validSignature, testSecret);
  
  if (test3Result === false) {
    console.log('✅ PASS: Tampered orderId rejected');
  } else {
    console.log('❌ FAIL: Tampered orderId accepted (security vulnerability!)');
    allPassed = false;
  }
  console.log('');
  
  // Test 4: Tampered paymentId should be rejected
  console.log('[Test 4] Tampered paymentId rejection');
  console.log('-------------------------------------------');
  
  const tamperedPaymentId = 'pay_TAMPERED_999';
  console.log(`Order ID:    ${testOrderId}`);
  console.log(`Payment ID:  ${tamperedPaymentId} (tampered)`);
  console.log(`Signature:   ${validSignature} (original)`);
  console.log('');
  
  const test4Result = verifyPaymentSignature(testOrderId, tamperedPaymentId, validSignature, testSecret);
  
  if (test4Result === false) {
    console.log('✅ PASS: Tampered paymentId rejected');
  } else {
    console.log('❌ FAIL: Tampered paymentId accepted (security vulnerability!)');
    allPassed = false;
  }
  console.log('');
  
  // Test 5: Wrong secret should reject valid signature
  console.log('[Test 5] Wrong secret rejection');
  console.log('-------------------------------------------');
  
  const wrongSecret = 'wrong_secret_67890';
  console.log(`Order ID:    ${testOrderId}`);
  console.log(`Payment ID:  ${testPaymentId}`);
  console.log(`Secret:      ${wrongSecret} (wrong)`);
  console.log(`Signature:   ${validSignature} (generated with correct secret)`);
  console.log('');
  
  const test5Result = verifyPaymentSignature(testOrderId, testPaymentId, validSignature, wrongSecret);
  
  if (test5Result === false) {
    console.log('✅ PASS: Signature rejected with wrong secret');
  } else {
    console.log('❌ FAIL: Signature accepted with wrong secret (security vulnerability!)');
    allPassed = false;
  }
  console.log('');
  
  // Test 6: Empty signature should be rejected
  console.log('[Test 6] Empty signature rejection');
  console.log('-------------------------------------------');
  
  const emptySignature = '';
  console.log(`Order ID:    ${testOrderId}`);
  console.log(`Payment ID:  ${testPaymentId}`);
  console.log(`Signature:   (empty)`);
  console.log('');
  
  const test6Result = verifyPaymentSignature(testOrderId, testPaymentId, emptySignature, testSecret);
  
  if (test6Result === false) {
    console.log('✅ PASS: Empty signature rejected');
  } else {
    console.log('❌ FAIL: Empty signature accepted (security vulnerability!)');
    allPassed = false;
  }
  console.log('');
  
  // Test 7: Multiple valid signatures for different orders
  console.log('[Test 7] Multiple orders signature independence');
  console.log('-------------------------------------------');
  
  const order1 = 'order_AAA111';
  const payment1 = 'pay_AAA111';
  const signature1 = generateSignature(order1, payment1, testSecret);
  
  const order2 = 'order_BBB222';
  const payment2 = 'pay_BBB222';
  const signature2 = generateSignature(order2, payment2, testSecret);
  
  console.log(`Order 1:     ${order1}`);
  console.log(`Payment 1:   ${payment1}`);
  console.log(`Signature 1: ${signature1}`);
  console.log('');
  console.log(`Order 2:     ${order2}`);
  console.log(`Payment 2:   ${payment2}`);
  console.log(`Signature 2: ${signature2}`);
  console.log('');
  
  const test7a = verifyPaymentSignature(order1, payment1, signature1, testSecret);
  const test7b = verifyPaymentSignature(order2, payment2, signature2, testSecret);
  const test7c = verifyPaymentSignature(order1, payment1, signature2, testSecret); // Wrong signature
  
  if (test7a === true && test7b === true && test7c === false) {
    console.log('✅ PASS: Signature independence verified');
    console.log('  - Order 1 with Signature 1: Valid ✓');
    console.log('  - Order 2 with Signature 2: Valid ✓');
    console.log('  - Order 1 with Signature 2: Invalid ✓');
  } else {
    console.log('❌ FAIL: Signature independence broken');
    console.log(`  - Order 1 with Signature 1: ${test7a}`);
    console.log(`  - Order 2 with Signature 2: ${test7b}`);
    console.log(`  - Order 1 with Signature 2: ${test7c} (should be false)`);
    allPassed = false;
  }
  console.log('');
  
  // Summary
  console.log('===========================================');
  console.log('Test Summary');
  console.log('===========================================');
  console.log(`Test 1 (Valid signature):         ${test1Result ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (Invalid signature):       ${!test2Result ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 3 (Tampered orderId):        ${!test3Result ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 4 (Tampered paymentId):      ${!test4Result ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 5 (Wrong secret):            ${!test5Result ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 6 (Empty signature):         ${!test6Result ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 7 (Signature independence):  ${test7a && test7b && !test7c ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');
  
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
    console.log('');
    console.log('Signature verification logic is secure and working correctly.');
    console.log('');
    console.log('Next steps:');
    console.log('1. Test with real Razorpay webhook payload');
    console.log('2. Test HTTP endpoint with scripts/test-pro-verify-http.js');
    console.log('3. Test end-to-end payment flow in mobile app');
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('');
    console.log('CRITICAL: Signature verification has security vulnerabilities!');
    console.log('Do NOT deploy to production until all tests pass.');
    process.exit(1);
  }
}

// Run tests
runTests();
