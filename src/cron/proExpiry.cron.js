/**
 * Pro Expiry Cron
 * 
 * Handles automatic Pro subscription expiry:
 * - Marks expired subscriptions as 'expired'
 * - Downgrades user planStatus from 'pro' to 'free'
 * - Runs daily at midnight IST (18:30 UTC)
 */
const cron = require('node-cron');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');
const { getNowIST, getISTDateString } = require('../utils/timezone.util');

let cronJob = null;

/**
 * Process expired Pro subscriptions
 * 
 * Steps:
 * 1. Find all active subscriptions past their expiresAt
 * 2. Mark subscriptions as 'expired'
 * 3. Downgrade user planStatus to 'free'
 */
async function processExpiredSubscriptions() {
  try {
    const nowIST = getNowIST();
    const dateIST = getISTDateString();
    
    logger.info('[ProExpiryCron] Starting Pro expiry check', {
      timestamp: nowIST.toISOString(),
      dateIST,
    });

    // Step 1: Find all active subscriptions that have expired
    const expiredSubscriptions = await Subscription.find({
      status: 'active',
      expiresAt: { $lt: nowIST },
    }).populate('userId');

    if (expiredSubscriptions.length === 0) {
      logger.debug('[ProExpiryCron] No expired subscriptions found');
      return { processed: 0, errors: 0 };
    }

    logger.info('[ProExpiryCron] Found expired subscriptions', {
      count: expiredSubscriptions.length,
    });

    let processed = 0;
    let errors = 0;

    // Step 2: Process each expired subscription
    for (const subscription of expiredSubscriptions) {
      try {
        const userId = subscription.userId._id || subscription.userId;

        // Mark subscription as expired
        subscription.status = 'expired';
        await subscription.save();

        // Find user and downgrade to free
        const user = await User.findById(userId);
        
        if (!user) {
          logger.error('[ProExpiryCron] User not found for subscription', {
            subscriptionId: subscription._id,
            userId,
          });
          errors++;
          continue;
        }

        // Downgrade user if they're still marked as Pro
        if (user.planStatus === 'pro') {
          user.planStatus = 'free';
          await user.save();

          logger.info('[ProExpiryCron] Downgraded user from Pro to Free', {
            userId: user._id.toString(),
            email: user.email,
            subscriptionId: subscription._id.toString(),
            expiredAt: subscription.expiresAt.toISOString(),
            planId: subscription.planId,
          });
        }

        processed++;
      } catch (error) {
        errors++;
        logger.error('[ProExpiryCron] Failed to process expired subscription', {
          subscriptionId: subscription._id,
          userId: subscription.userId,
          error: error.message,
          stack: error.stack,
        });
      }
    }

    logger.info('[ProExpiryCron] Pro expiry check completed', {
      processed,
      errors,
      total: expiredSubscriptions.length,
    });

    return { processed, errors };
  } catch (error) {
    logger.error('[ProExpiryCron] Pro expiry cron failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Start Pro expiry cron job
 * Runs daily at 00:00 IST (18:30 UTC previous day)
 * IST is UTC+5:30, so 00:00 IST = 18:30 UTC
 */
function startProExpiryCron() {
  // Prevent multiple instances
  if (cronJob) {
    logger.warn('[ProExpiryCron] Cron already running');
    return;
  }

  // Run daily at 00:00 IST (18:30 UTC): '30 18 * * *'
  cronJob = cron.schedule('30 18 * * *', async () => {
    try {
      await processExpiredSubscriptions();
    } catch (error) {
      logger.error('[ProExpiryCron] Cron execution failed', error);
    }
  });

  logger.info('[ProExpiryCron] Started', {
    schedule: '30 18 * * * (00:00 IST)',
    description: 'Daily Pro expiry check',
  });
}

/**
 * Stop Pro expiry cron job
 */
function stopProExpiryCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('[ProExpiryCron] Stopped');
  }
}

module.exports = {
  startProExpiryCron,
  stopProExpiryCron,
  processExpiredSubscriptions, // Exported for manual runs and testing
};
