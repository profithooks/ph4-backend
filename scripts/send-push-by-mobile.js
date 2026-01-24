/**
 * Send Push Notification by Mobile Number
 * 
 * Finds a user by mobile number and sends a test push notification
 * 
 * Usage:
 *   node scripts/send-push-by-mobile.js <mobile>
 * 
 * Example:
 *   node scripts/send-push-by-mobile.js 9890980947
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Device = require('../src/models/Device');
const Notification = require('../src/models/Notification');
const {createNotification} = require('../src/services/notificationService');
const {isFirebaseConfigured} = require('../src/config/firebase');
const {runWorker} = require('../src/workers/notificationDelivery.worker');
const logger = require('../src/utils/logger');

// Lazy load FCM client (only if Firebase is configured)
let sendToTokens = null;
function getSendToTokens() {
  if (!sendToTokens) {
    try {
      const fcmClient = require('../src/services/push/fcmClient');
      sendToTokens = fcmClient.sendToTokens;
    } catch (error) {
      console.error('[Push] Failed to load FCM client:', error.message);
      console.error('[Push] Make sure firebase-admin is installed: npm install');
      return null;
    }
  }
  return sendToTokens;
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ph4';
const mobile = process.argv[2];

if (!mobile) {
  console.error('Usage: node scripts/send-push-by-mobile.js <mobile>');
  console.error('Example: node scripts/send-push-by-mobile.js 9890980947');
  process.exit(1);
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('Send Push Notification by Mobile Number');
  console.log('═══════════════════════════════════════\n');

  try {
    // Step 1: Connect to MongoDB
    console.log('[Step 1] Connecting to MongoDB...');
    console.log(`  URI: ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`);
    await mongoose.connect(MONGO_URI);
    console.log('  ✅ Connected to MongoDB\n');

    // Step 2: Check Firebase configuration
    console.log('[Step 2] Checking Firebase configuration...');
    try {
      require('firebase-admin');
      console.log('  ✅ firebase-admin package found');
    } catch (error) {
      console.error('  ❌ firebase-admin is not installed!');
      console.error('  Run: npm install');
      process.exit(1);
    }

    if (!isFirebaseConfigured()) {
      console.error('  ❌ Firebase is not configured!');
      console.error('  Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH in .env');
      process.exit(1);
    }
    console.log('  ✅ Firebase is configured\n');

    // Step 3: Find user by mobile number
    console.log('[Step 3] Finding user by mobile number...');
    console.log(`  Searching for mobile: ${mobile}`);
    
    // Normalize mobile (remove spaces, keep only digits)
    const normalizedMobile = mobile.replace(/\s+/g, '').replace(/[^\d]/g, '');
    console.log(`  Normalized mobile: ${normalizedMobile}`);
    
    // Try multiple search patterns
    const user = await User.findOne({
      $or: [
        {mobile: normalizedMobile},
        {mobile: mobile},
        {phone: normalizedMobile},
        {phone: mobile},
        {phoneE164: `+91${normalizedMobile}`},
        {phoneE164: `+91${mobile}`},
      ],
    });

    if (!user) {
      console.error(`  ❌ User not found with mobile: ${mobile}`);
      console.error('  Searched in fields: mobile, phone, phoneE164');
      
      // Show similar users for debugging
      const similarUsers = await User.find({
        $or: [
          {mobile: {$regex: mobile.slice(-4)}},
          {phone: {$regex: mobile.slice(-4)}},
        ],
      }).limit(5).select('_id name mobile phone phoneE164').lean();
      
      if (similarUsers.length > 0) {
        console.log('\n  Similar users found (last 4 digits match):');
        similarUsers.forEach((u, i) => {
          console.log(`    ${i + 1}. ${u.name || 'N/A'} - mobile: ${u.mobile || 'N/A'}, phone: ${u.phone || 'N/A'}, phoneE164: ${u.phoneE164 || 'N/A'}`);
        });
      }
      
      process.exit(1);
    }

    console.log('  ✅ User found:');
    console.log(`    ID: ${user._id}`);
    console.log(`    Name: ${user.name || 'N/A'}`);
    console.log(`    Mobile: ${user.mobile || 'N/A'}`);
    console.log(`    Phone: ${user.phone || 'N/A'}`);
    console.log(`    PhoneE164: ${user.phoneE164 || 'N/A'}`);
    console.log(`    Email: ${user.email || 'N/A'}\n`);

    // Step 4: Find devices with FCM tokens
    console.log('[Step 4] Finding trusted devices with FCM tokens...');
    const devices = await Device.find({
      userId: user._id,
      status: 'TRUSTED',
      fcmToken: {$ne: null, $exists: true},
    }).lean();

    console.log(`  Found ${devices.length} trusted device(s) with FCM tokens`);

    if (devices.length === 0) {
      console.error('  ❌ No trusted devices with FCM tokens found');
      console.error('  Requirements:');
      console.error('    1. User must have logged in on a device');
      console.error('    2. Push notifications permission must be granted');
      console.error('    3. Device must be marked as TRUSTED');
      console.error('    4. FCM token must be registered');
      
      // Show all devices for this user
      const allDevices = await Device.find({userId: user._id}).lean();
      console.log(`\n  All devices for this user (${allDevices.length} total):`);
      allDevices.forEach((d, i) => {
        console.log(`    ${i + 1}. ${d.deviceName || 'Unknown'} (${d.platform || 'unknown'})`);
        console.log(`       Status: ${d.status}`);
        console.log(`       FCM Token: ${d.fcmToken ? `Yes (${d.fcmToken.substring(0, 20)}...)` : 'No'}`);
        console.log(`       Device ID: ${d.deviceId}`);
        console.log(`       Created: ${d.createdAt}`);
      });
      
      process.exit(1);
    }

    console.log('  ✅ Device details:');
    devices.forEach((d, i) => {
      console.log(`    Device ${i + 1}:`);
      console.log(`      Name: ${d.deviceName || 'Unknown'}`);
      console.log(`      Platform: ${d.platform || 'unknown'}`);
      console.log(`      Status: ${d.status}`);
      console.log(`      FCM Token: ${d.fcmToken.substring(0, 30)}...`);
      console.log(`      Token Updated: ${d.fcmTokenUpdatedAt || 'N/A'}`);
    });
    console.log('');

    // Step 5: Send push notification via FCM
    console.log('[Step 5] Sending push notification via FCM...');
    const tokens = devices.map(d => d.fcmToken).filter(Boolean);
    console.log(`  Preparing to send to ${tokens.length} token(s)`);
    
    const sendFn = getSendToTokens();
    if (!sendFn) {
      console.error('  ❌ Cannot send (firebase-admin not available)');
      console.error('  Run: npm install');
      process.exit(1);
    }

    const testData = {
      kind: 'DAILY_SUMMARY',
      entityType: 'system',
      entityId: 'test',
      customerId: null,
      billId: null,
      occurredAt: new Date().toISOString(),
      idempotencyKey: `TEST_${Date.now()}`,
      deeplink: 'ph4://today',
    };

    console.log('  Notification payload:');
    console.log(`    Title: Test Push Notification`);
    console.log(`    Body: This is a test push notification for ${user.name || 'user'}`);
    console.log(`    Data kind: ${testData.kind}`);
    console.log(`    Idempotency Key: ${testData.idempotencyKey}`);

    console.log('\n  Sending to FCM...');
    const result = await sendFn({
      tokens,
      title: 'Test Push Notification',
      body: `This is a test push notification for ${user.name || 'user'}`,
      data: testData,
    });

    console.log('\n  ✅ FCM Send Result:');
    console.log(`    Success: ${result.successCount}`);
    console.log(`    Failed: ${result.failureCount}`);
    console.log(`    Total: ${tokens.length}`);

    if (result.responses.length > 0) {
      console.log('\n  Detailed responses:');
      result.responses.forEach((resp, i) => {
        if (resp.success) {
          console.log(`    ✅ Token ${i + 1}: Sent successfully`);
          console.log(`       Message ID: ${resp.messageId}`);
        } else {
          console.log(`    ❌ Token ${i + 1}: Failed`);
          console.log(`       Error Code: ${resp.errorCode}`);
          console.log(`       Error Message: ${resp.errorMessage}`);
          if (resp.shouldRemoveToken) {
            console.log(`       ⚠️  Token should be removed (invalid)`);
          }
        }
      });
    }

    // Step 6: Create notification via service (full flow)
    console.log('\n[Step 6] Creating notification via service (full flow)...');
    const notificationResult = await createNotification({
      userId: user._id,
      businessId: user.businessId || user._id,
      kind: 'DAILY_SUMMARY',
      title: 'Test Notification',
      body: `This is a test notification created via service for ${user.name || 'user'}`,
      channels: ['IN_APP', 'PUSH'],
      metadata: {
        kind: 'DAILY_SUMMARY',
        entityType: 'system',
        entityId: 'test',
        customerId: null,
        billId: null,
        occurredAt: new Date().toISOString(),
        idempotencyKey: `TEST_SERVICE_${Date.now()}`,
        deeplink: 'ph4://today',
      },
      idempotencyKey: `TEST_SERVICE_${Date.now()}`,
    });

    console.log('  ✅ Notification created:');
    console.log(`    Notification ID: ${notificationResult.notification._id}`);
    console.log(`    Attempts created: ${notificationResult.attempts.length}`);
    notificationResult.attempts.forEach((attempt, i) => {
      console.log(`      ${i + 1}. Channel: ${attempt.channel}, Status: ${attempt.status}`);
    });

    // Step 7: Run notification delivery worker
    console.log('\n[Step 7] Running notification delivery worker...');
    const workerResult = await runWorker();
    console.log('  ✅ Worker completed:');
    console.log(`    Processed: ${workerResult.processed}`);
    console.log(`    Sent: ${workerResult.sent}`);
    console.log(`    Succeeded: ${workerResult.succeeded}`);
    console.log(`    Retrying: ${workerResult.retrying}`);
    console.log(`    Failed: ${workerResult.failed}`);

    // Summary
    console.log('\n═══════════════════════════════════════');
    console.log('Summary');
    console.log('═══════════════════════════════════════');
    console.log(`✅ User found: ${user.name || 'N/A'} (${user.mobile || 'N/A'})`);
    console.log(`✅ Devices with FCM tokens: ${devices.length}`);
    console.log(`✅ FCM direct send: ${result.successCount}/${tokens.length} succeeded`);
    console.log(`✅ Notification created: ${notificationResult.notification._id}`);
    console.log(`✅ Worker processed: ${workerResult.processed} attempts`);
    console.log('═══════════════════════════════════════\n');

    console.log('✅ Push notification sent successfully!');
    console.log('📱 Check the user\'s device for the notification');
    console.log('   The notification should appear within a few seconds\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('[Cleanup] Disconnected from MongoDB');
  }
}

main();
