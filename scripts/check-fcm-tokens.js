/**
 * Check FCM Tokens Script
 * 
 * Lists all devices with FCM tokens in the database
 */
const mongoose = require('mongoose');
const { mongoUri } = require('../src/config/env');
const Device = require('../src/models/Device');

async function checkFCMTokens() {
  try {
    // Connect to MongoDB
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');
    console.log('');

    // Find all devices with FCM tokens
    const devices = await Device.find({
      fcmToken: { $ne: null, $exists: true },
    })
      .populate('userId', 'name email phone')
      .populate('businessId', 'name email')
      .lean();

    console.log(`Found ${devices.length} device(s) with FCM tokens:`);
    console.log('');

    if (devices.length === 0) {
      console.log('❌ No FCM tokens found in database!');
      console.log('');
      console.log('To register FCM tokens:');
      console.log('1. Login to the mobile app');
      console.log('2. Grant notification permissions');
      console.log('3. App will automatically register FCM token with backend');
      console.log('');
    } else {
      devices.forEach((device, idx) => {
        console.log(`Device ${idx + 1}:`);
        console.log(`  ID: ${device._id}`);
        console.log(`  User: ${device.userId?.name || 'N/A'} (${device.userId?.email || device.userId?.phone || 'N/A'})`);
        console.log(`  Device Name: ${device.deviceName}`);
        console.log(`  Platform: ${device.platform}`);
        console.log(`  Status: ${device.status}`);
        console.log(`  FCM Token: ${device.fcmToken.substring(0, 30)}...`);
        console.log(`  Last Seen: ${device.lastSeenAt}`);
        console.log(`  FCM Updated: ${device.fcmTokenUpdatedAt || 'N/A'}`);
        console.log('');
      });

      // Group by status
      const grouped = devices.reduce((acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      }, {});

      console.log('Summary by Status:');
      Object.entries(grouped).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });
      console.log('');

      console.log('Note: Push endpoint only sends to TRUSTED devices.');
      console.log('If devices are PENDING, they need to be approved first.');
    }

    await mongoose.connection.close();
    console.log('✓ Database connection closed');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkFCMTokens();
