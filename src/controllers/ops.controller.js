/**
 * Ops Controller
 * 
 * Live operational metrics for monitoring and control tower
 * Step 23: Go-Live & Rollout Control
 */
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const IntegrityReport = require('../models/IntegrityReport');
const ExportJob = require('../models/ExportJob');
const ReliabilityEvent = require('../models/ReliabilityEvent');
const Bill = require('../models/Bill');
const RecoveryCase = require('../models/RecoveryCase');
const FollowUpTask = require('../models/FollowUpTask');
const SupportTicket = require('../models/SupportTicket');
const NotificationAttempt = require('../models/NotificationAttempt');
const logger = require('../utils/logger');

/**
 * GET /api/v1/ops/health
 * System health metrics
 */
const getSystemHealth = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Check DB connection
  const dbUp = mongoose.connection.readyState === 1;

  // Last integrity check
  const lastIntegrityReport = await IntegrityReport.findOne({ businessId })
    .sort({ runAt: -1 })
    .select('runAt status')
    .lean();

  // Last backup
  const lastBackup = await ExportJob.findOne({ businessId, status: 'DONE' })
    .sort({ finishedAt: -1 })
    .select('finishedAt')
    .lean();

  // Offline queue depth (from reliability events)
  const offlineQueueDepth = await ReliabilityEvent.countDocuments({
    businessId,
    kind: 'SYNC_FAIL',
    at: { $gte: twentyFourHoursAgo },
  });

  // Notification failures (24h)
  const notificationFailures24h = await NotificationAttempt.countDocuments({
    businessId,
    status: 'FAILED',
    updatedAt: { $gte: twentyFourHoursAgo },
  });

  // Sync failures (24h)
  const syncFailures24h = await ReliabilityEvent.countDocuments({
    businessId,
    kind: 'SYNC_FAIL',
    at: { $gte: twentyFourHoursAgo },
  });

  // Determine overall health status
  let healthStatus = 'GREEN';
  const issues = [];

  if (!dbUp) {
    healthStatus = 'RED';
    issues.push('Database connection down');
  }

  if (lastIntegrityReport?.status === 'FAIL') {
    healthStatus = healthStatus === 'RED' ? 'RED' : 'AMBER';
    issues.push('Last integrity check failed');
  }

  if (notificationFailures24h > 10) {
    healthStatus = healthStatus === 'RED' ? 'RED' : 'AMBER';
    issues.push(`${notificationFailures24h} notification failures in 24h`);
  }

  if (syncFailures24h > 50) {
    healthStatus = healthStatus === 'RED' ? 'RED' : 'AMBER';
    issues.push(`${syncFailures24h} sync failures in 24h`);
  }

  const health = {
    status: healthStatus,
    apiUp: true, // If we got here, API is up
    dbUp,
    lastIntegrityRunAt: lastIntegrityReport?.runAt || null,
    lastIntegrityStatus: lastIntegrityReport?.status || null,
    lastBackupAt: lastBackup?.finishedAt || null,
    offlineQueueDepth,
    notificationFailures24h,
    syncFailures24h,
    issues: issues.length > 0 ? issues : null,
  };

  res.success({
    health,
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * GET /api/v1/ops/activity
 * Business activity metrics
 */
const getSystemActivity = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Bills created (24h)
  const billsCreated24h = await Bill.countDocuments({
    businessId,
    createdAt: { $gte: twentyFourHoursAgo },
  });

  // Promises set (24h)
  const promisesSet24h = await RecoveryCase.countDocuments({
    businessId,
    createdAt: { $gte: twentyFourHoursAgo },
    promiseDueAt: { $exists: true },
  });

  // Broken promises (24h)
  const brokenPromises24h = await RecoveryCase.countDocuments({
    businessId,
    promiseBroken: true,
    promiseBrokenAt: { $gte: twentyFourHoursAgo },
  });

  // Followups executed (24h)
  const followupsExecuted24h = await FollowUpTask.countDocuments({
    businessId,
    updatedAt: { $gte: twentyFourHoursAgo },
    status: { $in: ['COMPLETED', 'CANCELLED'] },
  });

  // Support tickets open
  const supportTicketsOpen = await SupportTicket.countDocuments({
    businessId,
    status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] },
  });

  const activity = {
    billsCreated24h,
    promisesSet24h,
    brokenPromises24h,
    followupsExecuted24h,
    supportTicketsOpen,
  };

  res.success({
    activity,
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * GET /api/v1/ops/dashboard
 * Combined health + activity for dashboard
 */
const getDashboard = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Run health and activity queries in parallel
  const [
    dbUp,
    lastIntegrityReport,
    lastBackup,
    offlineQueueDepth,
    notificationFailures24h,
    syncFailures24h,
    billsCreated24h,
    promisesSet24h,
    brokenPromises24h,
    followupsExecuted24h,
    supportTicketsOpen,
  ] = await Promise.all([
    // Health
    Promise.resolve(mongoose.connection.readyState === 1),
    IntegrityReport.findOne({ businessId }).sort({ runAt: -1 }).select('runAt status').lean(),
    ExportJob.findOne({ businessId, status: 'DONE' }).sort({ finishedAt: -1 }).select('finishedAt').lean(),
    ReliabilityEvent.countDocuments({ businessId, kind: 'SYNC_FAIL', at: { $gte: twentyFourHoursAgo } }),
    NotificationAttempt.countDocuments({ businessId, status: 'FAILED', updatedAt: { $gte: twentyFourHoursAgo } }),
    ReliabilityEvent.countDocuments({ businessId, kind: 'SYNC_FAIL', at: { $gte: twentyFourHoursAgo } }),
    
    // Activity
    Bill.countDocuments({ businessId, createdAt: { $gte: twentyFourHoursAgo } }),
    RecoveryCase.countDocuments({ businessId, createdAt: { $gte: twentyFourHoursAgo }, promiseDueAt: { $exists: true } }),
    RecoveryCase.countDocuments({ businessId, promiseBroken: true, promiseBrokenAt: { $gte: twentyFourHoursAgo } }),
    FollowUpTask.countDocuments({ businessId, updatedAt: { $gte: twentyFourHoursAgo }, status: { $in: ['COMPLETED', 'CANCELLED'] } }),
    SupportTicket.countDocuments({ businessId, status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] } }),
  ]);

  // Determine overall health status
  let healthStatus = 'GREEN';
  const issues = [];

  if (!dbUp) {
    healthStatus = 'RED';
    issues.push('Database connection down');
  }

  if (lastIntegrityReport?.status === 'FAIL') {
    healthStatus = healthStatus === 'RED' ? 'RED' : 'AMBER';
    issues.push('Last integrity check failed');
  }

  if (notificationFailures24h > 10) {
    healthStatus = healthStatus === 'RED' ? 'RED' : 'AMBER';
    issues.push(`${notificationFailures24h} notification failures in 24h`);
  }

  if (syncFailures24h > 50) {
    healthStatus = healthStatus === 'RED' ? 'RED' : 'AMBER';
    issues.push(`${syncFailures24h} sync failures in 24h`);
  }

  res.success({
    health: {
      status: healthStatus,
      apiUp: true,
      dbUp,
      lastIntegrityRunAt: lastIntegrityReport?.runAt || null,
      lastIntegrityStatus: lastIntegrityReport?.status || null,
      lastBackupAt: lastBackup?.finishedAt || null,
      offlineQueueDepth,
      notificationFailures24h,
      syncFailures24h,
      issues: issues.length > 0 ? issues : null,
    },
    activity: {
      billsCreated24h,
      promisesSet24h,
      brokenPromises24h,
      followupsExecuted24h,
      supportTicketsOpen,
    },
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

module.exports = {
  getSystemHealth,
  getSystemActivity,
  getDashboard,
};
