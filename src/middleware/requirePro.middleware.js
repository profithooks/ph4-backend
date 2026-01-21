/**
 * Require Pro Middleware - Pro-Only Feature Gating
 * 
 * Blocks free users from accessing Pro-only features.
 * Allows Pro and Trial users (trial includes Pro features).
 * 
 * Returns 403 PRO_REQUIRED if user is on free plan.
 */

const asyncHandler = require('express-async-handler');
const AppError = require('../utils/appError');

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
 * @throws 403 PRO_REQUIRED if user is on free plan
 */
const requirePro = asyncHandler(async (req, res, next) => {
  // Ensure user is authenticated
  if (!req.user) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  const planStatus = req.user.planStatus;

  // Pro users: allowed
  if (planStatus === 'pro') {
    console.log(`[RequirePro] Pro user ${req.user._id} allowed`);
    return next();
  }

  // Trial users: allowed (Pro features included in trial)
  if (planStatus === 'trial') {
    console.log(`[RequirePro] Trial user ${req.user._id} allowed`);
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
        upgradeUrl: '/pro/upgrade', // Future: link to upgrade page
      },
    });
  }

  // Unknown plan status - deny by default
  console.error(`[RequirePro] Unknown plan status for user ${req.user._id}: ${planStatus}`);
  throw new AppError('Invalid plan status', 403, 'INVALID_PLAN_STATUS');
});

module.exports = {requirePro};
