/**
 * Database Audit Script for Today Counters
 * 
 * Verifies whether Today counters (Overdue / Due Today / Promises / Upcoming) 
 * are correctly showing 0 by directly inspecting MongoDB.
 * 
 * Usage:
 *   MONGO_URI=mongodb://localhost:27017/ph4 node scripts/db-audit-today.js
 */

const mongoose = require('mongoose');
const FollowUpTask = require('../src/models/FollowUpTask');
const RecoveryCase = require('../src/models/RecoveryCase');
const User = require('../src/models/User');
const BusinessSettings = require('../src/models/BusinessSettings');
const { mongoUri } = require('../src/config/env');

// IST timezone utilities (matching todayEngine.js logic)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

function toMs(dateLike) {
  if (!dateLike) return null;
  if (typeof dateLike === 'number') {
    return isNaN(dateLike) ? null : dateLike;
  }
  if (dateLike instanceof Date) {
    const ms = dateLike.getTime();
    return isNaN(ms) ? null : ms;
  }
  const parsed = new Date(dateLike);
  const ms = parsed.getTime();
  return isNaN(ms) ? null : ms;
}

function startOfISTDayMs(timestampMs) {
  if (!timestampMs) return null;
  const istTime = new Date(timestampMs + IST_OFFSET_MS);
  istTime.setUTCHours(0, 0, 0, 0);
  return istTime.getTime() - IST_OFFSET_MS;
}

function endOfISTDayMs(timestampMs) {
  if (!timestampMs) return null;
  const istTime = new Date(timestampMs + IST_OFFSET_MS);
  istTime.setUTCHours(23, 59, 59, 999);
  return istTime.getTime() - IST_OFFSET_MS;
}

function getPromiseMs(item) {
  if (!item) return null;
  const promiseAt = item.promiseAt || item.promisedAt || item.commitmentAt || 
                     item.promise?.at || item.promise?.promiseAt;
  if (!promiseAt) return null;
  return toMs(promiseAt);
}

function bucketForDueMs(dueMs, nowMs) {
  if (!dueMs) return 'NO_DATE';
  const startOfToday = startOfISTDayMs(nowMs);
  const endOfToday = endOfISTDayMs(nowMs);
  if (dueMs < startOfToday) return 'OVERDUE';
  if (dueMs >= startOfToday && dueMs <= endOfToday) return 'TODAY';
  return 'UPCOMING';
}

function bucketForItem(item, nowMs) {
  if (!item) return 'NO_DATE';
  
  // Check for promiseAt (priority: promiseAt > promisedAt > commitmentAt > promise?.at > promise?.promiseAt)
  const promiseMs = getPromiseMs(item);
  
  if (promiseMs) {
    return 'PROMISES';
  }
  
  // No promiseAt - fallback to dueAt bucketing
  const dueAt = item.dueAt || item.nextDueAt || item.dueDate;
  if (!dueAt) return 'NO_DATE';
  
  const dueMs = toMs(dueAt);
  return bucketForDueMs(dueMs, nowMs);
}

async function main() {
  const TARGET_MOBILE = '9890980947';
  const nowMs = Date.now();
  const startOfToday = startOfISTDayMs(nowMs);
  const endOfToday = endOfISTDayMs(nowMs);

  console.log('='.repeat(80));
  console.log('DATABASE AUDIT: Today Counters Verification');
  console.log('='.repeat(80));
  console.log(`Target Mobile: ${TARGET_MOBILE}`);
  console.log(`Current Time (UTC): ${new Date(nowMs).toISOString()}`);
  console.log(`IST Today Start: ${new Date(startOfToday).toISOString()}`);
  console.log(`IST Today End: ${new Date(endOfToday).toISOString()}`);
  console.log(`MongoDB URI: ${mongoUri}`);
  console.log('');

  try {
    // Connect to MongoDB
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
    console.log(`Database: ${mongoose.connection.db.databaseName}`);
    
    // List collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`\n📋 Collections (${collections.length}):`);
    collections.forEach(c => console.log(`  - ${c.name}`));
    console.log('');

    // TASK 1: Find user by mobile
    console.log('🔍 TASK 1: Finding user by mobile...');
    const user = await User.findOne({ 
      $or: [
        { mobile: TARGET_MOBILE },
        { phone: TARGET_MOBILE },
        { phoneE164: TARGET_MOBILE }
      ]
    }).lean();

    if (!user) {
      console.log('❌ User not found with mobile:', TARGET_MOBILE);
      console.log('\nTrying to find any user...');
      const anyUser = await User.findOne().lean();
      if (anyUser) {
        console.log('Found user (sample):', {
          _id: anyUser._id,
          mobile: anyUser.mobile,
          phone: anyUser.phone,
          phoneE164: anyUser.phoneE164,
          name: anyUser.name
        });
      }
      await mongoose.connection.close();
      return;
    }

    console.log('✅ User found:');
    console.log({
      _id: user._id.toString(),
      mobile: user.mobile,
      phone: user.phone,
      phoneE164: user.phoneE164,
      name: user.name,
      businessName: user.businessName
    });
    console.log('');

    const userId = user._id;

    // Check BusinessSettings for gating flags
    console.log('🔍 Checking BusinessSettings...');
    const businessSettings = await BusinessSettings.findOne({ userId: userId }).lean();
    if (businessSettings) {
      console.log('✅ BusinessSettings found:');
      console.log({
        autoFollowupEnabled: businessSettings.autoFollowupEnabled,
        recoveryEnabled: businessSettings.recoveryEnabled
      });
    } else {
      console.log('⚠️  No BusinessSettings found (will use defaults: true)');
    }
    console.log('');

    // TASK 2: Query followup tasks
    console.log('🔍 TASK 2: Querying FollowUp Tasks...');
    const followupTasks = await FollowUpTask.find({
      userId: userId,
      isDeleted: { $ne: true }
    })
    .sort({ dueAt: -1 })
    .limit(50)
    .lean();

    console.log(`Found ${followupTasks.length} followup tasks (non-deleted)`);
    
    // Status breakdown
    const statusCounts = {};
    followupTasks.forEach(task => {
      const status = task.status || 'undefined';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    console.log('\nStatus breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    // Date type check
    if (followupTasks.length > 0) {
      const sampleTask = followupTasks[0];
      console.log('\nDate type diagnostics (first task):');
      console.log(`  dueAt type: ${typeof sampleTask.dueAt}`);
      console.log(`  dueAt instanceof Date: ${sampleTask.dueAt instanceof Date}`);
      console.log(`  dueAt raw value: ${sampleTask.dueAt}`);
      console.log(`  dueAt ISO: ${sampleTask.dueAt ? new Date(sampleTask.dueAt).toISOString() : 'null'}`);
    }
    
    if (followupTasks.length > 0) {
      console.log('\nSample followup tasks (first 5):');
      followupTasks.slice(0, 5).forEach((task, idx) => {
        console.log(`  ${idx + 1}. Task ${task._id.toString().slice(0, 8)}...`);
        console.log(`     customerId: ${task.customerId?.toString() || 'MISSING'}`);
        console.log(`     dueAt: ${task.dueAt ? new Date(task.dueAt).toISOString() : 'MISSING'}`);
        console.log(`     dueAt type: ${typeof task.dueAt}`);
        console.log(`     status: ${task.status || 'MISSING'}`);
        console.log(`     source: ${task.source || 'MISSING'}`);
        console.log(`     createdAt: ${task.createdAt ? new Date(task.createdAt).toISOString() : 'MISSING'}`);
        console.log(`     isDeleted: ${task.isDeleted || false}`);
      });
    }
    console.log('');

    // TASK 3: Query recovery cases
    console.log('🔍 TASK 3: Querying Recovery Cases...');
    const recoveryCases = await RecoveryCase.find({
      userId: userId
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

    console.log(`Found ${recoveryCases.length} recovery cases`);
    
    // Status breakdown
    if (recoveryCases.length > 0) {
      const recoveryStatusCounts = {};
      recoveryCases.forEach(case_ => {
        const status = case_.status || 'undefined';
        recoveryStatusCounts[status] = (recoveryStatusCounts[status] || 0) + 1;
      });
      console.log('\nRecovery case status breakdown:');
      Object.entries(recoveryStatusCounts).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });
      
      // Date type check
      const sampleCase = recoveryCases[0];
      console.log('\nRecovery case date type diagnostics (first case):');
      console.log(`  promiseAt type: ${typeof sampleCase.promiseAt}`);
      console.log(`  promiseAt instanceof Date: ${sampleCase.promiseAt instanceof Date}`);
      console.log(`  promiseAt raw value: ${sampleCase.promiseAt}`);
      console.log(`  promiseAt ISO: ${sampleCase.promiseAt ? new Date(sampleCase.promiseAt).toISOString() : 'null'}`);
    }
    
    if (recoveryCases.length > 0) {
      console.log('\nSample recovery cases (first 5):');
      recoveryCases.slice(0, 5).forEach((case_, idx) => {
        console.log(`  ${idx + 1}. Case ${case_._id.toString().slice(0, 8)}...`);
        console.log(`     customerId: ${case_.customerId?.toString() || 'MISSING'}`);
        console.log(`     promiseAt: ${case_.promiseAt ? new Date(case_.promiseAt).toISOString() : 'null'}`);
        console.log(`     status: ${case_.status || 'MISSING'}`);
        console.log(`     promiseStatus: ${case_.promiseStatus || 'MISSING'}`);
        console.log(`     createdAt: ${case_.createdAt ? new Date(case_.createdAt).toISOString() : 'MISSING'}`);
      });
    }
    console.log('');

    // TASK 4: Compute expected buckets
    console.log('🔍 TASK 4: Computing Expected Buckets (IST)...');
    console.log('');

    const bucketStats = {
      OVERDUE: { items: [], uniqueCustomers: new Set() },
      TODAY: { items: [], uniqueCustomers: new Set() },
      UPCOMING: { items: [], uniqueCustomers: new Set() },
      PROMISES: { items: [], uniqueCustomers: new Set() },
      NO_DATE: { items: [], uniqueCustomers: new Set() },
      EXCLUDED: { items: [], reasons: [] }
    };

    // Process followup tasks
    console.log('Processing FollowUp Tasks...');
    let followupProcessed = 0;
    let followupExcludedByStatus = 0;
    let followupNoDate = 0;
    
    followupTasks.forEach(task => {
      followupProcessed++;
      // Exclude terminal statuses (matching todayEngine logic)
      const normalizedStatus = String(task.status || 'pending').toLowerCase().trim();
      const isTerminal = ['done', 'skipped', 'cancelled', 'failed'].includes(normalizedStatus);
      
      if (isTerminal) {
        followupExcludedByStatus++;
        bucketStats.EXCLUDED.items.push({
          type: 'FOLLOWUP',
          id: task._id.toString(),
          reason: `status="${normalizedStatus}" is terminal`
        });
        return;
      }

      // Check for promise fields
      const promiseMs = getPromiseMs(task);
      const dueMs = toMs(task.dueAt);
      
      if (!dueMs && !promiseMs) {
        followupNoDate++;
        bucketStats.NO_DATE.items.push({
          type: 'FOLLOWUP',
          id: task._id.toString(),
          customerId: task.customerId?.toString()
        });
        return;
      }

      const bucket = bucketForItem(task, nowMs);
      const customerId = task.customerId?.toString();
      
      // Detailed bucket calculation for debugging
      if (followupProcessed <= 3) {
        const effectiveMs = promiseMs || dueMs;
        const bucketDetail = promiseMs ? 'PROMISES' : bucketForDueMs(effectiveMs, nowMs);
        console.log(`  Task ${task._id.toString().slice(0, 8)}... bucket calculation:`);
        console.log(`    promiseMs: ${promiseMs || 'null'}`);
        console.log(`    dueMs: ${dueMs || 'null'}`);
        console.log(`    effectiveMs: ${effectiveMs || 'null'}`);
        console.log(`    effectiveDate ISO: ${effectiveMs ? new Date(effectiveMs).toISOString() : 'null'}`);
        console.log(`    startOfToday IST: ${new Date(startOfToday).toISOString()}`);
        console.log(`    endOfToday IST: ${new Date(endOfToday).toISOString()}`);
        console.log(`    comparison: ${effectiveMs} < ${startOfToday} ? OVERDUE : ${effectiveMs} <= ${endOfToday} ? TODAY : UPCOMING`);
        console.log(`    computed bucket: ${bucket}`);
      }
      
      if (customerId) {
        bucketStats[bucket].uniqueCustomers.add(customerId);
      }
      
      bucketStats[bucket].items.push({
        type: 'FOLLOWUP',
        id: task._id.toString(),
        customerId: customerId || 'MISSING',
        dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
        promiseAt: promiseMs ? new Date(promiseMs).toISOString() : null,
        status: task.status,
        effectiveDate: promiseMs || dueMs
      });
    });

    console.log(`  Processed: ${followupProcessed}, Excluded by status: ${followupExcludedByStatus}, No date: ${followupNoDate}`);
    
    // Process recovery cases
    console.log('Processing Recovery Cases...');
    let recoveryProcessed = 0;
    let recoveryExcludedByStatus = 0;
    let recoveryNoDate = 0;
    
    recoveryCases.forEach(case_ => {
      recoveryProcessed++;
      // Exclude done status (matching todayEngine logic)
      if (case_.status === 'paid' || case_.status === 'done') {
        recoveryExcludedByStatus++;
        bucketStats.EXCLUDED.items.push({
          type: 'RECOVERY',
          id: case_._id.toString(),
          reason: `status="${case_.status}" is done`
        });
        return;
      }

      const promiseMs = getPromiseMs(case_);
      const dueMs = toMs(case_.dueAt); // RecoveryCase doesn't have dueAt, but check anyway
      
      // Recovery cases use promiseAt as effective date
      const effectiveMs = promiseMs || dueMs;
      
      if (!effectiveMs) {
        recoveryNoDate++;
        bucketStats.NO_DATE.items.push({
          type: 'RECOVERY',
          id: case_._id.toString(),
          customerId: case_.customerId?.toString()
        });
        return;
      }

      const bucket = bucketForItem(case_, nowMs);
      const customerId = case_.customerId?.toString();
      
      if (customerId) {
        bucketStats[bucket].uniqueCustomers.add(customerId);
      }
      
      bucketStats[bucket].items.push({
        type: 'RECOVERY',
        id: case_._id.toString(),
        customerId: customerId || 'MISSING',
        promiseAt: promiseMs ? new Date(promiseMs).toISOString() : null,
        status: case_.status,
        effectiveDate: effectiveMs
      });
    });
    
    console.log(`  Processed: ${recoveryProcessed}, Excluded by status: ${recoveryExcludedByStatus}, No date: ${recoveryNoDate}`);

    // Print bucket report
    console.log('\n' + '='.repeat(80));
    console.log('EXPECTED BUCKET REPORT (IST)');
    console.log('='.repeat(80));
    console.log(`Total Followups Processed: ${followupTasks.length}`);
    console.log(`Total Recovery Cases Processed: ${recoveryCases.length}`);
    console.log('');

    ['OVERDUE', 'TODAY', 'UPCOMING', 'PROMISES'].forEach(bucket => {
      const stats = bucketStats[bucket];
      const uniqueCount = stats.uniqueCustomers.size;
      const totalItems = stats.items.length;
      
      console.log(`📦 ${bucket}:`);
      console.log(`   Total Items: ${totalItems}`);
      console.log(`   Unique Customers: ${uniqueCount}`);
      
      if (stats.items.length > 0) {
        console.log(`   Sample Items (first 3):`);
        stats.items.slice(0, 3).forEach((item, idx) => {
          console.log(`     ${idx + 1}. ${item.type} ${item.id.slice(0, 8)}...`);
          console.log(`        customerId: ${item.customerId}`);
          console.log(`        effectiveDate: ${item.effectiveDate ? new Date(item.effectiveDate).toISOString() : 'N/A'}`);
          console.log(`        promiseAt: ${item.promiseAt || 'null'}`);
          console.log(`        dueAt: ${item.dueAt || 'null'}`);
          console.log(`        status: ${item.status || 'N/A'}`);
        });
      }
      console.log('');
    });

    if (bucketStats.NO_DATE.items.length > 0) {
      console.log(`⚠️  NO_DATE Items: ${bucketStats.NO_DATE.items.length}`);
    }

    if (bucketStats.EXCLUDED.items.length > 0) {
      console.log(`⚠️  EXCLUDED Items: ${bucketStats.EXCLUDED.items.length}`);
      const reasons = {};
      bucketStats.EXCLUDED.items.forEach(item => {
        reasons[item.reason] = (reasons[item.reason] || 0) + 1;
      });
      console.log('   Exclusion Reasons:');
      Object.entries(reasons).forEach(([reason, count]) => {
        console.log(`     - ${reason}: ${count}`);
      });
      console.log('');
    }

    // TASK 5: Conclusion
    console.log('='.repeat(80));
    console.log('CONCLUSION');
    console.log('='.repeat(80));
    
    const expectedCounts = {
      overdue: bucketStats.OVERDUE.uniqueCustomers.size,
      today: bucketStats.TODAY.uniqueCustomers.size,
      upcoming: bucketStats.UPCOMING.uniqueCustomers.size,
      promises: bucketStats.PROMISES.uniqueCustomers.size
    };

    const totalExpected = expectedCounts.overdue + expectedCounts.today + 
                          expectedCounts.upcoming + expectedCounts.promises;

    console.log('Expected Counts (Unique Customers):');
    console.log(`  OVERDUE: ${expectedCounts.overdue}`);
    console.log(`  TODAY: ${expectedCounts.today}`);
    console.log(`  UPCOMING: ${expectedCounts.upcoming}`);
    console.log(`  PROMISES: ${expectedCounts.promises}`);
    console.log(`  TOTAL: ${totalExpected}`);
    console.log('');

    if (totalExpected === 0) {
      console.log('✅ CONCLUSION: UI zeros are CORRECT');
      console.log('');
      console.log('Reason: No qualifying items found in database.');
      console.log(`  - Followup tasks: ${followupTasks.length} total, ${followupTasks.filter(t => !['done', 'skipped', 'cancelled', 'failed'].includes(String(t.status || 'pending').toLowerCase().trim())).length} non-terminal`);
      console.log(`  - Recovery cases: ${recoveryCases.length} total, ${recoveryCases.filter(c => c.status !== 'paid' && c.status !== 'done').length} non-done`);
      console.log(`  - Items with valid dates: ${bucketStats.OVERDUE.items.length + bucketStats.TODAY.items.length + bucketStats.UPCOMING.items.length + bucketStats.PROMISES.items.length}`);
      console.log(`  - Items excluded: ${bucketStats.EXCLUDED.items.length}`);
      console.log(`  - Items with no date: ${bucketStats.NO_DATE.items.length}`);
    } else {
      console.log('❌ CONCLUSION: UI zeros are WRONG');
      console.log('');
      console.log('Expected counts > 0 but UI shows 0. Possible reasons:');
      console.log('  1. Context/API not loading the same records (scope mismatch, filters)');
      console.log('  2. Status filters excluding valid items');
      console.log('  3. Missing customerId causing items to be skipped');
      console.log('  4. Date parsing issues (string vs Date)');
      console.log('  5. Timezone conversion mistakes');
      console.log('  6. Settings gating (autoFollowupEnabled/recoveryEnabled = false)');
      console.log('');
      console.log('NEXT STEPS:');
      console.log('  1. Check frontend contexts loading followups/recovery cases');
      console.log('  2. Verify settings.autoFollowupEnabled and settings.recoveryEnabled');
      console.log('  3. Add debug logs in todayEngine to see what items are being filtered');
      console.log('  4. Check if customerId is missing on any items');
    }

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');

  } catch (error) {
    console.error('❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

main();
