/**
 * Diagnostics controller
 * 
 * Provides read-only access to reliability events for debugging
 */
const asyncHandler = require('express-async-handler');
const ReliabilityEvent = require('../models/ReliabilityEvent');
const AppError = require('../utils/AppError');

/**
 * Get reliability events for diagnostics
 * GET /api/v1/diagnostics/reliability?limit=100&kind=WRITE_FAIL
 * 
 * @access Private (requires auth)
 */
const getReliabilityEvents = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500); // Max 500
  const kind = req.query.kind; // Optional filter: WRITE_FAIL, ENGINE_FAIL, etc.
  
  // Build query
  const query = {
    userId,
  };
  
  if (kind && ['WRITE_FAIL', 'ENGINE_FAIL', 'SYNC_FAIL', 'NOTIF_FAIL'].includes(kind)) {
    query.kind = kind;
  }
  
  // Fetch events
  const events = await ReliabilityEvent.find(query)
    .sort({at: -1}) // Most recent first
    .limit(limit)
    .select('-__v') // Exclude version key
    .lean();
  
  // Sanitize events - remove sensitive data
  const sanitized = events.map(event => ({
    id: event._id,
    requestId: event.requestId,
    at: event.at,
    layer: event.layer,
    kind: event.kind,
    route: event.route,
    method: event.method,
    entityType: event.entityType,
    entityId: event.entityId,
    code: event.code,
    message: event.message,
    retryable: event.retryable,
    status: event.status,
    // Only include details if not sensitive
    details: event.details?.errors || event.details?.statusCode ? {
      errors: event.details.errors,
      statusCode: event.details.statusCode,
    } : undefined,
  }));
  
  res.success({
    events: sanitized,
    count: sanitized.length,
    limit,
  });
});

/**
 * Get reliability event by requestId
 * GET /api/v1/diagnostics/reliability/:requestId
 * 
 * @access Private (requires auth)
 */
const getReliabilityEventByRequestId = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const {requestId} = req.params;
  
  const events = await ReliabilityEvent.find({
    requestId,
    userId,
  })
    .sort({at: -1})
    .select('-__v')
    .lean();
  
  if (!events || events.length === 0) {
    throw new AppError('No events found for this requestId', 404, 'NOT_FOUND');
  }
  
  // Sanitize
  const sanitized = events.map(event => ({
    id: event._id,
    requestId: event.requestId,
    at: event.at,
    layer: event.layer,
    kind: event.kind,
    route: event.route,
    method: event.method,
    entityType: event.entityType,
    entityId: event.entityId,
    code: event.code,
    message: event.message,
    retryable: event.retryable,
    status: event.status,
    details: event.details,
  }));
  
  res.success({
    events: sanitized,
    count: sanitized.length,
  });
});

/**
 * Get reliability stats summary
 * GET /api/v1/diagnostics/reliability/stats
 * 
 * @access Private (requires auth)
 */
const getReliabilityStats = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const hours = parseInt(req.query.hours, 10) || 24; // Default last 24 hours
  
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  // Aggregate stats by kind
  const stats = await ReliabilityEvent.aggregate([
    {
      $match: {
        userId,
        at: {$gte: since},
      },
    },
    {
      $group: {
        _id: '$kind',
        count: {$sum: 1},
        retryableCount: {
          $sum: {$cond: ['$retryable', 1, 0]},
        },
      },
    },
  ]);
  
  // Total count
  const total = await ReliabilityEvent.countDocuments({
    userId,
    at: {$gte: since},
  });
  
  res.success({
    total,
    byKind: stats.reduce((acc, s) => {
      acc[s._id] = {
        count: s.count,
        retryable: s.retryableCount,
      };
      return acc;
    }, {}),
    since,
    hours,
  });
});

/**
 * Dry-run notification generation (DEV only)
 * Returns what notifications WOULD be created without actually creating them
 * 
 * @route   GET /api/v1/dev/notifications/dry-run
 * @access  Private (DEV only)
 */
const notificationDryRun = asyncHandler(async (req, res) => {
  // DEV-only check
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not available in production',
      },
    });
  }

  try {
    const BusinessSettings = require('../models/BusinessSettings');
    const {generateFollowupDueNotifications} = require('../services/notifications/generators/followupDue');
    const {
      generatePromiseDueTodayNotifications,
      generatePromiseBrokenNotifications,
    } = require('../services/notifications/generators/promiseNotifications');
    const {
      generateDueTodayNotifications,
      generateOverdueAlertNotifications,
    } = require('../services/notifications/generators/billNotifications');
    const {generateDailySummaryNotifications} = require('../services/notifications/generators/dailySummary');
    const FollowUpTask = require('../models/FollowUpTask');
    const RecoveryCase = require('../models/RecoveryCase');
    const Bill = require('../models/Bill');
    const {getNowIST, getStartOfDayIST, getEndOfDayIST} = require('../utils/timezone.util');

    const now = getNowIST();
    const startOfToday = getStartOfDayIST(now);
    const endOfToday = getEndOfDayIST(now);

    // Count what would be generated (read-only queries)
    const report = {
      timestamp: now.toISOString(),
      istTime: now.toISOString(),
      counts: {},
      sampleIdempotencyKeys: {},
    };

    // Count followups due
    const followupsDue = await FollowUpTask.countDocuments({
      status: 'pending',
      isDeleted: {$ne: true},
      dueAt: {
        $gte: new Date(now.getTime() - 30 * 60 * 1000),
        $lte: new Date(now.getTime() + 15 * 60 * 1000),
      },
    });
    report.counts.FOLLOWUP_DUE = followupsDue;
    if (followupsDue > 0) {
      const sample = await FollowUpTask.findOne({
        status: 'pending',
        isDeleted: {$ne: true},
        dueAt: {
          $gte: new Date(now.getTime() - 30 * 60 * 1000),
          $lte: new Date(now.getTime() + 15 * 60 * 1000),
        },
      }).lean();
      if (sample) {
        const hourBucket = new Date(sample.dueAt).toISOString().substring(0, 13);
        report.sampleIdempotencyKeys.FOLLOWUP_DUE = `FOLLOWUP_DUE:${String(sample.customerId)}:${String(sample._id)}:${hourBucket}`;
      }
    }

    // Count promises due today
    const promisesDueToday = await RecoveryCase.countDocuments({
      promiseStatus: 'DUE_TODAY',
      promiseAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
      status: {$in: ['open', 'promised']},
    });
    report.counts.PROMISE_DUE_TODAY = promisesDueToday;
    if (promisesDueToday > 0) {
      const sample = await RecoveryCase.findOne({
        promiseStatus: 'DUE_TODAY',
        promiseAt: {
          $gte: startOfToday,
          $lte: endOfToday,
        },
        status: {$in: ['open', 'promised']},
      }).lean();
      if (sample) {
        const dateStr = new Date(sample.promiseAt).toISOString().substring(0, 10);
        report.sampleIdempotencyKeys.PROMISE_DUE_TODAY = `PROMISE_DUE_TODAY:${String(sample.customerId)}:${String(sample._id)}:${dateStr}`;
      }
    }

    // Count broken promises
    const brokenPromises = await RecoveryCase.countDocuments({
      promiseStatus: 'BROKEN',
      promiseAt: {$lt: startOfToday},
      status: {$in: ['open', 'promised']},
    });
    report.counts.PROMISE_BROKEN = brokenPromises;
    if (brokenPromises > 0) {
      const sample = await RecoveryCase.findOne({
        promiseStatus: 'BROKEN',
        promiseAt: {$lt: startOfToday},
        status: {$in: ['open', 'promised']},
      }).lean();
      if (sample) {
        const dateStr = new Date(sample.promiseAt).toISOString().substring(0, 10);
        report.sampleIdempotencyKeys.PROMISE_BROKEN = `PROMISE_BROKEN:${String(sample.customerId)}:${String(sample._id)}:${dateStr}`;
      }
    }

    // Count due today (customers with bills due today)
    const billsDueToday = await Bill.find({
      dueDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
      status: {$in: ['unpaid', 'partial']},
      isDeleted: {$ne: true},
    }).lean();
    const customersDueToday = new Set();
    for (const bill of billsDueToday) {
      const pending = bill.grandTotal - (bill.paidAmount || 0);
      if (pending > 0) {
        customersDueToday.add(String(bill.customerId));
      }
    }
    report.counts.DUE_TODAY = customersDueToday.size;
    if (customersDueToday.size > 0) {
      const customerId = Array.from(customersDueToday)[0];
      const dateStr = now.toISOString().substring(0, 10);
      report.sampleIdempotencyKeys.DUE_TODAY = `DUE_TODAY:${customerId}:${dateStr}`;
    }

    // Count overdue (customers with overdue bills)
    const overdueBills = await Bill.find({
      dueDate: {$lt: startOfToday},
      status: {$in: ['unpaid', 'partial']},
      isDeleted: {$ne: true},
    }).lean();
    const overdueCustomers = new Set();
    for (const bill of overdueBills) {
      const pending = bill.grandTotal - (bill.paidAmount || 0);
      if (pending > 0) {
        overdueCustomers.add(String(bill.customerId));
      }
    }
    report.counts.OVERDUE_ALERT = overdueCustomers.size;
    if (overdueCustomers.size > 0) {
      const customerId = Array.from(overdueCustomers)[0];
      const dateStr = now.toISOString().substring(0, 10);
      report.sampleIdempotencyKeys.OVERDUE_ALERT = `OVERDUE_ALERT:${customerId}:${dateStr}`;
    }

    // Daily summary would be generated for all users (count users)
    const User = require('../models/User');
    const userCount = await User.countDocuments({});
    report.counts.DAILY_SUMMARY = userCount;
    if (userCount > 0) {
      const sampleUser = await User.findOne().lean();
      if (sampleUser) {
        const dateStr = now.toISOString().substring(0, 10);
        report.sampleIdempotencyKeys.DAILY_SUMMARY = `DAILY_SUMMARY:${String(sampleUser._id)}:${dateStr}`;
      }
    }

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    logger.error('[Diagnostics] Dry-run failed', error);
    throw new AppError('Dry-run failed', 500, 'INTERNAL_ERROR');
  }
});

module.exports = {
  getReliabilityEvents,
  getReliabilityEventByRequestId,
  getReliabilityStats,
  notificationDryRun,
};
