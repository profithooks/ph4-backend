/**
 * Delivery Attempt Service
 * 
 * EXISTING INFRASTRUCTURE:
 * - NotificationAttempt model (status, attemptNo, nextAttemptAt, lastError, etc.)
 * - notificationDelivery.worker (lease-based queue processing)
 * - notificationDelivery.cron (runs every 30 seconds)
 * 
 * PURPOSE: Create and track delivery attempts for recovery tasks
 * 
 * RETRY POLICY:
 * - Attempt 1: Immediate
 * - Attempt 2: +5 minutes (exponential backoff)
 * - Attempt 3: +30 minutes
 * - Attempt 4: +6 hours
 * - After max attempts: mark as FAILED
 * 
 * CHANNELS SUPPORTED:
 * - WHATSAPP (primary for recovery)
 * - SMS (fallback)
 * - CALL (manual fallback)
 */

const NotificationAttempt = require('../models/NotificationAttempt');
const Notification = require('../models/Notification');
const FollowUpTask = require('../models/FollowUpTask');
const {getNowIST} = require('../utils/timezone.util');
const logger = require('../utils/logger');

/**
 * Calculate retry backoff delay
 * 
 * @param {number} attemptNo - Attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function calculateRetryBackoff(attemptNo) {
  // Exponential backoff: 5m, 30m, 6h
  const backoffMs = [
    0,                        // Attempt 1: immediate
    5 * 60 * 1000,           // Attempt 2: 5 minutes
    30 * 60 * 1000,          // Attempt 3: 30 minutes
    6 * 60 * 60 * 1000,      // Attempt 4: 6 hours
  ];
  
  return backoffMs[attemptNo] || backoffMs[backoffMs.length - 1];
}

/**
 * Create delivery attempt for a recovery task
 * 
 * ALGORITHM:
 * 1. Create Notification record (for tracking)
 * 2. Create NotificationAttempt (for delivery queue)
 * 3. Worker will pick it up and send
 * 
 * IDEMPOTENCY:
 * - Uses Notification.idempotencyKey to prevent duplicates
 * - Key format: followupTask_{taskId}_{channel}
 * 
 * @param {Object} params
 * @param {string} params.followupTaskId - FollowUpTask ID
 * @param {string} params.channel - Channel (WHATSAPP/SMS)
 * @param {string} params.requestId - Request ID (for tracing)
 * @returns {Promise<Object>} { notification, attempt }
 */
async function createDeliveryAttempt({followupTaskId, channel = 'WHATSAPP', requestId}) {
  try {
    // Fetch task
    const task = await FollowUpTask.findById(followupTaskId);
    if (!task) {
      throw new Error('FollowUpTask not found');
    }
    
    // Idempotency key
    const idempotencyKey = `followupTask_${followupTaskId}_${channel}`;
    
    // Check if notification already exists
    const existingNotification = await Notification.findOne({
      userId: task.userId,
      idempotencyKey,
    });
    
    if (existingNotification) {
      logger.debug('[DeliveryAttempt] Notification already exists', {
        followupTaskId,
        channel,
        notificationId: existingNotification._id,
      });
      
      // Return existing
      const existingAttempt = await NotificationAttempt.findOne({
        notificationId: existingNotification._id,
        channel,
      });
      
      return {
        notification: existingNotification,
        attempt: existingAttempt,
        created: false,
      };
    }
    
    // Create notification
    const notification = await Notification.create({
      userId: task.userId,
      customerId: task.customerId,
      kind: 'FOLLOWUP',
      title: task.title,
      body: task.note || task.title,
      channels: [channel],
      metadata: {
        followupTaskId: task._id,
        source: task.source,
        escalationLevel: task.escalationLevel,
      },
      idempotencyKey,
    });
    
    logger.info('[DeliveryAttempt] Notification created', {
      notificationId: notification._id,
      followupTaskId,
      channel,
    });
    
    // Create attempt
    const attempt = await NotificationAttempt.create({
      notificationId: notification._id,
      channel,
      status: 'QUEUED',
      attemptNo: 0,
      maxAttempts: 4, // Will retry up to 4 times total
      nextAttemptAt: getNowIST(), // Immediate
      requestId,
    });
    
    logger.info('[DeliveryAttempt] Attempt created (queued for delivery)', {
      attemptId: attempt._id,
      notificationId: notification._id,
      followupTaskId,
      channel,
    });
    
    return {
      notification,
      attempt,
      created: true,
    };
  } catch (error) {
    logger.error('[DeliveryAttempt] Failed to create delivery attempt', error, {
      followupTaskId,
      channel,
    });
    throw error;
  }
}

/**
 * Record delivery result (success or failure)
 * 
 * @param {Object} params
 * @param {string} params.attemptId - NotificationAttempt ID
 * @param {string} params.status - Status (SENT/FAILED)
 * @param {Object} params.error - Error details (if failed)
 * @param {Object} params.providerResponse - Provider response
 * @returns {Promise<Object>} Updated attempt
 */
async function recordDeliveryResult({attemptId, status, error = null, providerResponse = null}) {
  try {
    const attempt = await NotificationAttempt.findById(attemptId);
    if (!attempt) {
      throw new Error('NotificationAttempt not found');
    }
    
    const update = {
      status,
    };
    
    if (status === 'SENT') {
      update.providerMessageId = providerResponse?.messageId;
      update.providerStatus = providerResponse?.status;
      
      logger.info('[DeliveryAttempt] Delivery succeeded', {
        attemptId,
        notificationId: attempt.notificationId,
      });
    } else if (status === 'FAILED') {
      update.lastError = {
        code: error?.code,
        message: error?.message,
        retryable: error?.retryable || false,
        providerResponse,
      };
      
      // Check if should retry
      if (attempt.attemptNo < attempt.maxAttempts - 1 && error?.retryable !== false) {
        // Schedule retry
        const backoff = calculateRetryBackoff(attempt.attemptNo + 1);
        const nextAttemptAt = new Date(Date.now() + backoff);
        
        update.status = 'RETRY_SCHEDULED';
        update.nextAttemptAt = nextAttemptAt;
        update.attemptNo = attempt.attemptNo + 1;
        
        logger.warn('[DeliveryAttempt] Delivery failed, retrying', {
          attemptId,
          attemptNo: update.attemptNo,
          maxAttempts: attempt.maxAttempts,
          nextAttemptAt,
        });
      } else {
        // Max attempts reached or not retryable
        update.status = 'FAILED';
        
        logger.error('[DeliveryAttempt] Delivery permanently failed', {
          attemptId,
          attemptNo: attempt.attemptNo,
          maxAttempts: attempt.maxAttempts,
        });
      }
    }
    
    const updated = await NotificationAttempt.findByIdAndUpdate(attemptId, update, {new: true});
    
    return updated;
  } catch (error) {
    logger.error('[DeliveryAttempt] Failed to record delivery result', error, {
      attemptId,
      status,
    });
    throw error;
  }
}

/**
 * Get delivery status for a followup task
 * 
 * @param {string} followupTaskId - FollowUpTask ID
 * @returns {Promise<Object>} { lastAttemptAt, lastAttemptStatus, nextAttemptAt, failedReason }
 */
async function getDeliveryStatus(followupTaskId) {
  try {
    // Find notification for this task
    const notification = await Notification.findOne({
      'metadata.followupTaskId': followupTaskId,
    }).lean();
    
    if (!notification) {
      return {
        lastAttemptAt: null,
        lastAttemptStatus: null,
        nextAttemptAt: null,
        failedReason: null,
      };
    }
    
    // Find latest attempt
    const attempt = await NotificationAttempt.findOne({
      notificationId: notification._id,
    })
      .sort({createdAt: -1})
      .lean();
    
    if (!attempt) {
      return {
        lastAttemptAt: null,
        lastAttemptStatus: null,
        nextAttemptAt: null,
        failedReason: null,
      };
    }
    
    return {
      lastAttemptAt: attempt.updatedAt,
      lastAttemptStatus: attempt.status,
      nextAttemptAt: attempt.status === 'RETRY_SCHEDULED' ? attempt.nextAttemptAt : null,
      failedReason: attempt.lastError?.message || null,
      attemptNo: attempt.attemptNo,
      maxAttempts: attempt.maxAttempts,
    };
  } catch (error) {
    logger.error('[DeliveryAttempt] Failed to get delivery status', error, {
      followupTaskId,
    });
    
    return {
      lastAttemptAt: null,
      lastAttemptStatus: null,
      nextAttemptAt: null,
      failedReason: error.message,
    };
  }
}

module.exports = {
  createDeliveryAttempt,
  recordDeliveryResult,
  getDeliveryStatus,
  calculateRetryBackoff,
};
