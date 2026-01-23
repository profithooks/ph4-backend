/**
 * Ops Routes - Internal Operations & Manual Overrides
 * 
 * SECURITY:
 * - Non-production: Open for testing
 * - Production: Requires X-Admin-Secret header
 * 
 * Purpose:
 * - Manual Pro activations (testing, comps, support)
 * - Debug endpoints (entitlement inspection)
 * - System health checks
 */

const express = require('express');
const router = express.Router();
const {
  activateProManually,
  getUserEntitlement,
  sendTestPush,
} = require('../controllers/ops.controller');

/**
 * Admin secret middleware (production only)
 * 
 * In production, requires X-Admin-Secret header to match ADMIN_SECRET env var.
 * In non-production, allows all requests (for testing convenience).
 */
const requireAdminSecret = (req, res, next) => {
  // In non-production, allow all
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Ops] Non-production environment - admin check bypassed');
    return next();
  }
  
  // In production, verify secret
  const secret = req.headers['x-admin-secret'];
  const expectedSecret = process.env.ADMIN_SECRET;
  
  if (!expectedSecret) {
    console.error('[Ops] ADMIN_SECRET not configured in production');
    return res.status(500).json({
      success: false,
      message: 'Admin operations not configured',
    });
  }
  
  if (secret !== expectedSecret) {
    console.warn('[Ops] Invalid admin secret attempt');
    return res.status(403).json({
      success: false,
      message: 'Forbidden - Invalid admin secret',
    });
  }
  
  next();
};

// Apply admin secret guard to all routes
router.use(requireAdminSecret);

/**
 * Manual Pro activation
 * 
 * @route   POST /ops/users/:id/activate-pro
 * @access  Admin (X-Admin-Secret required in production)
 * @body    { durationDays?: number, reason?: string }
 * @desc    Manually upgrade user to Pro
 * 
 * Example:
 * curl -X POST http://localhost:5055/api/v1/ops/users/USER_ID/activate-pro \
 *   -H "X-Admin-Secret: YOUR_SECRET" \
 *   -H "Content-Type: application/json" \
 *   -d '{"durationDays": 30, "reason": "comp_account"}'
 */
router.post('/users/:id/activate-pro', activateProManually);

/**
 * Get user entitlement details (debugging)
 * 
 * @route   GET /ops/users/:id/entitlement
 * @access  Admin (X-Admin-Secret required in production)
 * @desc    Get detailed entitlement info for debugging
 * 
 * Example:
 * curl http://localhost:5055/api/v1/ops/users/USER_ID/entitlement \
 *   -H "X-Admin-Secret: YOUR_SECRET"
 */
router.get('/users/:id/entitlement', getUserEntitlement);

/**
 * Send test push notification
 * 
 * @route   POST /ops/users/:id/test-push
 * @access  Admin (X-Admin-Secret required in production)
 * @body    { kind?: string, title?: string, body?: string }
 * @desc    Send a test push notification to user's trusted devices
 * 
 * Example:
 * curl -X POST http://localhost:5055/api/v1/ops/users/USER_ID/test-push \
 *   -H "Content-Type: application/json" \
 *   -d '{"kind": "DAILY_SUMMARY", "title": "Test", "body": "Test message"}'
 */
router.post('/users/:id/test-push', sendTestPush);

module.exports = router;
