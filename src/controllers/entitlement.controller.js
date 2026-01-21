/**
 * Entitlement Controller - Pro Lifecycle Management
 * 
 * Handles plan status queries and transitions.
 * Returns permissions and limits based on trial/free/pro status.
 */

const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const Subscription = require('../models/Subscription');

/**
 * Get user's current entitlement status
 * 
 * @route   GET /api/v1/auth/me/entitlement
 * @access  Private
 */
const getEntitlement = asyncHandler(async (req, res) => {
  const user = req.user;
  
  // Step 1: Migrate missing trialEndsAt for existing users
  if (!user.trialEndsAt && user.planStatus === 'trial') {
    const userAge = Date.now() - user.createdAt.getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    if (userAge < twentyFourHours) {
      // User created recently - give full 30-day trial
      user.trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await user.save();
      console.log(`[Entitlement] Migrated trial for new user ${user._id}: 30 days`);
    } else {
      // User created long ago - expire trial immediately
      user.trialEndsAt = new Date();
      user.planStatus = 'free';
      await user.save();
      console.log(`[Entitlement] Migrated old user ${user._id}: trial expired`);
    }
  }
  
  // Step 2: Ensure daily counter is reset if new day (IST)
  await user.ensureDailyWriteCounter();
  
  // Step 3: Check trial expiry and downgrade if needed
  const now = new Date();
  let isTrialActive = false;
  let trialDaysLeft = 0;
  
  if (user.planStatus === 'trial' && user.trialEndsAt) {
    if (now > user.trialEndsAt) {
      // Trial expired - downgrade to free (unless already pro)
      if (user.planStatus !== 'pro') {
        user.planStatus = 'free';
        await user.save();
        console.log(`[Entitlement] Trial expired for user ${user._id}, downgraded to free`);
      }
    } else {
      // Trial still active
      isTrialActive = true;
      const daysLeft = Math.ceil((user.trialEndsAt - now) / (1000 * 60 * 60 * 24));
      trialDaysLeft = Math.max(0, daysLeft);
    }
  }
  
  // Step 4: Calculate permissions based on plan status
  const permissions = {
    canCreateBills: user.planStatus === 'trial' || user.planStatus === 'pro',
    canCreateCustomerWrites: true, // All users can create (with limits for free)
    canViewBills: true, // All users can view bills
  };
  
  // Step 5: Calculate limits based on plan status
  let limits = {};
  
  if (user.planStatus === 'free') {
    // Free users have 10/day limit
    const FREE_DAILY_LIMIT = 10;
    limits = {
      customerWritesPerDay: FREE_DAILY_LIMIT,
      customerWritesUsedToday: user.dailyWriteCount,
      customerWritesRemainingToday: Math.max(0, FREE_DAILY_LIMIT - user.dailyWriteCount),
    };
  } else {
    // Trial and Pro users have unlimited
    limits = {
      customerWritesPerDay: null, // null = unlimited
      customerWritesUsedToday: 0,
      customerWritesRemainingToday: null, // null = unlimited
    };
  }
  
  // Step 6: Get Pro subscription expiry info (if Pro user)
  let proExpiryInfo = null;
  if (user.planStatus === 'pro') {
    proExpiryInfo = await Subscription.getExpiryInfo(user._id);
  }
  
  // Step 7: Add debug notes if needed
  const notes = {};
  if (user.planStatus === 'free' && limits.customerWritesRemainingToday === 0) {
    notes.reason = 'Daily customer write limit reached. Resets at midnight IST.';
  }
  
  // Step 8: Return comprehensive entitlement contract
  res.status(200).json({
    success: true,
    data: {
      planStatus: user.planStatus,
      trialEndsAt: user.trialEndsAt,
      isTrialActive,
      trialDaysLeft,
      
      // Pro expiry info (null if not Pro or no active subscription)
      proExpiresAt: proExpiryInfo?.expiresAt || null,
      proExpiresInDays: proExpiryInfo?.daysLeft ?? null,
      isProExpiring: proExpiryInfo?.isExpiring || false,
      
      limits,
      permissions,
      notes: Object.keys(notes).length > 0 ? notes : undefined,
    },
  });
});

module.exports = {
  getEntitlement,
};
