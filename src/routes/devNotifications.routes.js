/**
 * DEV-only Notification Testing Routes
 * 
 * ONLY available in non-production environments
 */

const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {
  triggerDigestAM,
  triggerDigestEOD,
  triggerDailySummary,
} = require('../controllers/devNotifications.controller');

/**
 * DEV security middleware
 * Requires DEV_PUSH_KEY header to prevent abuse
 */
const requireDevKey = (req, res, next) => {
  const devKey = process.env.DEV_PUSH_KEY;
  const providedKey = req.headers['x-dev-push-key'];

  if (!devKey) {
    return res.status(500).json({
      ok: false,
      error: 'DEV_PUSH_KEY not configured',
    });
  }

  if (providedKey !== devKey) {
    return res.status(403).json({
      ok: false,
      error: 'Invalid or missing X-DEV-PUSH-KEY header',
    });
  }

  next();
};

/**
 * POST /api/v1/dev/notifications/digest/am?date=YYYY-MM-DD
 * Trigger Daily Digest AM manually
 */
router.post('/digest/am', protect, requireDevKey, triggerDigestAM);

/**
 * POST /api/v1/dev/notifications/digest/eod?date=YYYY-MM-DD
 * Trigger Daily Digest EOD manually
 */
router.post('/digest/eod', protect, requireDevKey, triggerDigestEOD);

/**
 * POST /api/v1/dev/notifications/summary?date=YYYY-MM-DD
 * Trigger Daily Summary (legacy) manually
 */
router.post('/summary', protect, requireDevKey, triggerDailySummary);

module.exports = router;
