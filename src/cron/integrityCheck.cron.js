/**
 * Integrity Check Cron Job
 * 
 * Runs nightly integrity checks for all businesses
 * Step 21: Data Integrity & Reconciliation
 */
const cron = require('node-cron');
const BusinessSettings = require('../models/BusinessSettings');
const IntegrityReport = require('../models/IntegrityReport');
const Notification = require('../models/Notification');
const NotificationAttempt = require('../models/NotificationAttempt');
const AuditEvent = require('../models/AuditEvent');
const { runAllIntegrityChecks } = require('../integrity/integrityChecks');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Run integrity check for a single business
 */
async function runIntegrityCheckForBusiness(businessId) {
  const requestId = uuidv4();
  
  try {
    logger.info('[IntegrityCron] Running integrity check', { businessId, requestId });

    // Run all checks
    const result = await runAllIntegrityChecks(businessId, requestId);

    // Create report
    const report = await IntegrityReport.create({
      businessId,
      runAt: new Date(),
      status: result.status,
      checks: result.checks,
      repaired: result.repaired,
      requestId,
      triggeredBy: 'CRON',
      durationMs: result.durationMs,
    });

    // Create audit event
    await AuditEvent.create({
      at: new Date(),
      businessId,
      action: 'INTEGRITY_CHECK_RUN',
      entityType: 'INTEGRITY_REPORT',
      entityId: report._id.toString(),
      metadata: {
        status: result.status,
        checksRun: result.checks.length,
        repaired: result.repaired.length,
        triggeredBy: 'CRON',
        requestId,
      },
    });

    // If FAIL, create notification to owner
    if (result.status === 'FAIL') {
      await createIntegrityAlertForBusiness(businessId, report);
    }

    logger.info('[IntegrityCron] Integrity check completed', {
      businessId,
      status: result.status,
      durationMs: result.durationMs,
    });

    return { businessId, status: result.status, report: report._id };
  } catch (error) {
    logger.error('[IntegrityCron] Integrity check failed', {
      businessId,
      error: error.message,
      stack: error.stack,
    });
    
    return { businessId, status: 'ERROR', error: error.message };
  }
}

/**
 * Create in-app notification for integrity failure
 */
async function createIntegrityAlertForBusiness(businessId, report) {
  try {
    // Find owner user for this business
    const business = await Business.findById(businessId).populate('userId');
    if (!business || !business.userId) {
      logger.warn('[IntegrityCron] No owner found for business', { businessId });
      return;
    }

    const userId = business.userId._id;
    const failedChecks = report.checks.filter(c => c.status === 'FAIL');
    const warnChecks = report.checks.filter(c => c.status === 'WARN');

    const notification = await Notification.create({
      businessId,
      userId,
      kind: 'SYSTEM',
      title: 'Data Integrity Issue Detected',
      body: `Nightly check found ${failedChecks.length} critical issue(s) and ${warnChecks.length} warning(s). Tap to review.`,
      channels: ['IN_APP'],
      metadata: {
        reportId: report._id.toString(),
        failedChecks: failedChecks.map(c => c.code),
        triggeredBy: 'CRON',
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

    logger.info('[IntegrityCron] Integrity alert notification created', {
      businessId,
      notificationId: notification._id,
    });
  } catch (error) {
    logger.error('[IntegrityCron] Failed to create integrity alert', {
      businessId,
      error: error.message,
    });
  }
}

/**
 * Run integrity checks for all active businesses
 */
async function runNightlyIntegrityChecks() {
  const startTime = Date.now();
  
  try {
    logger.info('[IntegrityCron] Starting nightly integrity checks');

    // Get all unique businessIds from BusinessSettings
    const businessSettings = await BusinessSettings.find({}).select('businessId').lean();
    const businesses = businessSettings.map(s => ({ _id: s.businessId }));

    logger.info('[IntegrityCron] Found businesses to check', {
      count: businesses.length,
    });

    // Run checks sequentially to avoid overloading DB
    const results = [];
    for (const business of businesses) {
      const result = await runIntegrityCheckForBusiness(business._id);
      results.push(result);
      
      // Small delay between businesses to avoid hammering DB
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const durationMs = Date.now() - startTime;
    const summary = {
      total: results.length,
      pass: results.filter(r => r.status === 'PASS').length,
      warn: results.filter(r => r.status === 'WARN').length,
      fail: results.filter(r => r.status === 'FAIL').length,
      error: results.filter(r => r.status === 'ERROR').length,
    };

    logger.info('[IntegrityCron] Nightly integrity checks completed', {
      ...summary,
      durationMs,
    });
  } catch (error) {
    logger.error('[IntegrityCron] Nightly integrity check failed', {
      error: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Schedule nightly integrity checks
 * Runs at 2:30 AM every day (server time)
 */
function scheduleIntegrityChecks() {
  // Run at 2:30 AM every day
  // Cron pattern: minute hour day month dayOfWeek
  const cronPattern = '30 2 * * *';
  
  cron.schedule(cronPattern, async () => {
    logger.info('[IntegrityCron] Triggered by schedule');
    await runNightlyIntegrityChecks();
  }, {
    scheduled: true,
    timezone: process.env.TZ || 'Asia/Kolkata', // Default to IST
  });

  logger.info('[IntegrityCron] Scheduled nightly integrity checks', {
    pattern: cronPattern,
    timezone: process.env.TZ || 'Asia/Kolkata',
    time: '2:30 AM',
  });
}

module.exports = {
  scheduleIntegrityChecks,
  runNightlyIntegrityChecks,
  runIntegrityCheckForBusiness,
};
