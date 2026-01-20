/**
 * Recovery Task Processing Cron
 * 
 * PURPOSE: Process due recovery tasks and create delivery attempts
 * 
 * RUNS: Every 10 minutes
 * 
 * MULTI-INSTANCE SAFE:
 * - Uses distributed lock (CronLock model)
 * - Only ONE instance processes tasks per interval
 * - Lock expires after 9 minutes (< 10m cron interval)
 * 
 * IST-CORRECT:
 * - All date comparisons use IST timezone (via timezone.util.js)
 * - dueAt comparisons use nowIST (not server local time)
 * 
 * ALGORITHM:
 * 1. Acquire distributed lock (atomic findOneAndUpdate)
 * 2. If lock not acquired → skip (another instance is processing)
 * 3. Find all pending recovery tasks due now (dueAt <= nowIST)
 * 4. For each task:
 *    a. Create delivery attempt (WHATSAPP/SMS based on settings)
 *    b. Mark task as processing (to prevent double-processing)
 * 5. Release lock
 * 6. Worker will pick up delivery attempts and send
 * 
 * IDEMPOTENCY:
 * - Uses deliveryAttempt.service which has idempotency via Notification.idempotencyKey
 * - If task already has delivery attempt, won't create another
 * - Safe to run multiple times
 */

const cron = require('node-cron');
const crypto = require('crypto');
const FollowUpTask = require('../models/FollowUpTask');
const CronLock = require('../models/CronLock');
const {createDeliveryAttempt} = require('../services/deliveryAttempt.service');
const {getNowIST} = require('../utils/timezone.util');
const logger = require('../utils/logger');

// Instance ID (for lock ownership tracking)
const INSTANCE_ID = `recovery_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;

let cronJob = null;

/**
 * Acquire distributed lock
 * 
 * ATOMIC OPERATION: Uses findOneAndUpdate with conditions
 * - Only acquires if lock is expired OR doesn't exist
 * - Sets lockedUntil = now + lockDuration
 * - Sets ownerId = instance ID
 * 
 * @param {string} lockName - Lock name (unique identifier)
 * @param {number} lockDuration - Lock duration in milliseconds
 * @returns {Promise<Object>} { acquired: boolean, ownerId: string, lock: Document }
 */
async function acquireLock(lockName, lockDuration) {
  try {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + lockDuration);
    
    // ATOMIC: Try to acquire lock
    // Conditions: lockedUntil < now (expired) OR document doesn't exist
    const lock = await CronLock.findOneAndUpdate(
      {
        name: lockName,
        $or: [
          {lockedUntil: {$lt: now}}, // Expired lock
          {lockedUntil: {$exists: false}}, // New lock
        ],
      },
      {
        $set: {
          lockedUntil,
          ownerId: INSTANCE_ID,
          lastExecutionAt: now,
        },
      },
      {
        new: true,
        upsert: true, // Create if doesn't exist
      }
    );
    
    // Verify we own the lock (race condition check)
    const acquired = lock.ownerId === INSTANCE_ID;
    
    if (acquired) {
      logger.info('[RecoveryTaskCron] Lock acquired', {
        lockName,
        ownerId: INSTANCE_ID,
        lockedUntil,
      });
    } else {
      logger.debug('[RecoveryTaskCron] Lock already held by another instance', {
        lockName,
        currentOwner: lock.ownerId,
      });
    }
    
    return {
      acquired,
      ownerId: INSTANCE_ID,
      lock,
    };
  } catch (error) {
    logger.error('[RecoveryTaskCron] Lock acquisition failed', error);
    return {
      acquired: false,
      ownerId: INSTANCE_ID,
      lock: null,
    };
  }
}

/**
 * Release distributed lock
 * 
 * @param {string} lockName - Lock name
 * @param {string} ownerId - Owner ID (must match to release)
 * @param {Object} stats - Execution stats (optional)
 * @returns {Promise<boolean>} Released successfully
 */
async function releaseLock(lockName, ownerId, stats = {}) {
  try {
    // Only release if we own the lock
    const result = await CronLock.findOneAndUpdate(
      {
        name: lockName,
        ownerId,
      },
      {
        $set: {
          lockedUntil: new Date(0), // Expired (release immediately)
          lastExecutionStatus: stats.status || 'SUCCESS',
          lastExecutionDuration: stats.duration,
          lastExecutionStats: stats.data,
        },
      }
    );
    
    if (result) {
      logger.debug('[RecoveryTaskCron] Lock released', {lockName, ownerId});
      return true;
    } else {
      logger.warn('[RecoveryTaskCron] Lock not owned by this instance', {
        lockName,
        ownerId,
      });
      return false;
    }
  } catch (error) {
    logger.error('[RecoveryTaskCron] Lock release failed', error);
    return false;
  }
}

/**
 * Process due recovery tasks (IST-CORRECT + DISTRIBUTED LOCK)
 * 
 * @returns {Promise<Object>} { processed, attempted, errors, skipped }
 */
async function processRecoveryTasks() {
  const startTime = Date.now();
  
  try {
    // CRITICAL: Use IST for all date comparisons
    const nowIST = getNowIST();
    
    // STEP 1: Acquire distributed lock (9 minutes = 540 seconds)
    const lockDuration = 9 * 60 * 1000; // 9 minutes (< 10m cron interval)
    const lockResult = await acquireLock('recovery_task_processing', lockDuration);
    
    if (!lockResult.acquired) {
      logger.info('[RecoveryTaskCron] Skipped - lock held by another instance');
      return {
        processed: 0,
        attempted: 0,
        errors: 0,
        skipped: true,
        reason: 'lock_not_acquired',
      };
    }
    
    logger.debug('[RecoveryTaskCron] Starting recovery task processing');
    
    // Find due recovery tasks
    // Recovery tasks have source starting with 'AUTO_RECOVERY_'
    const dueTasks = await FollowUpTask.find({
      status: 'pending',
      dueAt: {$lte: nowIST},
      source: {$regex: /^AUTO_RECOVERY_/},
      isDeleted: {$ne: true},
    })
      .sort({dueAt: 1}) // Oldest first
      .limit(100) // Process max 100 per run
      .lean();
    
    if (dueTasks.length === 0) {
      logger.debug('[RecoveryTaskCron] No due tasks found');
      return {
        processed: 0,
        attempted: 0,
        errors: 0,
      };
    }
    
    logger.info('[RecoveryTaskCron] Found due tasks', {
      count: dueTasks.length,
    });
    
    let attempted = 0;
    let errors = 0;
    
    for (const task of dueTasks) {
      try {
        // Determine channel (prefer WHATSAPP, fallback to SMS)
        // TODO: Read from settings when implemented
        const channel = task.channel || 'whatsapp';
        const channelUpper = channel.toUpperCase();
        
        // Create delivery attempt (idempotent)
        const result = await createDeliveryAttempt({
          followupTaskId: task._id,
          channel: channelUpper,
          requestId: `recovery_cron_${Date.now()}`,
        });
        
        if (result.created) {
          attempted++;
          logger.info('[RecoveryTaskCron] Delivery attempt created', {
            taskId: task._id,
            customerId: task.customerId,
            channel: channelUpper,
            attemptId: result.attempt._id,
          });
        } else {
          logger.debug('[RecoveryTaskCron] Delivery attempt already exists', {
            taskId: task._id,
            customerId: task.customerId,
          });
        }
      } catch (error) {
        errors++;
        logger.error('[RecoveryTaskCron] Failed to process task', error, {
          taskId: task._id,
          customerId: task.customerId,
        });
      }
    }
    
    const stats = {
      processed: dueTasks.length,
      attempted,
      errors,
      skipped: false,
    };
    
    logger.info('[RecoveryTaskCron] Processing complete', stats);
    
    // STEP 3: Release lock
    const duration = Date.now() - startTime;
    await releaseLock('recovery_task_processing', INSTANCE_ID, {
      status: 'SUCCESS',
      duration,
      data: stats,
    });
    
    return stats;
  } catch (error) {
    logger.error('[RecoveryTaskCron] Cron execution failed', error);
    
    // Release lock on error
    const duration = Date.now() - startTime;
    await releaseLock('recovery_task_processing', INSTANCE_ID, {
      status: 'FAILED',
      duration,
      data: {error: error.message},
    }).catch(releaseError => {
      logger.error('[RecoveryTaskCron] Lock release failed after error', releaseError);
    });
    
    throw error;
  }
}

/**
 * Start recovery task processing cron
 * Runs every 10 minutes
 */
function startRecoveryTaskCron() {
  // Prevent multiple instances
  if (cronJob) {
    logger.warn('[RecoveryTaskCron] Cron already running');
    return;
  }
  
  // Run every 10 minutes: '*/10 * * * *'
  cronJob = cron.schedule('*/10 * * * *', async () => {
    try {
      const stats = await processRecoveryTasks();
      
      if (stats.attempted > 0 || stats.errors > 0) {
        logger.info('[RecoveryTaskCron] Execution summary', stats);
      }
    } catch (error) {
      logger.error('[RecoveryTaskCron] Execution error', error);
    }
  });
  
  logger.info('[RecoveryTaskCron] Started (runs every 10 minutes)');
}

/**
 * Stop recovery task processing cron
 */
function stopRecoveryTaskCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('[RecoveryTaskCron] Stopped');
  }
}

/**
 * Run recovery task processing immediately (for testing)
 */
async function runRecoveryTaskCronNow() {
  logger.info('[RecoveryTaskCron] Running immediately (manual trigger)');
  return await processRecoveryTasks();
}

module.exports = {
  startRecoveryTaskCron,
  stopRecoveryTaskCron,
  runRecoveryTaskCronNow,
  processRecoveryTasks,
};
