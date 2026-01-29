/**
 * Manual Pro Expiry Test Script
 * 
 * Tests the Pro expiry cron logic manually without waiting for scheduled execution.
 * 
 * Usage:
 *   node scripts/test-pro-expiry-manual.js
 * 
 * This script:
 * 1. Connects to MongoDB
 * 2. Runs processExpiredSubscriptions()
 * 3. Prints results (processed, errors)
 */

const mongoose = require('mongoose');
const { mongoUri } = require('../src/config/env');
const { processExpiredSubscriptions } = require('../src/cron/proExpiry.cron');

console.log('========================================');
console.log('Manual Pro Expiry Test');
console.log('========================================\n');

(async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('Running Pro expiry check...\n');
    const result = await processExpiredSubscriptions();
    
    console.log('\n========================================');
    console.log('Pro Expiry Check Result:');
    console.log('========================================');
    console.log(`Processed: ${result.processed}`);
    console.log(`Errors: ${result.errors}`);
    console.log('========================================\n');
    
    if (result.processed === 0) {
      console.log('✅ No expired subscriptions found (all good!)');
    } else {
      console.log(`✅ Successfully processed ${result.processed} expired subscription(s)`);
    }
    
    if (result.errors > 0) {
      console.log(`⚠️  ${result.errors} error(s) occurred - check server logs`);
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Test complete');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
