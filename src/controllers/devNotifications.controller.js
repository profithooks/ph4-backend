/**
 * DEV-only Notification Testing Controller
 * 
 * Provides endpoints to manually trigger notification generators
 * ONLY available in non-production environments
 */

const asyncHandler = require('express-async-handler');
const {generateDailyDigestAM, generateDailyDigestEOD} = require('../services/notifications/generators/dailyDigest.generator');
const {generateDailySummaryNotifications} = require('../services/notifications/generators/dailySummary');
const logger = require('../utils/logger');

/**
 * Trigger Daily Digest AM manually
 * POST /api/v1/dev/notifications/digest/am?date=YYYY-MM-DD
 */
exports.triggerDigestAM = asyncHandler(async (req, res) => {
  const {date} = req.query;
  
  const targetDate = date ? new Date(date) : new Date();
  
  logger.info('[DevNotifications] Triggering Daily Digest AM', {
    date: date || 'today',
    targetDate: targetDate.toISOString(),
  });

  const result = await generateDailyDigestAM({date: targetDate});

  res.json({
    ok: true,
    generator: 'DAILY_DIGEST_AM',
    date: date || 'today',
    result: {
      created: result.created,
      skipped: result.skipped,
    },
  });
});

/**
 * Trigger Daily Digest EOD manually
 * POST /api/v1/dev/notifications/digest/eod?date=YYYY-MM-DD
 */
exports.triggerDigestEOD = asyncHandler(async (req, res) => {
  const {date} = req.query;
  
  const targetDate = date ? new Date(date) : new Date();
  
  logger.info('[DevNotifications] Triggering Daily Digest EOD', {
    date: date || 'today',
    targetDate: targetDate.toISOString(),
  });

  const result = await generateDailyDigestEOD({date: targetDate});

  res.json({
    ok: true,
    generator: 'DAILY_DIGEST_EOD',
    date: date || 'today',
    result: {
      created: result.created,
      skipped: result.skipped,
    },
  });
});

/**
 * Trigger Daily Summary (legacy) manually
 * POST /api/v1/dev/notifications/summary?date=YYYY-MM-DD
 */
exports.triggerDailySummary = asyncHandler(async (req, res) => {
  const {date} = req.query;
  
  const targetDate = date ? new Date(date) : new Date();
  
  logger.info('[DevNotifications] Triggering Daily Summary (legacy)', {
    date: date || 'today',
    targetDate: targetDate.toISOString(),
  });

  const result = await generateDailySummaryNotifications({});

  res.json({
    ok: true,
    generator: 'DAILY_SUMMARY',
    date: date || 'today',
    result: {
      created: result.created,
      skipped: result.skipped,
    },
  });
});
