/**
 * Notification System Test Script
 * 
 * Creates test notifications and verifies worker processing
 * Usage: node scripts/testNotifications.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const {createNotification} = require('../src/services/notificationService');
const {runWorker} = require('../src/workers/notificationDelivery.worker');
const Notification = require('../src/models/Notification');
const NotificationAttempt = require('../src/models/NotificationAttempt');
const User = require('../src/models/User');
const Customer = require('../src/models/Customer');
const logger = require('../src/utils/logger');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = {
  success: msg => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  error: msg => console.log(`${colors.red}✗ ${msg}${colors.reset}`),
  info: msg => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
  warn: msg => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
};

/**
 * Connect to database
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    log.success('Connected to MongoDB');
  } catch (error) {
    log.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Test 1: Create notification with IN_APP delivery
 */
async function testInAppNotification() {
  log.info('Test 1: IN_APP Notification');
  
  try {
    // Get first user and customer for testing
    const user = await User.findOne();
    if (!user) {
      log.warn('No users found - create a user first');
      return false;
    }
    
    const customer = await Customer.findOne({userId: user._id});
    if (!customer) {
      log.warn('No customers found - create a customer first');
      return false;
    }
    
    // Create notification
    const result = await createNotification({
      userId: user._id,
      businessId: user.businessId,
      customerId: customer._id,
      kind: 'FOLLOWUP',
      title: 'Test Follow-up Reminder',
      body: `Follow-up reminder for ${customer.name}. This is a test notification.`,
      channels: ['IN_APP'],
      metadata: {test: true},
      idempotencyKey: `test_${Date.now()}`,
    });
    
    log.success(`Notification created: ${result.notification._id}`);
    log.success(`Attempts created: ${result.attempts.length}`);
    
    // Check attempt status
    const attempt = result.attempts[0];
    if (attempt.status === 'QUEUED') {
      log.success('Attempt status: QUEUED (ready for worker)');
    } else {
      log.warn(`Unexpected attempt status: ${attempt.status}`);
    }
    
    return true;
  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: Create notification with stub transport (should fail)
 */
async function testStubTransport() {
  log.info('Test 2: WHATSAPP Stub Transport (should fail)');
  
  try {
    const user = await User.findOne();
    const customer = await Customer.findOne({userId: user._id});
    
    // Create notification with WHATSAPP channel
    const result = await createNotification({
      userId: user._id,
      customerId: customer._id,
      kind: 'OVERDUE',
      title: 'Test Overdue Notification',
      body: 'This should fail with PROVIDER_NOT_CONFIGURED',
      channels: ['WHATSAPP'],
      idempotencyKey: `test_whatsapp_${Date.now()}`,
    });
    
    log.success(`Notification created: ${result.notification._id}`);
    log.info('Attempt created for WHATSAPP (will fail when worker runs)');
    
    return true;
  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: Run worker and check delivery
 */
async function testWorkerExecution() {
  log.info('Test 3: Worker Execution');
  
  try {
    // Check queued attempts before
    const queuedBefore = await NotificationAttempt.countDocuments({
      status: {$in: ['QUEUED', 'RETRY_SCHEDULED']},
      nextAttemptAt: {$lte: new Date()},
    });
    
    log.info(`Queued attempts before worker: ${queuedBefore}`);
    
    if (queuedBefore === 0) {
      log.warn('No queued attempts to process');
      return true;
    }
    
    // Run worker
    const stats = await runWorker();
    
    log.success('Worker completed');
    log.info(`Processed: ${stats.processed}`);
    log.info(`Sent: ${stats.sent}`);
    log.info(`Retrying: ${stats.retrying}`);
    log.info(`Failed: ${stats.failed}`);
    
    // Check results
    if (stats.processed > 0) {
      log.success(`Worker processed ${stats.processed} attempts`);
      
      // Check for IN_APP success
      const sentCount = await NotificationAttempt.countDocuments({
        status: 'SENT',
        channel: 'IN_APP',
      });
      log.success(`IN_APP attempts sent: ${sentCount}`);
      
      // Check for WHATSAPP failures
      const failedWhatsapp = await NotificationAttempt.countDocuments({
        status: 'FAILED',
        channel: 'WHATSAPP',
      });
      if (failedWhatsapp > 0) {
        log.success(`WHATSAPP attempts failed (expected): ${failedWhatsapp}`);
      }
    }
    
    return true;
  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 4: Query notifications API format
 */
async function testNotificationQueries() {
  log.info('Test 4: Notification Queries');
  
  try {
    const user = await User.findOne();
    
    // Query user's notifications
    const notifications = await Notification.find({userId: user._id})
      .sort({createdAt: -1})
      .limit(5)
      .lean();
    
    log.success(`Found ${notifications.length} notifications for user`);
    
    if (notifications.length > 0) {
      const notif = notifications[0];
      log.info('Sample notification:');
      log.info(`  - ID: ${notif._id}`);
      log.info(`  - Kind: ${notif.kind}`);
      log.info(`  - Title: ${notif.title}`);
      log.info(`  - Channels: ${notif.channels.join(', ')}`);
      
      // Get attempts
      const attempts = await NotificationAttempt.find({
        notificationId: notif._id,
      }).lean();
      
      log.info(`  - Attempts: ${attempts.length}`);
      attempts.forEach((att, idx) => {
        log.info(`    ${idx + 1}. ${att.channel}: ${att.status}`);
      });
    }
    
    return true;
  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Multi-channel notification
 */
async function testMultiChannel() {
  log.info('Test 5: Multi-Channel Notification');
  
  try {
    const user = await User.findOne();
    const customer = await Customer.findOne({userId: user._id});
    
    // Create notification with multiple channels
    const result = await createNotification({
      userId: user._id,
      customerId: customer._id,
      kind: 'SYSTEM',
      title: 'Multi-channel Test',
      body: 'Testing IN_APP (should succeed) and WHATSAPP (should fail)',
      channels: ['IN_APP', 'WHATSAPP'],
      idempotencyKey: `test_multi_${Date.now()}`,
    });
    
    log.success(`Notification created: ${result.notification._id}`);
    log.success(`Attempts created: ${result.attempts.length}`);
    
    result.attempts.forEach(att => {
      log.info(`  - ${att.channel}: ${att.status}`);
    });
    
    return true;
  } catch (error) {
    log.error(`Test failed: ${error.message}`);
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  Notification System Tests');
  console.log('='.repeat(60) + '\n');
  
  await connectDB();
  console.log();
  
  const results = [];
  
  results.push(await testInAppNotification());
  console.log();
  
  results.push(await testStubTransport());
  console.log();
  
  results.push(await testMultiChannel());
  console.log();
  
  // Run worker to process
  log.info('Running worker to process attempts...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  results.push(await testWorkerExecution());
  console.log();
  
  results.push(await testNotificationQueries());
  console.log();
  
  // Summary
  console.log('='.repeat(60));
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  if (passed === total) {
    log.success(`All ${total} tests passed!`);
  } else {
    log.warn(`${passed}/${total} tests passed`);
  }
  console.log('='.repeat(60) + '\n');
  
  await mongoose.disconnect();
  process.exit(passed === total ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
