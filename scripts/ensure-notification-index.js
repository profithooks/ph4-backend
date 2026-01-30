#!/usr/bin/env node
/**
 * Ensure Notification Idempotency Index Exists
 * 
 * Creates the unique compound index on {userId, idempotencyKey}
 * to prevent duplicate daily digest notifications.
 * 
 * Run this script once on production to fix existing duplicate issues.
 * 
 * Usage:
 *   node scripts/ensure-notification-index.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Notification = require('../src/models/Notification');
const logger = require('../src/utils/logger');

async function ensureIndexes() {
  try {
    // Connect to MongoDB
    logger.info('[IndexMigration] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('[IndexMigration] ✅ Connected');

    // Check existing indexes
    logger.info('[IndexMigration] Checking existing indexes...');
    const indexes = await Notification.collection.getIndexes();
    
    console.log('\n📋 Current indexes:');
    Object.keys(indexes).forEach(name => {
      console.log(`   - ${name}:`, JSON.stringify(indexes[name]));
    });

    // Drop old idempotencyKey index if it exists (non-compound)
    if (indexes.idempotencyKey_1) {
      logger.info('[IndexMigration] Dropping old non-unique idempotencyKey index...');
      await Notification.collection.dropIndex('idempotencyKey_1');
      logger.info('[IndexMigration] ✅ Old index dropped');
    }

    // Create/update indexes using Mongoose
    logger.info('[IndexMigration] Creating unique compound index...');
    await Notification.syncIndexes();
    logger.info('[IndexMigration] ✅ Indexes synced');

    // Verify new index exists
    const newIndexes = await Notification.collection.getIndexes();
    const hasUniqueIndex = Object.keys(newIndexes).some(name => {
      const index = newIndexes[name];
      return (
        index.userId === 1 &&
        index.idempotencyKey === 1 &&
        index.unique === true
      );
    });

    console.log('\n📋 Updated indexes:');
    Object.keys(newIndexes).forEach(name => {
      console.log(`   - ${name}:`, JSON.stringify(newIndexes[name]));
    });

    if (hasUniqueIndex) {
      logger.info('[IndexMigration] ✅ Unique compound index confirmed');
      
      // Check for existing duplicates
      logger.info('[IndexMigration] Checking for duplicate notifications...');
      const duplicates = await Notification.aggregate([
        {
          $match: {
            idempotencyKey: {$exists: true, $ne: null},
          },
        },
        {
          $group: {
            _id: {userId: '$userId', key: '$idempotencyKey'},
            count: {$sum: 1},
            ids: {$push: '$_id'},
          },
        },
        {
          $match: {count: {$gt: 1}},
        },
      ]);

      if (duplicates.length > 0) {
        console.warn('\n⚠️  Found duplicate notifications:', duplicates.length, 'groups');
        console.log('\nTo clean up duplicates, you can:');
        console.log('1. Keep the newest notification in each group');
        console.log('2. Delete older duplicates');
        console.log('\nDuplicate groups (showing first 5):');
        duplicates.slice(0, 5).forEach((dup, i) => {
          console.log(`   ${i + 1}. userId=${dup._id.userId}, key="${dup._id.key}", count=${dup.count}`);
        });
      } else {
        logger.info('[IndexMigration] ✅ No duplicate notifications found');
      }
    } else {
      logger.error('[IndexMigration] ❌ Unique compound index NOT found!');
      process.exit(1);
    }

    logger.info('[IndexMigration] ✅ Migration complete');
    process.exit(0);
  } catch (error) {
    logger.error('[IndexMigration] ❌ Migration failed', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  ensureIndexes();
}

module.exports = {ensureIndexes};
