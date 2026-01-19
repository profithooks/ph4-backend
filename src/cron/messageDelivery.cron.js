/**
 * Message Delivery Cron Job
 * Runs every minute to process pending messages
 */
const cron = require('node-cron');
const {runOnce} = require('../workers/messageDelivery.worker');
const logger = require('../utils/logger');

let isRunning = false;

/**
 * Start message delivery cron job
 */
exports.startMessageDeliveryCron = () => {
  // Run every minute
  const task = cron.schedule('* * * * *', async () => {
    // Prevent overlapping runs
    if (isRunning) {
      logger.debug('Message delivery cron: previous run still in progress, skipping');
      return;
    }

    isRunning = true;
    
    try {
      await runOnce();
    } catch (error) {
      logger.error('Message delivery cron worker error', error);
    } finally {
      isRunning = false;
    }
  });

  logger.info('Message delivery cron started (runs every minute)');
  
  return task;
};

/**
 * Run worker immediately (for testing/manual trigger)
 */
exports.runImmediately = async () => {
  if (isRunning) {
    throw new Error('Worker already running');
  }

  isRunning = true;
  
  try {
    return await runOnce();
  } finally {
    isRunning = false;
  }
};
