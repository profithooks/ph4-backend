/**
 * Ops Weekly Controller
 * 
 * Weekly metrics, KPIs, and drift detection for post-launch feedback loop
 * Step 24: Post-Launch Metrics & Feedback Loop
 */
const asyncHandler = require('express-async-handler');
const AuditEvent = require('../models/AuditEvent');
const ReliabilityEvent = require('../models/ReliabilityEvent');
const IntegrityReport = require('../models/IntegrityReport');
const SupportTicket = require('../models/SupportTicket');
const Bill = require('../models/Bill');
const Customer = require('../models/Customer');
const RecoveryCase = require('../models/RecoveryCase');
const logger = require('../utils/logger');

/**
 * Get date range for weekly window
 */
function getWeeklyDateRange(fromParam, toParam) {
  const now = new Date();
  
  let from, to;
  
  if (fromParam && toParam) {
    from = new Date(fromParam);
    to = new Date(toParam);
    to.setHours(23, 59, 59, 999); // End of day
  } else {
    // Default: last 7 days
    to = new Date(now);
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  
  return { from, to };
}

/**
 * Compute Reliability KPIs
 */
async function computeReliabilityKPIs(businessId, from, to) {
  // Write failures
  const writeFails = await ReliabilityEvent.countDocuments({
    businessId,
    kind: 'WRITE_FAIL',
    at: { $gte: from, $lte: to },
  });

  // Total writes (proxy: bills + customers created)
  const billsCreated = await Bill.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
  });
  
  const customersAdded = await Customer.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
  });
  
  const totalWrites = billsCreated + customersAdded;
  
  const writeFailureRate = totalWrites > 0 ? (writeFails / totalWrites) * 100 : 0;

  // Sync failures
  const syncFails = await ReliabilityEvent.countDocuments({
    businessId,
    kind: 'SYNC_FAIL',
    at: { $gte: from, $lte: to },
  });
  
  const syncFailureRate = totalWrites > 0 ? (syncFails / totalWrites) * 100 : 0;

  // Notification failures (attempts with status FAILED)
  const NotificationAttempt = require('../models/NotificationAttempt');
  const notificationFails = await NotificationAttempt.countDocuments({
    businessId,
    status: 'FAILED',
    createdAt: { $gte: from, $lte: to },
  });
  
  const notificationTotal = await NotificationAttempt.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
  });
  
  const notificationFailureRate = notificationTotal > 0 ? (notificationFails / notificationTotal) * 100 : 0;

  // Integrity failures
  const integrityFailCount = await IntegrityReport.countDocuments({
    businessId,
    runAt: { $gte: from, $lte: to },
    status: 'FAIL',
  });

  return {
    writeFails,
    totalWrites,
    writeFailureRate: parseFloat(writeFailureRate.toFixed(2)),
    syncFails,
    syncFailureRate: parseFloat(syncFailureRate.toFixed(2)),
    notificationFails,
    notificationTotal,
    notificationFailureRate: parseFloat(notificationFailureRate.toFixed(2)),
    integrityFailCount,
  };
}

/**
 * Compute Control Enforcement KPIs
 */
async function computeControlEnforcementKPIs(businessId, from, to) {
  // Credit limit blocks
  const creditLimitBlocks = await AuditEvent.countDocuments({
    businessId,
    action: 'CREDIT_LIMIT_BREACH_BLOCK',
    at: { $gte: from, $lte: to },
  });

  // Credit limit overrides
  const creditLimitOverrides = await AuditEvent.countDocuments({
    businessId,
    action: 'CREDIT_LIMIT_OVERRIDE',
    at: { $gte: from, $lte: to },
  });

  // Staff delete attempts (blocked)
  // Assuming we log failed delete attempts
  const deletesAttemptedByStaff = await AuditEvent.countDocuments({
    businessId,
    action: { $in: ['BILL_DELETE_BLOCKED', 'CUSTOMER_DELETE_BLOCKED'] },
    at: { $gte: from, $lte: to },
  });

  return {
    creditLimitBlocksCount: creditLimitBlocks,
    creditLimitOverridesCount: creditLimitOverrides,
    deletesAttemptedByStaffCount: deletesAttemptedByStaff,
  };
}

/**
 * Compute Recovery Effectiveness KPIs
 */
async function computeRecoveryKPIs(businessId, from, to) {
  // Chase items created (proxy: followups + promises in period)
  const FollowUpTask = require('../models/FollowUpTask');
  const chaseItemsCreated = await FollowUpTask.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
  });

  // Chase items cleared (completed/cancelled followups)
  const chaseItemsCleared = await FollowUpTask.countDocuments({
    businessId,
    updatedAt: { $gte: from, $lte: to },
    status: { $in: ['COMPLETED', 'CANCELLED'] },
  });

  // Promises set
  const promisesSetCount = await RecoveryCase.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
    promiseDueAt: { $exists: true },
  });

  // Broken promises
  const brokenPromisesCount = await RecoveryCase.countDocuments({
    businessId,
    promiseBroken: true,
    promiseBrokenAt: { $gte: from, $lte: to },
  });

  // Overdue total (start vs end) - best effort snapshot
  const overdueBillsStart = await Bill.find({
    businessId,
    status: { $in: ['PENDING', 'PARTIAL'] },
    dueAt: { $lt: from },
    createdAt: { $lt: from },
  }).select('totalAmount paidAmount').lean();
  
  const overdueTotalStart = overdueBillsStart.reduce((sum, bill) => {
    return sum + (bill.totalAmount - (bill.paidAmount || 0));
  }, 0);

  const overdueBillsEnd = await Bill.find({
    businessId,
    status: { $in: ['PENDING', 'PARTIAL'] },
    dueAt: { $lt: to },
  }).select('totalAmount paidAmount').lean();
  
  const overdueTotalEnd = overdueBillsEnd.reduce((sum, bill) => {
    return sum + (bill.totalAmount - (bill.paidAmount || 0));
  }, 0);

  return {
    chaseItemsCreated,
    chaseItemsCleared,
    promisesSetCount,
    brokenPromisesCount,
    overdueTotalStart: Math.round(overdueTotalStart),
    overdueTotalEnd: Math.round(overdueTotalEnd),
    overdueChange: Math.round(overdueTotalEnd - overdueTotalStart),
  };
}

/**
 * Compute Support KPIs
 */
async function computeSupportKPIs(businessId, from, to) {
  // Tickets created
  const ticketsCreated = await SupportTicket.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
  });

  // Tickets resolved
  const ticketsResolved = await SupportTicket.countDocuments({
    businessId,
    updatedAt: { $gte: from, $lte: to },
    status: { $in: ['RESOLVED', 'CLOSED'] },
  });

  // SLA breaches (tickets where dueAt < now and status still open)
  const now = new Date();
  const slaBreaches = await SupportTicket.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
    dueAt: { $lt: now },
    status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] },
  });

  return {
    ticketsCreated,
    ticketsResolved,
    slaBreachesCount: slaBreaches,
  };
}

/**
 * Compute Usage KPIs
 */
async function computeUsageKPIs(businessId, from, to) {
  // Active days (days with at least 1 bill created)
  const billsByDay = await Bill.aggregate([
    {
      $match: {
        businessId,
        createdAt: { $gte: from, $lte: to },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  
  const activeDays = billsByDay.length;

  // Bills created
  const billsCreated = await Bill.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
  });

  // Customers added
  const customersAdded = await Customer.countDocuments({
    businessId,
    createdAt: { $gte: from, $lte: to },
  });

  return {
    activeDays,
    billsCreated,
    customersAdded,
  };
}

/**
 * Detect drift based on KPIs
 */
function detectDrift(kpis) {
  const driftFlags = [];

  // DRIFT_NO_CHASE_USAGE
  if (kpis.recovery.chaseItemsCreated === 0 && kpis.recovery.promisesSetCount === 0) {
    driftFlags.push({
      code: 'DRIFT_NO_CHASE_USAGE',
      severity: 'WARN',
      message: 'No chase actions recorded in the last 7 days',
      suggestedAction: 'Review Today screen → Chase List to ensure recovery engine is being used',
    });
  }

  // DRIFT_TOO_MANY_OVERRIDES
  const overrideRate = kpis.control.creditLimitBlocksCount > 0
    ? (kpis.control.creditLimitOverridesCount / kpis.control.creditLimitBlocksCount) * 100
    : 0;
  
  if (overrideRate > 10 && kpis.control.creditLimitBlocksCount > 0) {
    driftFlags.push({
      code: 'DRIFT_TOO_MANY_OVERRIDES',
      severity: 'WARN',
      message: `${overrideRate.toFixed(1)}% of credit blocks were overridden (threshold: 10%)`,
      suggestedAction: 'Review credit limit policies or increase limits for repeat customers',
    });
  }

  // DRIFT_MANY_WRITE_FAILS
  if (kpis.reliability.writeFailureRate > 1) {
    driftFlags.push({
      code: 'DRIFT_MANY_WRITE_FAILS',
      severity: 'CRITICAL',
      message: `Write failure rate: ${kpis.reliability.writeFailureRate}% (threshold: 1%)`,
      suggestedAction: 'Open Control Tower → Check Diagnostics → Review recent failures',
    });
  }

  // DRIFT_SUPPORT_SLA
  if (kpis.support.slaBreachesCount > 0) {
    driftFlags.push({
      code: 'DRIFT_SUPPORT_SLA',
      severity: 'WARN',
      message: `${kpis.support.slaBreachesCount} support ticket(s) breached SLA`,
      suggestedAction: 'Open Support → Resolve overdue tickets',
    });
  }

  // DRIFT_INTEGRITY_WARN
  // This requires checking the latest integrity report
  // We'll add this in the main endpoint

  return driftFlags;
}

/**
 * GET /api/v1/ops/weekly
 * Get weekly KPIs and drift detection
 */
const getWeeklyMetrics = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const { from: fromParam, to: toParam } = req.query;

  const { from, to } = getWeeklyDateRange(fromParam, toParam);

  logger.info('[OpsWeekly] Computing weekly metrics', {
    businessId,
    from,
    to,
  });

  // Compute all KPIs in parallel
  const [reliability, control, recovery, support, usage] = await Promise.all([
    computeReliabilityKPIs(businessId, from, to),
    computeControlEnforcementKPIs(businessId, from, to),
    computeRecoveryKPIs(businessId, from, to),
    computeSupportKPIs(businessId, from, to),
    computeUsageKPIs(businessId, from, to),
  ]);

  const kpis = {
    reliability,
    control,
    recovery,
    support,
    usage,
  };

  // Detect drift
  let driftFlags = detectDrift(kpis);

  // Check latest integrity report for DRIFT_INTEGRITY_WARN
  const latestIntegrity = await IntegrityReport.findOne({ businessId })
    .sort({ runAt: -1 })
    .select('status runAt')
    .lean();

  if (latestIntegrity && latestIntegrity.status !== 'PASS') {
    driftFlags.push({
      code: 'DRIFT_INTEGRITY_WARN',
      severity: latestIntegrity.status === 'FAIL' ? 'CRITICAL' : 'WARN',
      message: `Last integrity check: ${latestIntegrity.status}`,
      suggestedAction: 'Open Control Tower → Run Integrity Check',
    });
  }

  // Sort drift flags by severity (CRITICAL first)
  driftFlags.sort((a, b) => {
    const severityOrder = { CRITICAL: 0, WARN: 1, INFO: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  // Compute simple scores (100 - penalties)
  const reliabilityScore = Math.max(0, 100 - (
    reliability.writeFailureRate * 10 +
    reliability.syncFailureRate * 5 +
    reliability.notificationFailureRate * 2 +
    reliability.integrityFailCount * 20
  ));

  const recoveryScore = recovery.promisesSetCount > 0
    ? Math.max(0, 100 - ((recovery.brokenPromisesCount / recovery.promisesSetCount) * 100))
    : 0;

  const supportScore = support.ticketsCreated > 0
    ? Math.max(0, 100 - ((support.slaBreachesCount / support.ticketsCreated) * 100))
    : 100; // No tickets = perfect score

  res.success({
    period: {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
      days: Math.ceil((to - from) / (24 * 60 * 60 * 1000)),
    },
    kpis,
    scores: {
      reliability: Math.round(reliabilityScore),
      recovery: Math.round(recoveryScore),
      support: Math.round(supportScore),
    },
    driftFlags,
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * GET /api/v1/ops/weekly/export
 * Export weekly metrics as CSV or JSON
 */
const exportWeeklyMetrics = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const { from: fromParam, to: toParam, format = 'csv' } = req.query;

  const { from, to } = getWeeklyDateRange(fromParam, toParam);

  // Get metrics (reuse logic from getWeeklyMetrics)
  const [reliability, control, recovery, support, usage] = await Promise.all([
    computeReliabilityKPIs(businessId, from, to),
    computeControlEnforcementKPIs(businessId, from, to),
    computeRecoveryKPIs(businessId, from, to),
    computeSupportKPIs(businessId, from, to),
    computeUsageKPIs(businessId, from, to),
  ]);

  const kpis = { reliability, control, recovery, support, usage };
  const driftFlags = detectDrift(kpis);

  if (format === 'json') {
    // JSON export
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-metrics-${from.toISOString().split('T')[0]}.json"`);
    
    return res.send(JSON.stringify({
      period: {
        from: from.toISOString().split('T')[0],
        to: to.toISOString().split('T')[0],
      },
      kpis,
      driftFlags,
      exportedAt: new Date().toISOString(),
    }, null, 2));
  }

  // CSV export
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="weekly-metrics-${from.toISOString().split('T')[0]}.csv"`);

  const csv = [];
  
  // Header
  csv.push('PH4 Weekly Metrics Report');
  csv.push(`Period,${from.toISOString().split('T')[0]} to ${to.toISOString().split('T')[0]}`);
  csv.push('');

  // Reliability KPIs
  csv.push('Reliability');
  csv.push('Metric,Value');
  csv.push(`Write Failures,${reliability.writeFails}`);
  csv.push(`Total Writes,${reliability.totalWrites}`);
  csv.push(`Write Failure Rate,${reliability.writeFailureRate}%`);
  csv.push(`Sync Failures,${reliability.syncFails}`);
  csv.push(`Sync Failure Rate,${reliability.syncFailureRate}%`);
  csv.push(`Notification Failures,${reliability.notificationFails}`);
  csv.push(`Notification Failure Rate,${reliability.notificationFailureRate}%`);
  csv.push(`Integrity Failures,${reliability.integrityFailCount}`);
  csv.push('');

  // Control KPIs
  csv.push('Control Enforcement');
  csv.push('Metric,Value');
  csv.push(`Credit Limit Blocks,${control.creditLimitBlocksCount}`);
  csv.push(`Credit Limit Overrides,${control.creditLimitOverridesCount}`);
  csv.push(`Staff Delete Attempts (Blocked),${control.deletesAttemptedByStaffCount}`);
  csv.push('');

  // Recovery KPIs
  csv.push('Recovery Effectiveness');
  csv.push('Metric,Value');
  csv.push(`Chase Items Created,${recovery.chaseItemsCreated}`);
  csv.push(`Chase Items Cleared,${recovery.chaseItemsCleared}`);
  csv.push(`Promises Set,${recovery.promisesSetCount}`);
  csv.push(`Broken Promises,${recovery.brokenPromisesCount}`);
  csv.push(`Overdue Total Start,₹${recovery.overdueTotalStart}`);
  csv.push(`Overdue Total End,₹${recovery.overdueTotalEnd}`);
  csv.push(`Overdue Change,₹${recovery.overdueChange}`);
  csv.push('');

  // Support KPIs
  csv.push('Support');
  csv.push('Metric,Value');
  csv.push(`Tickets Created,${support.ticketsCreated}`);
  csv.push(`Tickets Resolved,${support.ticketsResolved}`);
  csv.push(`SLA Breaches,${support.slaBreachesCount}`);
  csv.push('');

  // Usage KPIs
  csv.push('Usage');
  csv.push('Metric,Value');
  csv.push(`Active Days,${usage.activeDays}`);
  csv.push(`Bills Created,${usage.billsCreated}`);
  csv.push(`Customers Added,${usage.customersAdded}`);
  csv.push('');

  // Drift Flags
  if (driftFlags.length > 0) {
    csv.push('Drift Flags');
    csv.push('Code,Severity,Message,Suggested Action');
    driftFlags.forEach(flag => {
      csv.push(`${flag.code},${flag.severity},"${flag.message}","${flag.suggestedAction}"`);
    });
  } else {
    csv.push('Drift Flags');
    csv.push('No drift detected');
  }

  res.send(csv.join('\n'));
});

module.exports = {
  getWeeklyMetrics,
  exportWeeklyMetrics,
};
