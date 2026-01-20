/**
 * Migration: Backfill Soft Delete Defaults
 * 
 * Ensures all documents have isDeleted: false if missing
 * Step 15: Release Candidate
 */

module.exports = {
  name: '002_backfill_soft_delete_defaults',

  async up(db) {
    console.log('Running migration: 002_backfill_soft_delete_defaults');

    // Bills
    const billsResult = await db.collection('bills').updateMany(
      {isDeleted: {$exists: false}},
      {$set: {isDeleted: false}}
    );
    console.log(`  Bills: Updated ${billsResult.modifiedCount} documents`);

    // Customers
    const customersResult = await db.collection('customers').updateMany(
      {isDeleted: {$exists: false}},
      {$set: {isDeleted: false}}
    );
    console.log(`  Customers: Updated ${customersResult.modifiedCount} documents`);

    // FollowUpTasks
    const followupsResult = await db.collection('followuptasks').updateMany(
      {isDeleted: {$exists: false}},
      {$set: {isDeleted: false}}
    );
    console.log(`  FollowUpTasks: Updated ${followupsResult.modifiedCount} documents`);

    console.log('✅ Soft-delete defaults backfilled');
  },

  async down(db) {
    // Optional: Remove the field if needed
    console.log('Rollback not implemented for 002_backfill_soft_delete_defaults');
  },
};
