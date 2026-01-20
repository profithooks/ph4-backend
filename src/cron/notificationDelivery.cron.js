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
    logger.warn('[NotificationCron] Cron already running');
    return;
  }
  
  // Run every 30 seconds: '*/30 * * * * *'
  cronJob = cron.schedule('*/30 * * * * *', async () => {
    try {
      logger.debug('[NotificationCron] Running worker');
      const stats = await runWorker();
      
      if (stats.processed > 0) {
        logger.info('[NotificationCron] Worker completed', stats);
      }
    } catch (error) {
      logger.error('[NotificationCron] Worker error', error);
    }
  });
  
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
