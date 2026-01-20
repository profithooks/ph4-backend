/**
 * Migration: Backfill Settings Defaults
 * 
 * Ensures all businesses have default settings
 * Step 15: Release Candidate
 */

module.exports = {
  name: '003_backfill_settings_defaults',

  async up(db) {
    console.log('Running migration: 003_backfill_settings_defaults');

    // Get all users (businesses)
    const users = await db.collection('users').find({}).toArray();

    let created = 0;
    for (const user of users) {
      // Check if settings exist
      const existing = await db.collection('businesssettings').findOne({
        userId: user._id,
      });

      if (!existing) {
        // Create default settings
        await db.collection('businesssettings').insertOne({
          userId: user._id,
          businessId: user._id,
          
          // Interest defaults
          interestEnabled: false,
          interestRatePctPerMonth: 2,
          interestGraceDays: 0,
          interestBasis: 'DAILY_SIMPLE',
          interestRounding: 'NEAREST_RUPEE',
          interestCapPctOfPrincipal: 100,
          interestApplyOn: 'OVERDUE_ONLY',
          
          // Financial year
          financialYearStartMonth: 4,
          
          // Plan defaults (Step 11)
          planName: 'FREE',
          seatsIncluded: 2,
          premiumInsightsEnabled: false,
          premiumInsightsCustomerCap: 50,
          
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        created++;
      }
    }

    console.log(`  BusinessSettings: Created ${created} default records`);
    console.log('✅ Settings defaults backfilled');
  },

  async down(db) {
    console.log('Rollback not implemented for 003_backfill_settings_defaults');
  },
};
