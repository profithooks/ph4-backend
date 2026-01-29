/**
 * Write Limit Timezone Test
 * 
 * Tests that daily write limit reset uses IST midnight, not UTC
 * 
 * Usage:
 *   node scripts/test-write-limit-timezone.js
 */

const {getISTDateString, getNowIST, IST_OFFSET_MS} = require('../src/utils/timezone.util');

console.log('\n🧪 Write Limit Timezone Tests');
console.log('='.repeat(50));

// Test 1: Verify IST date string format
console.log('\n📝 Test 1: IST Date String Format');
const todayIST = getISTDateString();
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

if (dateRegex.test(todayIST)) {
  console.log(`✅ PASS: IST date string format is valid: ${todayIST}`);
} else {
  console.log(`❌ FAIL: IST date string format is invalid: ${todayIST}`);
  process.exit(1);
}

// Test 2: IST vs UTC date difference around midnight
console.log('\n📝 Test 2: IST vs UTC Date Difference');

// Simulate 23:45 UTC on Jan 29 (which is 05:15 IST on Jan 30)
const testDate = new Date('2026-01-29T23:45:00.000Z');
const utc = testDate.getTime() + (testDate.getTimezoneOffset() * 60000);
const istDate = new Date(utc + IST_OFFSET_MS);

const utcDateString = testDate.toISOString().split('T')[0];
const istDateString = getISTDateString(testDate);

console.log(`   UTC time: ${testDate.toISOString()}`);
console.log(`   IST time: ${istDate.toISOString()}`);
console.log(`   UTC date string: ${utcDateString}`);
console.log(`   IST date string: ${istDateString}`);

if (utcDateString === '2026-01-29' && istDateString === '2026-01-30') {
  console.log('✅ PASS: IST date correctly shows next day when UTC is before midnight');
} else {
  console.log('❌ FAIL: IST date calculation incorrect');
  process.exit(1);
}

// Test 3: Reset logic around IST midnight
console.log('\n📝 Test 3: Reset Logic Around IST Midnight');

// Simulate two consecutive IST days
const day1IST = getISTDateString(new Date('2026-01-29T18:30:00.000Z')); // Jan 30 00:00 IST
const day2IST = getISTDateString(new Date('2026-01-30T18:30:00.000Z')); // Jan 31 00:00 IST

console.log(`   Day 1 IST: ${day1IST}`);
console.log(`   Day 2 IST: ${day2IST}`);

if (day1IST === '2026-01-30' && day2IST === '2026-01-31') {
  console.log('✅ PASS: Different IST dates detected correctly');
} else {
  console.log('❌ FAIL: IST date calculation incorrect across days');
  process.exit(1);
}

// Test 4: Same IST day at different UTC times
console.log('\n📝 Test 4: Same IST Day at Different UTC Times');

// Both timestamps are on Jan 30 IST
const morning = getISTDateString(new Date('2026-01-29T20:00:00.000Z')); // Jan 30 01:30 IST
const evening = getISTDateString(new Date('2026-01-30T17:00:00.000Z')); // Jan 30 22:30 IST

console.log(`   Morning IST: ${morning}`);
console.log(`   Evening IST: ${evening}`);

if (morning === '2026-01-30' && evening === '2026-01-30') {
  console.log('✅ PASS: Same IST date maintained throughout the day');
} else {
  console.log('❌ FAIL: Same IST day not detected correctly');
  process.exit(1);
}

// Test 5: Reset simulation
console.log('\n📝 Test 5: Daily Reset Simulation');

// Simulate user write limit state
let userState = {
  dailyWriteCount: 5,
  dailyWriteDate: '2026-01-29',
};

function simulateEnsureDailyWriteCounter(userState, currentISTDate) {
  if (userState.dailyWriteDate !== currentISTDate) {
    // New day in IST - reset counter
    userState.dailyWriteCount = 0;
    userState.dailyWriteDate = currentISTDate;
    return {reset: true, date: currentISTDate};
  }
  return {reset: false};
}

// Test same day - no reset
let result1 = simulateEnsureDailyWriteCounter(userState, '2026-01-29');
if (!result1.reset && userState.dailyWriteCount === 5) {
  console.log('✅ PASS: Same day - counter not reset (count: 5)');
} else {
  console.log('❌ FAIL: Same day but counter was reset');
  process.exit(1);
}

// Test new day - reset
let result2 = simulateEnsureDailyWriteCounter(userState, '2026-01-30');
if (result2.reset && userState.dailyWriteCount === 0 && userState.dailyWriteDate === '2026-01-30') {
  console.log('✅ PASS: New day - counter reset (count: 0, date: 2026-01-30)');
} else {
  console.log('❌ FAIL: New day but counter not reset correctly');
  process.exit(1);
}

// Test 6: Current IST time
console.log('\n📝 Test 6: Current IST Time');
const nowIST = getNowIST();
const nowISTDateString = getISTDateString();
const nowUTC = new Date();
const nowUTCDateString = nowUTC.toISOString().split('T')[0];

console.log(`   Current UTC: ${nowUTC.toISOString()}`);
console.log(`   Current IST: ${nowIST.toISOString()}`);
console.log(`   UTC date string: ${nowUTCDateString}`);
console.log(`   IST date string: ${nowISTDateString}`);

if (nowISTDateString && dateRegex.test(nowISTDateString)) {
  console.log('✅ PASS: Current IST date string generated correctly');
} else {
  console.log('❌ FAIL: Current IST date string generation failed');
  process.exit(1);
}

// Summary
console.log('\n📊 Test Summary');
console.log('='.repeat(50));
console.log('✅ All timezone tests passed');
console.log('\n💡 Key Points:');
console.log('   1. Daily write limit resets at 00:00 IST (not UTC)');
console.log('   2. IST is UTC+5:30');
console.log('   3. Date string format: YYYY-MM-DD');
console.log('   4. User.dailyWriteDate stores IST date');
console.log('   5. User.ensureDailyWriteCounter() checks IST date');
console.log('\n🌍 Example Scenario:');
console.log('   UTC: 2026-01-29 23:45 → IST: 2026-01-30 05:15');
console.log('   UTC date: 2026-01-29');
console.log('   IST date: 2026-01-30 ✅ (Counter resets at IST midnight)');
console.log('\n📝 Implementation:');
console.log('   - User model uses getISTDateString()');
console.log('   - Default dailyWriteDate uses IST');
console.log('   - ensureDailyWriteCounter() uses IST');

process.exit(0);
