/**
 * Test Push Notification Script
 * 
 * Sends a test push notification to a specific user
 * 
 * Usage:
 *   node scripts/test-push-notification.js <userId> [kind]
 * 
 * Examples:
 *   node scripts/test-push-notification.js 6973bb8e83db8d2f73d2639e
 *   node scripts/test-push-notification.js 6973bb8e83db8d2f73d2639e DAILY_SUMMARY
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Device = require('../src/models/Device');
const Notification = require('../src/models/Notification');
const {createNotification} = require('../src/services/notificationService');
const {isFirebaseConfigured} = require('../src/config/firebase');
const logger = require('../src/utils/logger');

// Lazy load FCM client (only if Firebase is configured)
let sendToTokens = null;
function getSendToTokens() {
  if (!sendToTokens) {
    try {
      const fcmClient = require('../src/services/push/fcmClient');
      sendToTokens = fcmClient.sendToTokens;
    } catch (error) {
      console.error('[Test] Failed to load FCM client:', error.message);
      console.error('[Test] Make sure firebase-admin is installed: npm install');
      return null;
    }
  }
  return sendToTokens;
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ph4';
const userId = process.argv[2];
const kind = process.argv[3] || 'DAILY_SUMMARY';

if (!userId) {
  console.error('Usage: node scripts/test-push-notification.js <userId> [kind]');
  console.error('Example: node scripts/test-push-notification.js 6973bb8e83db8d2f73d2639e DAILY_SUMMARY');
  process.exit(1);
}

async function main() {
  try {
    console.log('[Test] Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('[Test] Connected');

    // Check if firebase-admin is installed
    try {
      require('firebase-admin');
    } catch (error) {
      console.error('[Test] ❌ firebase-admin is not installed!');
      console.error('[Test] Run: npm install');
      console.error('[Test] Then run this script again');
      process.exit(1);
    }

    // Check Firebase configuration
    if (!isFirebaseConfigured()) {
      console.error('[Test] ❌ Firebase is not configured!');
      console.error('[Test] Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH in .env');
      process.exit(1);
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      console.error(`[Test] ❌ User not found: ${userId}`);
      process.exit(1);
    }
    console.log(`[Test] ✅ User found: ${user.name} (${user.mobile})`);

    // Check for devices with FCM tokens
    const devices = await Device.find({
      userId: user._id,
      status: 'TRUSTED',
      fcmToken: {$ne: null, $exists: true},
    }).lean();

    if (devices.length === 0) {
      console.error('[Test] ❌ No trusted devices with FCM tokens found for this user');
      console.error('[Test] Make sure:');
      console.error('  1. User has logged in on Android device');
      console.error('  2. Push notifications permission was granted');
      console.error('  3. Device is marked as TRUSTED');
      console.error('  4. FCM token was registered');
      
      // Show all devices for this user
      const allDevices = await Device.find({userId: user._id}).lean();
      console.log(`\n[Test] Found ${allDevices.length} device(s) for this user:`);
      allDevices.forEach((d, i) => {
        console.log(`  ${i + 1}. ${d.deviceName || 'Unknown'} (${d.platform})`);
        console.log(`     Status: ${d.status}`);
        console.log(`     FCM Token: ${d.fcmToken ? 'Yes' : 'No'}`);
        console.log(`     Device ID: ${d.deviceId}`);
      });
      
      process.exit(1);
    }

    console.log(`[Test] ✅ Found ${devices.length} trusted device(s) with FCM tokens`);

    // Option 1: Send directly via FCM (quick test)
    console.log('\n[Test] Option 1: Sending direct FCM message...');
    const tokens = devices.map(d => d.fcmToken).filter(Boolean);
    
    const sendFn = getSendToTokens();
    if (!sendFn) {
      console.warn('[Test] ⚠️  Skipping direct FCM send (firebase-admin not available)');
      console.warn('[Test] Run: npm install');
    } else {
      const testData = {
        kind,
        entityType: 'system',
        entityId: 'test',
        customerId: null,
        billId: null,
        occurredAt: new Date().toISOString(),
        idempotencyKey: `TEST_${Date.now()}`,
        deeplink: 'ph4://today',
      };

      const result = await sendFn({
        tokens,
        title: 'Test Notification',
        body: `This is a test push notification (${kind})`,
        data: testData,
      });

      console.log('[Test] FCM Send Result:');
      console.log(`  Success: ${result.successCount}`);
      console.log(`  Failed: ${result.failureCount}`);
      console.log(`  Total: ${tokens.length}`);

      if (result.responses.length > 0) {
        result.responses.forEach((resp, i) => {
          if (resp.success) {
            console.log(`  ✅ Token ${i + 1}: Sent (messageId: ${resp.messageId})`);
          } else {
            console.log(`  ❌ Token ${i + 1}: Failed (${resp.errorCode}: ${resp.errorMessage})`);
            if (resp.shouldRemoveToken) {
              console.log(`     ⚠️  Token should be removed`);
            }
          }
        });
      }
    }

    // Option 2: Create notification via service (full flow)
    console.log('\n[Test] Option 2: Creating notification via service (full flow)...');
    const notificationResult = await createNotification({
      userId: user._id,
      businessId: user.businessId || user._id,
      kind,
      title: 'Test Notification',
      body: `This is a test notification created via service (${kind})`,
      channels: ['IN_APP', 'PUSH'],
      metadata: {
        kind,
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

    console.log('[Test] Notification created:');
    console.log(`  Notification ID: ${notificationResult.notification._id}`);
    console.log(`  Attempts created: ${notificationResult.attempts.length}`);
    notificationResult.attempts.forEach((attempt, i) => {
      console.log(`    ${i + 1}. ${attempt.channel} - ${attempt.status}`);
    });

    console.log('\n[Test] ✅ Test complete!');
    console.log('[Test] Check your Android device for the notification');
    console.log('[Test] The notification should appear within a few seconds');

  } catch (error) {
    console.error('[Test] ❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('[Test] Disconnected from MongoDB');
  }
}

main();
