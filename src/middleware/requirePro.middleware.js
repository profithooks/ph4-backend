/**
 * Require Pro Middleware - Pro-Only Feature Gating
 * 
 * Blocks free users from accessing Pro-only features.
 * Allows Pro and Trial users (trial includes Pro features).
 * 
 * Returns 403 PRO_REQUIRED if user is on free plan.
 */

const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');

/**
 * Middleware to require Pro plan access
 * 
 * Usage:
 *   router.use(protect);  // Must come after auth
 *   router.use(requirePro);  // Apply to all routes in this router
 * 
 * Or per-route:
 *   router.get('/bills', protect, requirePro, listBills);
 * 
 * Security: Verifies BOTH planStatus='pro' AND active subscription with valid expiresAt
 * This prevents Pro leakage when subscription expires but planStatus not yet updated
 * 
 * @throws 403 PRO_REQUIRED if user is on free plan or subscription expired
 */
const requirePro = asyncHandler(async (req, res, next) => {
  // Ensure user is authenticated
  if (!req.user) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  const planStatus = req.user.planStatus;

  // Trial users: allowed (Pro features included in trial)
  if (planStatus === 'trial') {
    console.log(`[RequirePro] Trial user ${req.user._id} allowed`);
    return next();
  }

  // Pro users: verify active subscription with valid expiry
  if (planStatus === 'pro') {
    // Additional check: verify subscription is actually active (not just planStatus)
    // This is a safety net in case cron/middleware missed an expiry
    const Subscription = require('../models/Subscription');
    const activeSubscription = await Subscription.findOne({
      userId: req.user._id,
      status: 'active',
      expiresAt: { $gt: new Date() }, // Must expire in future
    });

    if (!activeSubscription) {
      // Pro status but no active subscription - expired or invalid
      console.warn(`[RequirePro] Pro user ${req.user._id} has no active subscription - blocking`);
      
      return res.status(403).json({
        success: false,
        code: 'PRO_EXPIRED',
        message: 'Your Pro subscription has expired. Please renew to continue.',
        meta: {
          planStatus: 'pro',
          subscriptionExpired: true,
          feature: 'pro_feature',
          upgradeUrl: '/pro/upgrade',
        },
      });
    }

    console.log(`[RequirePro] Pro user ${req.user._id} allowed (subscription expires: ${activeSubscription.expiresAt})`);
    return next();
  }

  // Free users: blocked
  if (planStatus === 'free') {
    console.log(`[RequirePro] Free user ${req.user._id} blocked`);
    
    return res.status(403).json({
      success: false,
      code: 'PRO_REQUIRED',
      message: 'This feature requires a Pro plan',
      meta: {
        planStatus: 'free',
        feature: 'pro_feature',
        upgradeUrl: '/pro/upgrade',
      },
    });
  }

  // Unknown plan status - deny by default
  console.error(`[RequirePro] Unknown plan status for user ${req.user._id}: ${planStatus}`);
  throw new AppError('Invalid plan status', 403, 'INVALID_PLAN_STATUS');
});

module.exports = {requirePro};
