/**
 * Smoke Test: Webhook Plan ID Resolution
 * 
 * Tests that webhook correctly resolves planId from notes or amount mapping.
 * Unit-style test (no HTTP calls).
 * 
 * Run: node scripts/test-webhook-planid-resolution.js
 */

const { PLANS } = require('../src/config/proPlans');

console.log('\n' + '='.repeat(60));
console.log('WEBHOOK PLAN ID RESOLUTION TEST');
console.log('='.repeat(60));

/**
 * Simulate the planId resolution logic from webhook controller
 */
function resolvePlanId(notes, amount) {
  let planId = notes?.planId;
  let durationDays = 30;
  
  // Try notes first
  if (planId && PLANS[planId]) {
    durationDays = PLANS[planId].durationDays;
    return { planId, durationDays, source: 'notes' };
  }
  
  // Fallback: Map amount to planId
  const planEntry = Object.entries(PLANS).find(([key, plan]) => plan.amountPaise === amount);
  
  if (planEntry) {
    planId = planEntry[0];
    durationDays = planEntry[1].durationDays;
    return { planId, durationDays, source: 'amount_mapping' };
  }
  
  // No match - default to monthly with warning
  console.warn(`[WARNING] Amount ${amount} does not match any plan`);
  return { planId: 'monthly', durationDays: 30, source: 'fallback' };
}

/**
 * Test cases
 */
const tests = [
  {
    name: 'Valid notes.planId (monthly)',
    notes: { planId: 'monthly', userId: 'user123' },
    amount: 29900,
    expected: { planId: 'monthly', durationDays: 30, source: 'notes' },
  },
  {
    name: 'Valid notes.planId (quarterly)',
    notes: { planId: 'quarterly', userId: 'user123' },
    amount: 79900,
    expected: { planId: 'quarterly', durationDays: 90, source: 'notes' },
  },
  {
    name: 'Valid notes.planId (yearly)',
    notes: { planId: 'yearly', userId: 'user123' },
    amount: 299900,
    expected: { planId: 'yearly', durationDays: 365, source: 'notes' },
  },
  {
    name: 'Invalid notes.planId -> fallback to amount mapping (monthly)',
    notes: { planId: 'invalid_plan', userId: 'user123' },
    amount: 29900,
    expected: { planId: 'monthly', durationDays: 30, source: 'amount_mapping' },
  },
  {
    name: 'Missing notes.planId -> amount mapping (quarterly)',
    notes: { userId: 'user123' },
    amount: 79900,
    expected: { planId: 'quarterly', durationDays: 90, source: 'amount_mapping' },
  },
  {
    name: 'Invalid amount -> fallback to monthly',
    notes: { userId: 'user123' },
    amount: 99999, // Not a real plan amount
    expected: { planId: 'monthly', durationDays: 30, source: 'fallback' },
  },
  {
    name: 'Empty notes -> amount mapping (yearly)',
    notes: {},
    amount: 299900,
    expected: { planId: 'yearly', durationDays: 365, source: 'amount_mapping' },
  },
];

/**
 * Run tests
 */
let passed = 0;
let failed = 0;

console.log('\nRunning tests...\n');

tests.forEach((test, index) => {
  const result = resolvePlanId(test.notes, test.amount);
  const match = 
    result.planId === test.expected.planId &&
    result.durationDays === test.expected.durationDays &&
    result.source === test.expected.source;
  
  if (match) {
    console.log(`✅ Test ${index + 1}: ${test.name}`);
    console.log(`   Expected: planId=${test.expected.planId}, duration=${test.expected.durationDays}d, source=${test.expected.source}`);
    console.log(`   Got:      planId=${result.planId}, duration=${result.durationDays}d, source=${result.source}`);
    passed++;
  } else {
    console.log(`❌ Test ${index + 1}: ${test.name}`);
    console.log(`   Expected: planId=${test.expected.planId}, duration=${test.expected.durationDays}d, source=${test.expected.source}`);
    console.log(`   Got:      planId=${result.planId}, duration=${result.durationDays}d, source=${result.source}`);
    failed++;
  }
  console.log('');
});

/**
 * Summary
 */
console.log('='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('✅ ALL TESTS PASSED');
  console.log('   - notes.planId correctly used when valid');
  console.log('   - Amount mapping works as fallback');
  console.log('   - Invalid inputs fallback to monthly');
  console.log('');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  console.log('');
  process.exit(1);
}
