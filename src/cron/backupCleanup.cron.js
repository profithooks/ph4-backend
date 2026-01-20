/**
 * Backup Cleanup Cron Job
 * 
 * Deletes old export artifacts and marks jobs as expired
 * Runs daily at 2 AM
 * Step 12: Production Readiness
 */
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const ExportJob = require('../models/ExportJob');
const AuditEvent = require('../models/AuditEvent');
const logger = require('../utils/logger');

/**
 * Cleanup old backup files
 */
async function cleanupOldBackups() {
  const startTime = Date.now();

  try {
    logger.info('[BackupCleanup] Starting cleanup job');

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Find old export jobs
    const oldJobs = await ExportJob.find({
      status: 'DONE',
      finishedAt: {$lt: sevenDaysAgo},
      filePath: {$exists: true, $ne: null},
    });

    let deletedCount = 0;
    let errorCount = 0;

    for (const job of oldJobs) {
      try {
        // Delete file from filesystem
        if (job.filePath) {
          const fullPath = path.resolve(job.filePath);

          try {
            await fs.unlink(fullPath);
            logger.info('[BackupCleanup] Deleted file', {
              jobId: job._id.toString(),
              filePath: job.filePath,
            });
          } catch (fileError) {
            if (fileError.code !== 'ENOENT') {
              // File not found is OK, already deleted
              logger.warn('[BackupCleanup] File deletion failed', {
                jobId: job._id.toString(),
                filePath: job.filePath,
                error: fileError.message,
              });
            }
          }
        }

        // Update job record
        job.filePath = null;
        job.downloadUrl = null;
        await job.save();

        // Create audit event
        await AuditEvent.create({
          at: new Date(),
          businessId: job.businessId,
          actorUserId: null, // System action
          actorRole: 'SYSTEM',
          action: 'BACKUP_CLEANUP',
          entityType: 'EXPORT_JOB',
          entityId: job._id.toString(),
          metadata: {
            cleanedAt: new Date(),
            exportedAt: job.createdAt,
            ageInDays: Math.floor((Date.now() - job.finishedAt.getTime()) / (24 * 60 * 60 * 1000)),
          },
        });

        deletedCount++;
      } catch (error) {
        errorCount++;
        logger.error('[BackupCleanup] Job cleanup failed', {
          jobId: job._id.toString(),
          error: error.message,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    logger.info('[BackupCleanup] Cleanup complete', {
      totalJobs: oldJobs.length,
      deletedCount,
      errorCount,
      durationMs,
    });

    return {deletedCount, errorCount};
  } catch (error) {
    logger.error('[BackupCleanup] Cleanup job failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Start cron job
 * Runs daily at 2 AM
 */
function startBackupCleanupCron() {
  // Run every day at 2 AM
  cron.schedule('0 2 * * *', async () => {
    logger.info('[BackupCleanup] Cron triggered');
    try {
      await cleanupOldBackups();
    } catch (error) {
      logger.error('[BackupCleanup] Cron execution failed', error);
    }
  });

  logger.info('[BackupCleanup] Cron job scheduled (daily at 2 AM)');
}

module.exports = {
  startBackupCleanupCron,
  cleanupOldBackups, // Export for manual trigger
};
