/**
 * Server entry point
 */
const logger = require('./utils/logger');

// Validate environment config BEFORE loading anything else
// This will crash if JWT_SECRET is missing or weak
let config;
try {
  config = require('./config/env');
  logger.info('Environment configuration validated', {
    nodeEnv: config.nodeEnv,
    jwtExpire: config.jwtExpire,
  });
} catch (error) {
  logger.error('FATAL: Environment configuration validation failed', error);
  console.error('\n' + error.message + '\n');
  process.exit(1);
}

// Initialize Sentry early (before app loads)
// Safe to call even if DSN is missing - will warn but not crash
const {initSentry} = require('./config/sentry');
initSentry();

const app = require('./app');
const connectDB = require('./config/db');
const mongoose = require('mongoose');
const {startMessageDeliveryCron} = require('./cron/messageDelivery.cron');
const {startNotificationDeliveryCron} = require('./cron/notificationDelivery.cron');
const {scheduleIntegrityChecks} = require('./cron/integrityCheck.cron');
const {startRecoveryTaskCron} = require('./cron/recoveryTaskProcessing.cron');

// Connect to database
connectDB();

// Read port from environment or default to 5055 (proof script uses 5055)
const PORT = Number(process.env.PORT) || 5055;

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  
  // Start cron jobs after server is ready
  startMessageDeliveryCron();
  startNotificationDeliveryCron();
  scheduleIntegrityChecks();
  
  // MULTI-INSTANCE SAFE: Recovery cron uses distributed lock (CronLock model)
  // Safe to start on all instances - only ONE will execute per interval
  startRecoveryTaskCron(); // Recovery task processing (every 10 minutes)
});

// Handle listen errors
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`, err);
  } else {
    logger.error('Server error', err);
  }
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Rejection', err);
  server.close(() => process.exit(1));
});

/**
 * Graceful shutdown handler
 * Handles SIGTERM and SIGINT signals for clean shutdown
 */
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  // Set a timeout to force exit if graceful shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timeout. Forcing exit...');
    process.exit(1);
  }, 10000); // 10 seconds

  // Close server to stop accepting new connections
  server.close(async (err) => {
    clearTimeout(forceExitTimeout);
    
    if (err) {
      logger.error('Error during server close', err);
      process.exit(1);
    }

    logger.info('HTTP server closed');

    // Close database connection
    try {
      await mongoose.connection.close();
      logger.info('Database connection closed');
      process.exit(0);
    } catch (error) {
      logger.error('Error closing database', error);
      process.exit(1);
    }
  });
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
