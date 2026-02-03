/**
 * Debug Device Status Script
 *
 * Usage:
 *   USER_ID="<mongoUserId>" node scripts/debug-device-status.js
 */
const mongoose = require('mongoose');
const {mongoUri} = require('../src/config/env');
const Device = require('../src/models/Device');

async function run() {
  const userId = process.env.USER_ID;

  if (!userId) {
    console.error('USER_ID env var is required');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('✓ Connected to MongoDB');

  const devices = await Device.find({userId}).select('deviceId status platform fcmToken').lean();

  const rows = devices.map(d => ({
    deviceId: d.deviceId,
    status: d.status,
    platform: d.platform,
    hasToken: !!d.fcmToken,
    tokenCount: Array.isArray(d.fcmToken) ? d.fcmToken.length : d.fcmToken ? 1 : 0,
  }));

  console.log('\nDevices:');
  console.table(rows);

  const totals = devices.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      if (d.status === 'TRUSTED' && d.fcmToken) acc.trustedWithToken += 1;
      return acc;
    },
    {TRUSTED: 0, PENDING: 0, BLOCKED: 0, trustedWithToken: 0},
  );

  console.log('Totals:');
  console.table([totals]);

  await mongoose.connection.close();
  console.log('✓ Database connection closed');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
