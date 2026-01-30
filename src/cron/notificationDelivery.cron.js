/**
 * Notification Delivery Cron
 * 
 * Runs notification delivery worker periodically
 * Processes queued notification attempts
 */
const cron = require('node-cron');
const {runWorker} = require('../workers/notificationDelivery.worker');
const logger = require('../utils/logger');

let cronJob = null;

/**
 * Start notification delivery cron
 * Runs every 30 seconds
 */
function startNotificationDeliveryCron() {
  // Prevent multiple cron instances
  if (cronJob) {
    console.log('[NotificationCron] WARNING: Cron already running');
    logger.warn('[NotificationCron] Cron already running');
    return;
  }
  
  console.log('[NotificationCron] Starting notification delivery cron...');
  
  // Run every 30 seconds: '*/30 * * * * *'
  cronJob = cron.schedule('*/30 * * * * *', async () => {
    try {
      console.log('[NotificationCron] ⏰ Running worker cycle');
      const stats = await runWorker();
      
      console.log('[NotificationCron] Worker cycle complete:', stats);
      
      if (stats.processed > 0) {
        logger.info('[NotificationCron] Worker completed', stats);
      }
    } catch (error) {
      console.error('[NotificationCron] ❌ Worker error:', error.message, error.stack);
      logger.error('[NotificationCron] Worker error', error);
    }
  });
  
  console.log('[NotificationCron] ✅ Started successfully (runs every 30 seconds)');
  logger.info('[NotificationCron] Started (runs every 30 seconds)');
}

/**
 * Stop notification delivery cron
 */
function stopNotificationDeliveryCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('[NotificationCron] Stopped');
  }
}

module.exports = {
  startNotificationDeliveryCron,
  stopNotificationDeliveryCron,
};
