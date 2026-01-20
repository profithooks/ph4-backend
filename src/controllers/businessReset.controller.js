/**
 * Business Reset Controller
 * 
 * Handles business reset requests with safety checks
 * Step 22: One-Button Business Reset
 */
const asyncHandler = require('express-async-handler');
const ResetJob = require('../models/ResetJob');
const AuditEvent = require('../models/AuditEvent');
const { executeResetPipeline } = require('../services/businessReset.service');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const REQUIRED_PHRASE = 'RESET_MY_BUSINESS';
const RESET_RATE_LIMIT_HOURS = 24;

/**
 * POST /api/v1/security/business-reset/init
 * Initialize business reset with typed confirmation
 */
const initBusinessReset = asyncHandler(async (req, res) => {
  const { confirmPhrase } = req.body;
  const businessId = req.user.businessId;
  const userId = req.user._id;

  // Validate confirmation phrase
  if (confirmPhrase !== REQUIRED_PHRASE) {
    throw new AppError(
      `Invalid confirmation phrase. Type exactly: ${REQUIRED_PHRASE}`,
      400,
      'VALIDATION_ERROR',
      { requiredPhrase: REQUIRED_PHRASE }
    );
  }

  // Check for recent reset jobs (rate limit: 1 per 24h)
  const recentResetJobs = await ResetJob.find({
    businessId,
    createdAt: { $gte: new Date(Date.now() - RESET_RATE_LIMIT_HOURS * 60 * 60 * 1000) },
  }).sort({ createdAt: -1 });

  if (recentResetJobs.length > 0) {
    const lastReset = recentResetJobs[0];
    const hoursSinceReset = (Date.now() - lastReset.createdAt) / (60 * 60 * 1000);
    const hoursRemaining = Math.ceil(RESET_RATE_LIMIT_HOURS - hoursSinceReset);

    throw new AppError(
      `Business reset is rate limited. Please wait ${hoursRemaining} hour(s) before trying again.`,
      429,
      'RATE_LIMIT',
      {
        lastResetAt: lastReset.createdAt,
        hoursRemaining,
        retryAfter: hoursRemaining * 3600,
      }
    );
  }

  // Check for running reset job
  const runningJob = await ResetJob.findOne({
    businessId,
    status: { $in: ['QUEUED', 'BACKING_UP', 'RESETTING'] },
  });

  if (runningJob) {
    throw new AppError(
      'A reset job is already in progress',
      409,
      'RESET_IN_PROGRESS',
      { resetJobId: runningJob._id }
    );
  }

  // Create reset job
  const resetJob = await ResetJob.create({
    businessId,
    requestedBy: userId,
    status: 'QUEUED',
    requestId: req.requestId,
    progress: {
      phase: 'QUEUED',
      percent: 0,
      message: 'Reset queued...',
    },
  });

  // Create audit event
  await AuditEvent.create({
    at: new Date(),
    businessId,
    actorUserId: userId,
    actorRole: 'OWNER',
    action: 'BUSINESS_RESET_REQUESTED',
    entityType: 'BUSINESS',
    entityId: businessId.toString(),
    metadata: {
      resetJobId: resetJob._id.toString(),
      requestId: req.requestId,
    },
  });

  logger.info('[BusinessResetController] Reset job created', {
    resetJobId: resetJob._id,
    businessId,
    userId,
  });

  // Start reset pipeline asynchronously (don't await)
  setImmediate(() => {
    executeResetPipeline(resetJob._id).catch(error => {
      logger.error('[BusinessResetController] Reset pipeline failed', {
        resetJobId: resetJob._id,
        error: error.message,
      });
    });
  });

  res.success({
    resetJob: {
      id: resetJob._id,
      status: resetJob.status,
      progress: resetJob.progress,
      createdAt: resetJob.createdAt,
    },
    message: 'Business reset initiated. Creating backup...',
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * GET /api/v1/security/business-reset/:jobId
 * Get reset job status
 */
const getResetJobStatus = asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const businessId = req.user.businessId;

  const resetJob = await ResetJob.findById(jobId);

  if (!resetJob) {
    throw new AppError('Reset job not found', 404, 'NOT_FOUND');
  }

  // Ensure job belongs to user's business
  if (resetJob.businessId.toString() !== businessId.toString()) {
    throw new AppError('Unauthorized', 403, 'AUTH_ERROR');
  }

  res.success({
    resetJob: {
      id: resetJob._id,
      status: resetJob.status,
      progress: resetJob.progress,
      backupDownloadUrl: resetJob.backupDownloadUrl,
      backupExportJobId: resetJob.backupExportJobId,
      integrityReportId: resetJob.integrityReportId,
      stats: resetJob.stats,
      createdAt: resetJob.createdAt,
      startedAt: resetJob.startedAt,
      finishedAt: resetJob.finishedAt,
      error: resetJob.error,
    },
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * GET /api/v1/security/business-reset/history
 * Get reset job history for current business
 */
const getResetJobHistory = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  const resetJobs = await ResetJob.find({ businessId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('-stats -error')
    .lean();

  const total = await ResetJob.countDocuments({ businessId });

  res.success({
    resetJobs,
    total,
    returned: resetJobs.length,
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

module.exports = {
  initBusinessReset,
  getResetJobStatus,
  getResetJobHistory,
};
