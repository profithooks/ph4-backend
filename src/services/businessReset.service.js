/**
 * Business Reset Service
 * 
 * Handles safe business reset with auto-backup
 * Step 22: One-Button Business Reset
 */
const mongoose = require('mongoose');
const ResetJob = require('../models/ResetJob');
const ExportJob = require('../models/ExportJob');
const Customer = require('../models/Customer');
const Bill = require('../models/Bill');
const FollowUpTask = require('../models/FollowUpTask');
const RecoveryCase = require('../models/RecoveryCase');
const Notification = require('../models/Notification');
const NotificationAttempt = require('../models/NotificationAttempt');
const ReliabilityEvent = require('../models/ReliabilityEvent');
const AuditEvent = require('../models/AuditEvent');
const SupportTicket = require('../models/SupportTicket');
const SupportTicketMessage = require('../models/SupportTicketMessage');
const IdempotencyKey = require('../models/IdempotencyKey');
const Device = require('../models/Device');
const BusinessSettings = require('../models/BusinessSettings');
const IntegrityReport = require('../models/IntegrityReport');
const { runAllIntegrityChecks } = require('../integrity/integrityChecks');
const logger = require('../utils/logger');

/**
 * Phase 1: Create backup export
 */
async function createBackupExport(resetJob) {
  try {
    logger.info('[BusinessReset] Creating backup export', {
      resetJobId: resetJob._id,
      businessId: resetJob.businessId,
    });

    // Update status
    resetJob.status = 'BACKING_UP';
    resetJob.startedAt = new Date();
    resetJob.progress = {
      phase: 'BACKING_UP',
      percent: 10,
      message: 'Creating backup export...',
    };
    await resetJob.save();

    // Create export job
    const exportJob = await ExportJob.create({
      businessId: resetJob.businessId,
      requestedBy: resetJob.requestedBy,
      status: 'QUEUED',
      metadata: {
        triggeredBy: 'BUSINESS_RESET',
        resetJobId: resetJob._id.toString(),
      },
    });

    resetJob.backupExportJobId = exportJob._id;
    await resetJob.save();

    logger.info('[BusinessReset] Export job created', {
      resetJobId: resetJob._id,
      exportJobId: exportJob._id,
    });

    // Note: The actual export will be handled by the existing export worker
    // We need to poll for completion
    return exportJob;
  } catch (error) {
    logger.error('[BusinessReset] Backup export failed', {
      resetJobId: resetJob._id,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Phase 2: Wipe business data
 */
async function wipeBusinessData(resetJob) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    logger.info('[BusinessReset] Wiping business data', {
      resetJobId: resetJob._id,
      businessId: resetJob.businessId,
    });

    resetJob.status = 'RESETTING';
    resetJob.progress = {
      phase: 'RESETTING',
      percent: 50,
      message: 'Deleting business data...',
    };
    await resetJob.save();

    const businessId = resetJob.businessId;
    const stats = {};

    // Delete customers
    const customersResult = await Customer.deleteMany({ businessId }, { session });
    stats.customersDeleted = customersResult.deletedCount;
    logger.info('[BusinessReset] Deleted customers', { count: stats.customersDeleted });

    // Delete bills
    const billsResult = await Bill.deleteMany({ businessId }, { session });
    stats.billsDeleted = billsResult.deletedCount;
    logger.info('[BusinessReset] Deleted bills', { count: stats.billsDeleted });

    // Delete followup tasks
    const followupsResult = await FollowUpTask.deleteMany({ businessId }, { session });
    stats.followupsDeleted = followupsResult.deletedCount;
    logger.info('[BusinessReset] Deleted followups', { count: stats.followupsDeleted });

    // Delete recovery cases
    const recoveriesResult = await RecoveryCase.deleteMany({ businessId }, { session });
    stats.recoveriesDeleted = recoveriesResult.deletedCount;
    logger.info('[BusinessReset] Deleted recoveries', { count: stats.recoveriesDeleted });

    // Delete notifications and attempts
    const notifications = await Notification.find({ businessId }).select('_id').session(session);
    const notificationIds = notifications.map(n => n._id);
    
    await NotificationAttempt.deleteMany(
      { notificationId: { $in: notificationIds } },
      { session }
    );
    
    const notificationsResult = await Notification.deleteMany({ businessId }, { session });
    stats.notificationsDeleted = notificationsResult.deletedCount;
    logger.info('[BusinessReset] Deleted notifications', { count: stats.notificationsDeleted });

    // Delete support tickets and messages
    const tickets = await SupportTicket.find({ businessId }).select('_id').session(session);
    const ticketIds = tickets.map(t => t._id);
    
    await SupportTicketMessage.deleteMany(
      { ticketId: { $in: ticketIds } },
      { session }
    );
    
    const ticketsResult = await SupportTicket.deleteMany({ businessId }, { session });
    stats.supportTicketsDeleted = ticketsResult.deletedCount;
    logger.info('[BusinessReset] Deleted support tickets', { count: stats.supportTicketsDeleted });

    // Delete idempotency keys
    const idempotencyResult = await IdempotencyKey.deleteMany({ businessId }, { session });
    stats.idempotencyKeysDeleted = idempotencyResult.deletedCount;
    logger.info('[BusinessReset] Deleted idempotency keys', { count: stats.idempotencyKeysDeleted });

    // Delete reliability events (keep last 7 days for debugging)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    await ReliabilityEvent.deleteMany(
      { businessId, at: { $lt: sevenDaysAgo } },
      { session }
    );
    logger.info('[BusinessReset] Deleted old reliability events');

    // Clear devices (all except current can be removed, or clear all for clean slate)
    // We'll clear all for true reset - user will need to re-login
    const devicesResult = await Device.deleteMany({ businessId }, { session });
    stats.devicesCleared = devicesResult.deletedCount;
    logger.info('[BusinessReset] Cleared devices', { count: stats.devicesCleared });

    // Reset business settings to safe defaults (keep plan, disable pilot mode)
    const settings = await BusinessSettings.findOne({ businessId }).session(session);
    if (settings) {
      settings.pilotModeEnabled = false;
      settings.interestEnabled = false;
      // Keep plan fields as-is
      await settings.save({ session });
      logger.info('[BusinessReset] Reset business settings');
    }

    // DO NOT delete:
    // - User account
    // - Business record
    // - AuditEvents (keep for full history)
    // - IntegrityReports (keep for debugging)

    // Create audit event for reset completion
    await AuditEvent.create([{
      at: new Date(),
      businessId,
      actorUserId: resetJob.requestedBy,
      actorRole: 'OWNER',
      action: 'BUSINESS_RESET_COMPLETED',
      entityType: 'BUSINESS',
      entityId: businessId.toString(),
      metadata: {
        resetJobId: resetJob._id.toString(),
        backupExportJobId: resetJob.backupExportJobId?.toString(),
        stats,
        requestId: resetJob.requestId,
      },
    }], { session });

    await session.commitTransaction();
    
    resetJob.stats = stats;
    await resetJob.save();

    logger.info('[BusinessReset] Data wipe completed', {
      resetJobId: resetJob._id,
      stats,
    });

    return stats;
  } catch (error) {
    await session.abortTransaction();
    logger.error('[BusinessReset] Data wipe failed', {
      resetJobId: resetJob._id,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Phase 3: Run post-reset integrity check
 */
async function runPostResetIntegrityCheck(resetJob) {
  try {
    logger.info('[BusinessReset] Running post-reset integrity check', {
      resetJobId: resetJob._id,
      businessId: resetJob.businessId,
    });

    resetJob.progress = {
      phase: 'INTEGRITY_CHECK',
      percent: 90,
      message: 'Verifying data integrity...',
    };
    await resetJob.save();

    const result = await runAllIntegrityChecks(resetJob.businessId, resetJob.requestId);

    // Create integrity report
    const report = await IntegrityReport.create({
      businessId: resetJob.businessId,
      runAt: new Date(),
      status: result.status,
      checks: result.checks,
      repaired: result.repaired,
      requestId: resetJob.requestId,
      triggeredBy: 'MANUAL',
      durationMs: result.durationMs,
    });

    resetJob.integrityReportId = report._id;
    await resetJob.save();

    logger.info('[BusinessReset] Post-reset integrity check completed', {
      resetJobId: resetJob._id,
      status: result.status,
    });

    return report;
  } catch (error) {
    logger.error('[BusinessReset] Integrity check failed', {
      resetJobId: resetJob._id,
      error: error.message,
    });
    // Don't fail the reset if integrity check fails
    return null;
  }
}

/**
 * Execute full reset pipeline
 */
async function executeResetPipeline(resetJobId) {
  try {
    const resetJob = await ResetJob.findById(resetJobId);
    if (!resetJob) {
      throw new Error('Reset job not found');
    }

    if (resetJob.status !== 'QUEUED') {
      logger.warn('[BusinessReset] Job already started', {
        resetJobId,
        status: resetJob.status,
      });
      return;
    }

    // Phase 1: Create backup
    const exportJob = await createBackupExport(resetJob);
    
    // Wait for export to complete (with timeout)
    const exportCompleted = await waitForExportCompletion(exportJob._id, 300000); // 5 min timeout
    
    if (!exportCompleted) {
      resetJob.status = 'FAILED';
      resetJob.finishedAt = new Date();
      resetJob.error = {
        code: 'BACKUP_TIMEOUT',
        message: 'Backup export timed out',
      };
      await resetJob.save();
      
      logger.error('[BusinessReset] Backup export timed out', { resetJobId });
      return;
    }

    // Get export download URL
    const completedExport = await ExportJob.findById(exportJob._id);
    if (completedExport.status !== 'DONE') {
      resetJob.status = 'FAILED';
      resetJob.finishedAt = new Date();
      resetJob.error = {
        code: 'BACKUP_FAILED',
        message: completedExport.error?.message || 'Backup export failed',
      };
      await resetJob.save();
      
      logger.error('[BusinessReset] Backup export failed', {
        resetJobId,
        exportError: completedExport.error,
      });
      return;
    }

    resetJob.backupDownloadUrl = `/api/v1/backup/export/${exportJob._id}/download`;
    await resetJob.save();

    // Phase 2: Wipe data
    await wipeBusinessData(resetJob);

    // Phase 3: Integrity check
    await runPostResetIntegrityCheck(resetJob);

    // Mark as done
    resetJob.status = 'DONE';
    resetJob.finishedAt = new Date();
    resetJob.progress = {
      phase: 'DONE',
      percent: 100,
      message: 'Reset completed successfully',
    };
    await resetJob.save();

    logger.info('[BusinessReset] Reset pipeline completed', {
      resetJobId,
      durationMs: resetJob.finishedAt - resetJob.startedAt,
    });
  } catch (error) {
    logger.error('[BusinessReset] Reset pipeline failed', {
      resetJobId,
      error: error.message,
      stack: error.stack,
    });

    try {
      const resetJob = await ResetJob.findById(resetJobId);
      if (resetJob && resetJob.status !== 'DONE') {
        resetJob.status = 'FAILED';
        resetJob.finishedAt = new Date();
        resetJob.error = {
          code: 'RESET_FAILED',
          message: error.message,
        };
        await resetJob.save();
      }
    } catch (updateError) {
      logger.error('[BusinessReset] Failed to update job status', updateError);
    }
  }
}

/**
 * Wait for export job to complete
 */
async function waitForExportCompletion(exportJobId, timeoutMs = 300000) {
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds

  while (Date.now() - startTime < timeoutMs) {
    const exportJob = await ExportJob.findById(exportJobId);
    
    if (!exportJob) {
      logger.error('[BusinessReset] Export job not found', { exportJobId });
      return false;
    }

    if (exportJob.status === 'DONE') {
      return true;
    }

    if (exportJob.status === 'FAILED') {
      logger.error('[BusinessReset] Export job failed', {
        exportJobId,
        error: exportJob.error,
      });
      return false;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return false; // Timeout
}

module.exports = {
  executeResetPipeline,
  createBackupExport,
  wipeBusinessData,
  runPostResetIntegrityCheck,
};
