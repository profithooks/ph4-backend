#!/usr/bin/env node
/**
 * Cleanup Duplicate Notifications
 * 
 * Removes duplicate daily digest notifications, keeping only the newest one.
 * Run this AFTER ensuring the unique index exists.
 * 
 * Usage:
 *   node scripts/cleanup-duplicate-notifications.js [--dry-run]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Notification = require('../src/models/Notification');
const logger = require('../src/utils/logger');

async function cleanupDuplicates(dryRun = false) {
  try {
    // Connect to MongoDB
    logger.info('[DuplicateCleanup] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('[DuplicateCleanup] ✅ Connected');

    // Find all duplicate groups
    logger.info('[DuplicateCleanup] Finding duplicate notifications...');
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
          docs: {
            $push: {
              id: '$_id',
              createdAt: '$createdAt',
            },
          },
        },
      },
      {
        $match: {count: {$gt: 1}},
      },
    ]);

    if (duplicates.length === 0) {
      logger.info('[DuplicateCleanup] ✅ No duplicates found');
      process.exit(0);
      return;
    }

    console.log(`\n⚠️  Found ${duplicates.length} duplicate groups`);

    let totalToDelete = 0;
    const idsToDelete = [];

    // For each duplicate group, keep the newest and mark others for deletion
    duplicates.forEach(dup => {
      // Sort by createdAt descending (newest first)
      const sorted = dup.docs.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );

      // Keep the first (newest), delete the rest
      const toDelete = sorted.slice(1);
      totalToDelete += toDelete.length;
      idsToDelete.push(...toDelete.map(d => d.id));

      console.log(`\n  Group: userId=${dup._id.userId}, key="${dup._id.key}"`);
      console.log(`    Total: ${dup.count} | Keeping: 1 | Deleting: ${toDelete.length}`);
      sorted.forEach((doc, i) => {
        const action = i === 0 ? '✅ KEEP' : '❌ DELETE';
        console.log(`      ${action} - ${doc.id} (${doc.createdAt})`);
      });
    });

    console.log(`\n📊 Summary:`);
    console.log(`   Duplicate groups: ${duplicates.length}`);
    console.log(`   Total duplicates to delete: ${totalToDelete}`);

    if (dryRun) {
      console.log('\n🔍 DRY RUN - No changes made');
      console.log('   Run without --dry-run to actually delete duplicates');
    } else {
      console.log('\n🗑️  Deleting duplicates...');
      const result = await Notification.deleteMany({
        _id: {$in: idsToDelete},
      });
      
      logger.info('[DuplicateCleanup] ✅ Cleanup complete', {
        deleted: result.deletedCount,
      });
      
      console.log(`   ✅ Deleted ${result.deletedCount} duplicate notifications`);
    }

    process.exit(0);
  } catch (error) {
    logger.error('[DuplicateCleanup] ❌ Cleanup failed', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Parse command line args
const dryRun = process.argv.includes('--dry-run');

// Run if called directly
if (require.main === module) {
  if (dryRun) {
    console.log('🔍 Running in DRY RUN mode (no changes will be made)\n');
  }
  cleanupDuplicates(dryRun);
}

module.exports = {cleanupDuplicates};
