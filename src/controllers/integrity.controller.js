/**
 * Integrity Controller
 * 
 * Handles integrity check requests and reporting
 * Step 21: Data Integrity & Reconciliation
 */
const asyncHandler = require('express-async-handler');
const IntegrityReport = require('../models/IntegrityReport');
const Notification = require('../models/Notification');
const NotificationAttempt = require('../models/NotificationAttempt');
const AuditEvent = require('../models/AuditEvent');
const { runAllIntegrityChecks } = require('../integrity/integrityChecks');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * GET /api/v1/diagnostics/integrity/latest
 * Get the latest integrity report for the business
 */
const getLatestIntegrityReport = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;

  const latestReport = await IntegrityReport.findOne({ businessId })
    .sort({ runAt: -1 })
    .lean();

  if (!latestReport) {
    return res.success({
      report: null,
      message: 'No integrity reports found. Run your first check.',
    });
  }

  res.success({
    report: latestReport,
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * GET /api/v1/diagnostics/integrity/history
 * Get integrity report history
 */
const getIntegrityReportHistory = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const skip = parseInt(req.query.skip, 10) || 0;

  const reports = await IntegrityReport.find({ businessId })
    .sort({ runAt: -1 })
    .limit(limit)
    .skip(skip)
    .select('-checks.sampleIds -repaired.sampleIds')
    .lean();

  const total = await IntegrityReport.countDocuments({ businessId });

  res.success({
    reports,
    total,
    returned: reports.length,
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * POST /api/v1/diagnostics/integrity/run
 * Run integrity checks on-demand (owner only)
 */
const runIntegrityCheck = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const userId = req.user._id;

  logger.info('[IntegrityController] Manual integrity check requested', {
    businessId,
    userId,
    requestId: req.requestId,
  });

  // Run all checks
  const result = await runAllIntegrityChecks(businessId, req.requestId);

  // Create report
  const report = await IntegrityReport.create({
    businessId,
    runAt: new Date(),
    status: result.status,
    checks: result.checks,
    repaired: result.repaired,
    requestId: req.requestId,
    triggeredBy: 'MANUAL',
    durationMs: result.durationMs,
  });

  // Create audit event
  await AuditEvent.create({
    at: new Date(),
    businessId,
    actorUserId: userId,
    actorRole: req.user.role,
    action: 'INTEGRITY_CHECK_RUN',
    entityType: 'INTEGRITY_REPORT',
    entityId: report._id.toString(),
    metadata: {
      status: result.status,
      checksRun: result.checks.length,
      repaired: result.repaired.length,
      requestId: req.requestId,
    },
  });

  // If FAIL, create notification
  if (result.status === 'FAIL') {
    await createIntegrityAlertNotification(businessId, userId, report);
  }

  logger.info('[IntegrityController] Integrity check completed', {
    businessId,
    status: result.status,
    durationMs: result.durationMs,
  });

  res.success({
    report,
    message: `Integrity check completed with status: ${result.status}`,
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * Create in-app notification for integrity failure
 */
async function createIntegrityAlertNotification(businessId, userId, report) {
  try {
    const failedChecks = report.checks.filter(c => c.status === 'FAIL');
    const warnChecks = report.checks.filter(c => c.status === 'WARN');

    const notification = await Notification.create({
      businessId,
      userId,
      kind: 'SYSTEM',
      title: 'Data Integrity Issue Detected',
      body: `${failedChecks.length} critical issue(s) and ${warnChecks.length} warning(s) found. Tap to review.`,
      channels: ['IN_APP'],
      metadata: {
        reportId: report._id.toString(),
        failedChecks: failedChecks.map(c => c.code),
      },
    });

    // Create IN_APP attempt (auto-delivered)
    await NotificationAttempt.create({
      notificationId: notification._id,
      channel: 'IN_APP',
      status: 'SENT',
      attemptNo: 1,
      nextAttemptAt: new Date(),
    });

    logger.info('[IntegrityController] Integrity alert notification created', {
      businessId,
      notificationId: notification._id,
    });
  } catch (error) {
    logger.error('[IntegrityController] Failed to create integrity alert', error);
  }
}

module.exports = {
  getLatestIntegrityReport,
  getIntegrityReportHistory,
  runIntegrityCheck,
};
