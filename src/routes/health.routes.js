/**
 * Health check routes
 */
const express = require('express');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const router = express.Router();

// Track server start time
const serverStartTime = Date.now();

/**
 * Check MongoDB connection status
 * @returns {Object} MongoDB health status
 */
const checkMongoDBHealth = async () => {
  try {
    const state = mongoose.connection.readyState;
    
    // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    if (state !== 1) {
      return {
        status: 'DOWN',
        state: getMongoStateString(state),
        message: 'MongoDB is not connected',
      };
    }

    // Ping the database to verify it's actually responding
    const startTime = Date.now();
    await mongoose.connection.db.admin().ping();
    const responseTime = Date.now() - startTime;

    return {
      status: 'UP',
      state: 'connected',
      responseTime: `${responseTime}ms`,
      host: mongoose.connection.host,
      database: mongoose.connection.name,
    };
  } catch (error) {
    logger.error('Health check: MongoDB ping failed', error);
    return {
      status: 'DOWN',
      state: 'error',
      message: error.message,
    };
  }
};

/**
 * Get human-readable MongoDB state string
 */
const getMongoStateString = (state) => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[state] || 'unknown';
};

/**
 * @route   GET /api/health
 * @desc    Enhanced health check endpoint with service status
 * @access  Public (no auth required)
 * 
 * @returns 200 if all services healthy
 * @returns 503 if any critical service degraded
 */
router.get('/health', async (req, res) => {
  const timestamp = new Date().toISOString();
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
  
  // Check MongoDB health
  const mongoHealth = await checkMongoDBHealth();
  
  // Determine overall service status
  const isHealthy = mongoHealth.status === 'UP';
  const status = isHealthy ? 'OK' : 'DEGRADED';
  const httpStatus = isHealthy ? 200 : 503;

  // Build health response
  const healthResponse = {
    status,
    timestamp,
    uptime: `${uptimeSeconds}s`,
    environment: process.env.NODE_ENV || 'development',
    service: 'ph4-backend',
    version: process.env.npm_package_version || '1.0.0',
    services: {
      mongodb: mongoHealth,
    },
  };

  // Log degraded state
  if (!isHealthy) {
    logger.warn('Health check: Service degraded', {
      status,
      mongoStatus: mongoHealth.status,
      mongoMessage: mongoHealth.message,
    });
  }

  res.status(httpStatus).json(healthResponse);
});

module.exports = router;
