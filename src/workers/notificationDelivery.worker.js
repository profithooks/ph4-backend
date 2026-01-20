/**
 * Notification Delivery Worker
 * 
 * Queue/lease worker for processing notification delivery attempts
 * Runs periodically to send queued notifications
 */
const NotificationAttempt = require('../models/NotificationAttempt');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Customer = require('../models/Customer');
const {getTransport} = require('../services/notificationTransports');
const logger = require('../utils/logger');

/**
 * Lease next batch of attempts ready for delivery
 * Uses atomic findOneAndUpdate to prevent concurrent processing
 * 
 * @param {number} limit - Max attempts to lease
 * @returns {Promise<Array>} Leased attempts
 */
async function leaseAttempts(limit = 20) {
  const now = new Date();
  const leaseDuration = 60 * 1000; // 60 seconds
  const leaseExpiry = new Date(now.getTime() + leaseDuration);
  
  // Find attempts ready for delivery
  const query = {
    status: {$in: ['QUEUED', 'RETRY_SCHEDULED']},
    nextAttemptAt: {$lte: now},
    $or: [
      {leasedUntil: {$exists: false}},
      {leasedUntil: null},
      {leasedUntil: {$lte: now}}, // Expired leases
    ],
  };
  
  const attempts = [];
  
  // Find candidates
  const candidates = await NotificationAttempt.find(query)
    .sort({nextAttemptAt: 1}) // Oldest first (deterministic)
    .limit(limit)
    .lean();
  
  // Atomically lease each candidate
  for (const candidate of candidates) {
    const leased = await NotificationAttempt.findOneAndUpdate(
      {
        _id: candidate._id,
        status: candidate.status,
        // Ensure no one else leased it
        $or: [
          {leasedUntil: {$exists: false}},
          {leasedUntil: null},
          {leasedUntil: {$lte: now}},
        ],
      },
      {
        $set: {
          status: 'LEASED',
          leasedUntil: leaseExpiry,
        },
      },
      {new: true},
    );
    
    if (leased) {
      attempts.push(leased);
    }
  }
  
  return attempts;
}

/**
 * Calculate exponential backoff for retry
 * 
 * @param {number} attemptNo - Attempt number (0-indexed)
 * @returns {number} Backoff delay in milliseconds
 */
function calculateBackoff(attemptNo) {
  // Backoff: min(2^attemptNo * 60s, 6 hours)
  const baseDelaySeconds = 60;
  const maxDelaySeconds = 6 * 60 * 60; // 6 hours
  
  const delaySeconds = Math.min(
    Math.pow(2, attemptNo) * baseDelaySeconds,
    maxDelaySeconds,
  );
  
  return delaySeconds * 1000; // Convert to ms
}

/**
 * Process a single delivery attempt
 * 
 * @param {Object} attempt - NotificationAttempt document
 * @returns {Promise<Object>} Result { success, error }
 */
async function processAttempt(attempt) {
  try {
    // Load related data
    const notification = await Notification.findById(attempt.notificationId);
    
    if (!notification) {
      throw new Error('Notification not found');
    }
    
    const user = await User.findById(notification.userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    let customer = null;
    if (notification.customerId) {
      customer = await Customer.findById(notification.customerId);
    }
    
    // Get transport for channel
    const transport = getTransport(attempt.channel);
    
    logger.debug('[NotificationWorker] Processing attempt', {
      attemptId: attempt._id,
      notificationId: notification._id,
      channel: attempt.channel,
      attemptNo: attempt.attemptNo,
    });
    
    // Increment attempt number
    attempt.attemptNo += 1;
    
    // Send via transport
    const result = await transport.send({
      notification,
      attempt,
      user,
      customer,
    });
    
    // Success!
    attempt.status = 'SENT';
    attempt.leasedUntil = null;
    attempt.providerMessageId = result.providerMessageId;
    attempt.lastError = null;
    
    await attempt.save();
    
    logger.info('[NotificationWorker] Attempt sent successfully', {
      attemptId: attempt._id,
      channel: attempt.channel,
      providerMessageId: result.providerMessageId,
    });
    
    return {success: true};
  } catch (error) {
    logger.error('[NotificationWorker] Attempt failed', error, {
      attemptId: attempt._id,
      channel: attempt.channel,
      attemptNo: attempt.attemptNo,
    });
    
    // Determine if error is retryable
    const retryable = error.retryable !== false && error.code !== 'PROVIDER_NOT_CONFIGURED';
    
    // Check if we should retry
    if (retryable && attempt.attemptNo < attempt.maxAttempts) {
      // Schedule retry with backoff
      const backoff = calculateBackoff(attempt.attemptNo);
      const nextAttemptAt = new Date(Date.now() + backoff);
      
      attempt.status = 'RETRY_SCHEDULED';
      attempt.nextAttemptAt = nextAttemptAt;
      attempt.leasedUntil = null;
      attempt.lastError = {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message,
        retryable: true,
      };
      
      await attempt.save();
      
      logger.info('[NotificationWorker] Retry scheduled', {
        attemptId: attempt._id,
        nextAttemptAt,
        attemptNo: attempt.attemptNo,
        maxAttempts: attempt.maxAttempts,
      });
      
      return {success: false, retrying: true};
    } else {
      // Permanently failed
      attempt.status = 'FAILED';
      attempt.leasedUntil = null;
      attempt.lastError = {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message,
        retryable: false,
      };
      
      await attempt.save();
      
      logger.error('[NotificationWorker] Attempt permanently failed', {
        attemptId: attempt._id,
        reason: retryable ? 'Max retries exceeded' : 'Non-retryable error',
      });
      
      return {success: false, retrying: false};
    }
  }
}

/**
 * Run worker once - process batch of attempts
 * 
 * @returns {Promise<Object>} Statistics
 */
async function runWorker() {
  try {
    const attempts = await leaseAttempts(20);
    
    if (attempts.length === 0) {
      logger.debug('[NotificationWorker] No attempts to process');
      return {processed: 0, sent: 0, retrying: 0, failed: 0};
    }
    
    logger.info('[NotificationWorker] Processing batch', {
      count: attempts.length,
    });
    
    const results = {
      processed: attempts.length,
      sent: 0,
      retrying: 0,
      failed: 0,
    };
    
    // Process each attempt
    for (const attempt of attempts) {
      const result = await processAttempt(attempt);
      
      if (result.success) {
        results.sent++;
      } else if (result.retrying) {
        results.retrying++;
      } else {
        results.failed++;
      }
    }
    
    logger.info('[NotificationWorker] Batch complete', results);
    
    return results;
  } catch (error) {
    logger.error('[NotificationWorker] Worker error', error);
    return {error: true, message: error.message};
  }
}

module.exports = {
  runWorker,
  leaseAttempts,
  processAttempt,
};
