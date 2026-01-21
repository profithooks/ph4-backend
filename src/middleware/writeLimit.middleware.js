/**
 * Write Limit Middleware - Enforce Freemium Entitlement
 * 
 * Checks if user can perform write operations based on:
 * - Trial users: unlimited (30 days)
 * - Pro users: unlimited
 * - Free users: 10 writes per day
 * 
 * Must be applied AFTER auth.middleware (requires req.user)
 */

const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');

/**
 * Middleware to check and enforce write limits
 * 
 * Usage:
 *   router.post('/endpoint', protect, checkWriteLimit, controller);
 * 
 * @throws 403 WRITE_LIMIT_EXCEEDED if daily limit reached
 */
const checkWriteLimit = asyncHandler(async (req, res, next) => {
  // Ensure user is authenticated
  if (!req.user) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }
  
  // Step 1: Ensure daily counter is reset if new day
  await req.user.ensureDailyWriteCounter();
  
  // Step 2: Check if user can write
  const writeCheck = req.user.canWrite();
  
  if (!writeCheck.allowed) {
    // User exceeded limit - return 403 with details
    return res.status(403).json({
      success: false,
      code: 'WRITE_LIMIT_EXCEEDED',
      message: writeCheck.reason || 'Write limit exceeded',
      limit: writeCheck.limit,
      resetAt: writeCheck.resetAt,
      meta: {
        planStatus: req.user.planStatus,
        dailyWriteCount: req.user.dailyWriteCount,
        dailyWriteDate: req.user.dailyWriteDate,
      },
    });
  }
  
  // Step 3: User can write - increment counter (optimistic)
  // We increment NOW so concurrent requests don't bypass the limit
  await req.user.incrementWriteCount();
  
  // Attach write metadata to request for logging/analytics
  req.writeMetadata = {
    planStatus: req.user.planStatus,
    writeNumber: req.user.dailyWriteCount,
    writeDate: req.user.dailyWriteDate,
  };
  
  // Allow request to proceed
  next();
});

/**
 * Optional: Decrement write count on rollback/error
 * Use this in error handlers if you want to refund failed writes
 */
const rollbackWriteCount = asyncHandler(async (req) => {
  if (req.user && req.writeMetadata) {
    req.user.dailyWriteCount = Math.max(0, req.user.dailyWriteCount - 1);
    await req.user.save();
    console.log(`[WriteLimit] Rolled back write count for user ${req.user._id}`);
  }
});

module.exports = {
  checkWriteLimit,
  rollbackWriteCount,
};
