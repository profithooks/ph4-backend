/**
 * Trial expiry and subscription expiry middleware
 * Silently transitions users between plan statuses
 */
const asyncHandler = require('express-async-handler');
const Subscription = require('../models/Subscription');

/**
 * Check and handle trial expiry
 * If trial has expired, transition to free plan
 */
const checkTrialExpiry = async (req, res, next) => {
  if (!req.user) {
    return next();
  }

  const user = req.user;
  const now = new Date();

  // Check trial expiry
  if (user.planStatus === 'trial' && user.trialEndsAt && now > user.trialEndsAt) {
    user.planStatus = 'free';
    user.planActivatedAt = now;
    await user.save({ validateBeforeSave: false });
    console.log(`[TrialExpiry] User ${user._id} trial expired, transitioned to free`);
  }

  next();
};

/**
 * Check and handle subscription expiry for Pro users
 * If subscription has expired, downgrade to free
 */
const checkSubscriptionExpiry = async (req, res, next) => {
  if (!req.user) {
    return next();
  }

  const user = req.user;

  // Only check Pro users
  if (user.planStatus === 'pro') {
    // Find active subscription
    const subscription = await Subscription.findActiveByUserId(user._id);

    if (!subscription) {
      // No active subscription found - downgrade to free
      user.planStatus = 'free';
      await user.save({ validateBeforeSave: false });
      console.log(`[SubscriptionExpiry] User ${user._id} has no active subscription, downgraded to free`);
    } else {
      // Check if subscription is expired
      const isExpired = await subscription.checkAndMarkExpired();
      if (isExpired) {
        // Subscription expired - downgrade to free
        user.planStatus = 'free';
        await user.save({ validateBeforeSave: false });
        console.log(`[SubscriptionExpiry] User ${user._id} subscription expired, downgraded to free`);
      }
    }
  }

  next();
};

/**
 * Combined middleware - checks both trial and subscription expiry
 */
const checkPlanExpiry = async (req, res, next) => {
  await checkTrialExpiry(req, res, () => {});
  await checkSubscriptionExpiry(req, res, next);
};

module.exports = {
  checkTrialExpiry,
  checkSubscriptionExpiry,
  checkPlanExpiry,
};
