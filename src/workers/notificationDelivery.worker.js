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
const BusinessSettings = require('../models/BusinessSettings');
const {getTransport} = require('../services/notificationTransports');
const {getNowIST} = require('../utils/timezone.util');
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
  
  console.log('[NotificationWorker] DEBUG: Leasing attempts with query:', JSON.stringify(query));
  console.log('[NotificationWorker] DEBUG: Current time:', now.toISOString());
  
  const attempts = [];
  
  // Check total count of attempts in DB
  const totalAttempts = await NotificationAttempt.countDocuments({});
  const queuedAttempts = await NotificationAttempt.countDocuments({status: 'QUEUED'});
  console.log('[NotificationWorker] DEBUG: Total attempts in DB:', totalAttempts);
  console.log('[NotificationWorker] DEBUG: Queued attempts:', queuedAttempts);
  
  // Check what statuses exist
  const statusCounts = await NotificationAttempt.aggregate([
    {$group: {_id: '$status', count: {$sum: 1}}},
  ]);
  console.log('[NotificationWorker] DEBUG: Status breakdown:', JSON.stringify(statusCounts));
  
  // Get sample attempts to see their details
  const sampleAttempts = await NotificationAttempt.find({}).limit(4).lean();
  console.log('[NotificationWorker] DEBUG: Sample attempts:', JSON.stringify(sampleAttempts.map(a => ({
    id: a._id,
    channel: a.channel,
    status: a.status,
    nextAttemptAt: a.nextAttemptAt,
    leasedUntil: a.leasedUntil,
  }))));
  
  // Find candidates
  const candidates = await NotificationAttempt.find(query)
    .sort({nextAttemptAt: 1}) // Oldest first (deterministic)
    .limit(limit)
    .lean();
  
  console.log('[NotificationWorker] DEBUG: Found candidates:', candidates.length);
  
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
    
    // Check quiet hours for PUSH notifications
    if (attempt.channel === 'PUSH') {
      const settings = await BusinessSettings.findOne({userId: user._id});
      
      if (settings && settings.quietHoursEnabled) {
        const isQuietHour = checkQuietHours(
          settings.quietStart,
          settings.quietEnd,
        );
        
        if (isQuietHour) {
          // Reschedule for after quiet hours end
          const nextAttempt = calculateNextAttemptAfterQuietHours(
            settings.quietEnd,
          );
          
          attempt.status = 'RETRY_SCHEDULED';
          attempt.nextAttemptAt = nextAttempt;
          attempt.leasedUntil = null;
          attempt.lastError = {
            code: 'QUIET_HOURS',
            message: 'Notification delayed due to quiet hours',
          };
          
          await attempt.save();
          
          logger.info('[NotificationWorker] Attempt deferred due to quiet hours', {
            attemptId: attempt._id,
            nextAttemptAt: nextAttempt,
            quietStart: settings.quietStart,
            quietEnd: settings.quietEnd,
          });
          
          return {success: false, deferred: true};
        }
      }
    }
    
    // Get transport for channel
    const transport = getTransport(attempt.channel);
    
    console.log('[NotificationWorker] 🚀 Processing attempt:', {
      attemptId: attempt._id,
      notificationId: notification._id,
      channel: attempt.channel,
      attemptNo: attempt.attemptNo,
      transportName: transport ? transport.getName() : 'null',
    });
    
    logger.debug('[NotificationWorker] Processing attempt', {
      attemptId: attempt._id,
      notificationId: notification._id,
      channel: attempt.channel,
      attemptNo: attempt.attemptNo,
    });
    
    // Increment attempt number
    attempt.attemptNo += 1;
    
    console.log('[NotificationWorker] 📤 Calling transport.send() for channel:', attempt.channel);
    
    // Send via transport
    const result = await transport.send({
      notification,
      attempt,
      user,
      customer,
    });
    
    console.log('[NotificationWorker] ✅ Transport.send() returned:', {
      ok: result.ok,
      providerMessageId: result.providerMessageId,
      channel: attempt.channel,
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
      return {processed: 0, sent: 0, retrying: 0, failed: 0, succeeded: 0};
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
    
    // Add succeeded alias for backward compatibility
    results.succeeded = results.sent;
    
    logger.info('[NotificationWorker] Batch complete', results);
    
    return results;
  } catch (error) {
    logger.error('[NotificationWorker] Worker error', error);
    return {error: true, message: error.message};
  }
}

/**
 * Check if current time is within quiet hours
 * 
 * @param {string} quietStart - Start time in HH:mm format (IST)
 * @param {string} quietEnd - End time in HH:mm format (IST)
 * @returns {boolean} True if within quiet hours
 */
function checkQuietHours(quietStart, quietEnd) {
  try {
    const nowIST = getNowIST();
    const currentHours = nowIST.getHours();
    const currentMinutes = nowIST.getMinutes();
    const currentTotalMinutes = currentHours * 60 + currentMinutes;
    
    // Parse start and end times
    const [startHours, startMinutes] = quietStart.split(':').map(Number);
    const startTotalMinutes = startHours * 60 + startMinutes;
    
    const [endHours, endMinutes] = quietEnd.split(':').map(Number);
    const endTotalMinutes = endHours * 60 + endMinutes;
    
    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (startTotalMinutes > endTotalMinutes) {
      // Overnight: quiet hours span midnight
      return currentTotalMinutes >= startTotalMinutes || currentTotalMinutes < endTotalMinutes;
    } else {
      // Same day: quiet hours within a single day
      return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes;
    }
  } catch (error) {
    logger.error('[NotificationWorker] Failed to check quiet hours', {
      error: error.message,
      quietStart,
      quietEnd,
    });
    return false; // On error, don't block delivery
  }
}

/**
 * Calculate next attempt time after quiet hours end
 * 
 * @param {string} quietEnd - End time in HH:mm format (IST)
 * @returns {Date} Next attempt time (after quiet hours end)
 */
function calculateNextAttemptAfterQuietHours(quietEnd) {
  try {
    const nowIST = getNowIST();
    const [endHours, endMinutes] = quietEnd.split(':').map(Number);
    
    // Create a date for quiet hours end time today
    const endTime = new Date(nowIST);
    endTime.setHours(endHours);
    endTime.setMinutes(endMinutes);
    endTime.setSeconds(0);
    endTime.setMilliseconds(0);
    
    // If end time already passed today, schedule for tomorrow
    if (endTime <= nowIST) {
      endTime.setDate(endTime.getDate() + 1);
    }
    
    // Add 5 minutes buffer after quiet hours end
    endTime.setMinutes(endTime.getMinutes() + 5);
    
    return endTime;
  } catch (error) {
    logger.error('[NotificationWorker] Failed to calculate next attempt', {
      error: error.message,
      quietEnd,
    });
    // Fallback: retry in 1 hour
    return new Date(Date.now() + 60 * 60 * 1000);
  }
}

module.exports = {
  runWorker,
  leaseAttempts,
  processAttempt,
  checkQuietHours, // Exported for testing
  calculateNextAttemptAfterQuietHours, // Exported for testing
};
