/**
 * DEV Push Notification Test Routes
 * 
 * Secure routes for testing push notifications from live backend
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { testPushNotification, broadcastPushNotification } = require('../controllers/devPush.controller');

/**
 * Security middleware: Verify DEV_PUSH_KEY header
 * Requires X-DEV-PUSH-KEY header to match DEV_PUSH_KEY env var
 */
const requireDevPushKey = (req, res, next) => {
  const envKey = process.env.DEV_PUSH_KEY;
  const headerKey = req.headers['x-dev-push-key'];

  // If DEV_PUSH_KEY not configured, block access entirely
  if (!envKey) {
    console.warn('[DevPush] DEV_PUSH_KEY not configured - endpoint disabled');
    return res.status(403).json({
      ok: false,
      error: 'DEV_PUSH_KEY not configured',
      message: 'This endpoint is disabled. Set DEV_PUSH_KEY in environment variables.',
    });
  }

  // Require header
  if (!headerKey) {
    return res.status(403).json({
      ok: false,
      error: 'X-DEV-PUSH-KEY header required',
      message: 'Missing X-DEV-PUSH-KEY header',
    });
  }

  // Verify key matches
  if (headerKey !== envKey) {
    console.warn('[DevPush] Invalid DEV_PUSH_KEY attempt', {
      ip: req.ip,
      userId: req.user?._id,
    });
    return res.status(403).json({
      ok: false,
      error: 'Invalid X-DEV-PUSH-KEY',
      message: 'Invalid dev push key',
    });
  }

  // Key valid - proceed
  next();
};

/**
 * POST /api/v1/dev/push/test
 * Test push notification to authenticated user's devices
 * 
 * Security:
 * - JWT authentication (protect middleware)
 * - DEV_PUSH_KEY header (requireDevPushKey middleware)
 */
router.post(
  '/push/test',
  protect,           // Require JWT auth
  requireDevPushKey, // Require DEV_PUSH_KEY header
  testPushNotification
);

/**
 * POST /api/v1/dev/push/broadcast
 * Broadcast push notification to ALL devices with FCM tokens
 * 
 * Security:
 * - JWT authentication (protect middleware)
 * - DEV_PUSH_KEY header (requireDevPushKey middleware)
 * 
 * Warning: Sends to ALL devices, not just authenticated user's
 */
router.post(
  '/push/broadcast',
  protect,           // Require JWT auth
  requireDevPushKey, // Require DEV_PUSH_KEY header
  broadcastPushNotification
);

module.exports = router;
