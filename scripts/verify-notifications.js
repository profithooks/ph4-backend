/**
 * Notification Generation Verification Script
 * 
 * Creates minimal fixtures and runs generators to verify they work
 * Run: node scripts/verify-notifications.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Customer = require('../src/models/Customer');
const Bill = require('../src/models/Bill');
const FollowUpTask = require('../src/models/FollowUpTask');
const RecoveryCase = require('../src/models/RecoveryCase');
const BusinessSettings = require('../src/models/BusinessSettings');
const Notification = require('../src/models/Notification');
const {getNowIST, getStartOfDayIST} = require('../src/utils/timezone.util');
const {generateFollowupDueNotifications} = require('../src/services/notifications/generators/followupDue');
const {
  generatePromiseDueTodayNotifications,
  generatePromiseBrokenNotifications,
} = require('../src/services/notifications/generators/promiseNotifications');
const {
  generateDueTodayNotifications,
  generateOverdueAlertNotifications,
} = require('../src/services/notifications/generators/billNotifications');
const {generateDailySummaryNotifications} = require('../src/services/notifications/generators/dailySummary');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ph4';

async function main() {
  try {
    console.log('[Verify] Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('[Verify] Connected');

    // Find or create test user
    let testUser = await User.findOne({email: 'test@example.com'});
    if (!testUser) {
      console.log('[Verify] Creating test user...');
      testUser = await User.create({
        name: 'Test User',
        email: 'test@example.com',
        password: 'Test123456!',
        phone: '+919890980947',
        planStatus: 'pro',
      });
    }
    const userId = testUser._id;
    const businessId = testUser.businessId || userId;

    // Get or create settings
    let settings = await BusinessSettings.findOne({userId});
    if (!settings) {
      settings = await BusinessSettings.create({
        userId,
        businessId,
        recoveryEnabled: true,
        autoFollowupEnabled: true,
      });
    }

    // Create test customer
    let testCustomer = await Customer.findOne({userId, name: 'Test Customer'});
    if (!testCustomer) {
      testCustomer = await Customer.create({
        userId,
        name: 'Test Customer',
        phone: '+919876543210',
      });
    }
    const customerId = testCustomer._id;

    const now = getNowIST();
    const startOfToday = getStartOfDayIST(now);
    const yesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

    console.log('\n[Verify] Creating test fixtures...');

    // Create overdue bill
    const overdueBill = await Bill.create({
      userId,
      customerId,
      billNo: `TEST-OVERDUE-${Date.now()}`,
      items: [{name: 'Test Item', qty: 1, price: 1000, total: 1000}],
      subTotal: 1000,
      grandTotal: 1000,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: yesterday, // Overdue
    });

    // Create bill due today
    const dueTodayBill = await Bill.create({
      userId,
      customerId,
      billNo: `TEST-DUE-TODAY-${Date.now()}`,
      items: [{name: 'Test Item', qty: 1, price: 500, total: 500}],
      subTotal: 500,
      grandTotal: 500,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: startOfToday, // Due today
    });

    // Create followup due
    const followup = await FollowUpTask.create({
      userId,
      customerId,
      channel: 'call',
      dueAt: new Date(now.getTime() + 10 * 60 * 1000), // 10 minutes from now
      status: 'pending',
      balance: 1000,
      idempotencyKey: `test_followup_${Date.now()}`,
    });

    // Create recovery case with promise due today
    const recoveryCase = await RecoveryCase.create({
      userId,
      customerId,
      outstandingSnapshot: 2000,
      status: 'promised',
      promiseAt: startOfToday, // Due today
      promiseAmount: 2000,
      promiseStatus: 'DUE_TODAY',
      idempotencyKey: `test_recovery_${Date.now()}`,
    });

    console.log('[Verify] Fixtures created');
    console.log(`  - Overdue bill: ${overdueBill.billNo}`);
    console.log(`  - Due today bill: ${dueTodayBill.billNo}`);
    console.log(`  - Followup: ${followup._id}`);
    console.log(`  - Recovery case: ${recoveryCase._id}`);

    // Clear existing notifications for this user
    await Notification.deleteMany({userId});
    console.log('\n[Verify] Cleared existing notifications');

    // Run generators
    console.log('\n[Verify] Running generators...\n');

    const results = {
      followupDue: await generateFollowupDueNotifications({settings}),
      promiseDueToday: await generatePromiseDueTodayNotifications({settings}),
      promiseBroken: await generatePromiseBrokenNotifications({settings}),
      dueToday: await generateDueTodayNotifications({settings}),
      overdueAlert: await generateOverdueAlertNotifications({settings}),
      dailySummary: await generateDailySummaryNotifications({settings}),
    };

    // Print report
    console.log('═══════════════════════════════════════');
    console.log('NOTIFICATION GENERATION REPORT');
    console.log('═══════════════════════════════════════\n');

    for (const [kind, result] of Object.entries(results)) {
      console.log(`${kind}:`);
      console.log(`  Created: ${result.created}`);
      console.log(`  Skipped: ${result.skipped}`);
    }

    const totalCreated = Object.values(results).reduce((sum, r) => sum + r.created, 0);
    const totalSkipped = Object.values(results).reduce((sum, r) => sum + r.skipped, 0);

    console.log(`\nTotal: ${totalCreated} created, ${totalSkipped} skipped`);

    // Verify notifications were created
    const notifications = await Notification.find({userId}).sort({createdAt: -1}).lean();
    console.log(`\n[Verify] Total notifications in DB: ${notifications.length}`);

    if (notifications.length > 0) {
      console.log('\nSample notifications:');
      notifications.slice(0, 5).forEach(notif => {
        console.log(`  - ${notif.kind}: ${notif.title} (idempotencyKey: ${notif.idempotencyKey?.substring(0, 50)}...)`);
      });
    }

    // Test idempotency: run again
    console.log('\n[Verify] Testing idempotency (running generators again)...');
    const results2 = {
      followupDue: await generateFollowupDueNotifications({settings}),
      overdueAlert: await generateOverdueAlertNotifications({settings}),
    };

    console.log('Second run:');
    for (const [kind, result] of Object.entries(results2)) {
      console.log(`  ${kind}: Created=${result.created}, Skipped=${result.skipped}`);
    }

    const notifications2 = await Notification.find({userId}).sort({createdAt: -1}).lean();
    console.log(`\n[Verify] Total notifications after second run: ${notifications2.length}`);
    
    if (notifications.length === notifications2.length) {
      console.log('✅ Idempotency verified: No duplicate notifications created');
    } else {
      console.log('⚠️  Warning: Duplicate notifications may have been created');
    }

    console.log('\n[Verify] ✅ Verification complete');
  } catch (error) {
    console.error('[Verify] ❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('[Verify] Disconnected from MongoDB');
  }
}

main();
