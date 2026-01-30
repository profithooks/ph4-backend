/**
 * Daily Stats Cron Job
 * 
 * Runs daily at 00:05 IST to compute and store stats for previous day
 */
const cron = require('node-cron');
const { generateDailyStats } = require('../services/dailyStatsService');
const logger = require('../utils/logger');

/**
 * Start daily stats cron job
 * Runs at 00:05 IST (18:35 UTC previous day)
 */
const startDailyStatsCron = () => {
  // IST is UTC+5:30, so 00:05 IST = 18:35 UTC previous day
  // Cron format: minute hour day month weekday
  const cronExpression = '35 18 * * *'; // 18:35 UTC = 00:05 IST next day
  
  cron.schedule(cronExpression, async () => {
    logger.info('[Cron] Daily stats job started');
    
    try {
      const report = await generateDailyStats();
      logger.info('[Cron] Daily stats job completed', report);
    } catch (error) {
      logger.error('[Cron] Daily stats job failed:', error);
    }
  }, {
    timezone: 'UTC',
  });
  
  logger.info('[Cron] Daily stats job scheduled at 00:05 IST (18:35 UTC)');
};

module.exports = { startDailyStatsCron };
