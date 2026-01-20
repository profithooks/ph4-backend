/**
 * Database connection configuration
 */
const mongoose = require('mongoose');
const {mongoUri} = require('./env');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoUri);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    
    // Verify critical models are loaded (RECOVERY LADDER HARDENING)
    // This ensures no silent missing model errors
    setTimeout(() => {
      const loadedModels = Object.keys(mongoose.models);
      const criticalModels = [
        'FollowUpTask',
        'NotificationAttempt',
        'Notification',
        'CronLock',
      ];
      
      const missingModels = criticalModels.filter(m => !loadedModels.includes(m));
      
      if (missingModels.length > 0) {
        logger.warn('[DB] Critical models NOT loaded:', missingModels);
      } else {
        logger.info('[DB] All critical recovery models loaded:', criticalModels);
      }
      
      logger.info(`[DB] Total models loaded: ${loadedModels.length}`);
    }, 1000); // Wait 1s for models to register
  } catch (error) {
    logger.error('MongoDB connection failed', error);
    process.exit(1);
  }
};

module.exports = connectDB;
