/**
 * Health Controller
 * 
 * Health and readiness endpoints for production monitoring
 * Step 12: Production Readiness
 */
const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Basic health check
 * Always returns 200 if service is running
 * 
 * GET /health
 */
const getHealth = (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'ph4-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};

/**
 * Readiness check
 * Checks if service is ready to handle requests
 * Returns 503 if not ready
 * 
 * GET /ready
 */
const getReadiness = async (req, res) => {
  const checks = {
    database: false,
    environment: false,
  };

  const errors = [];

  try {
    // Check database connection
    if (mongoose.connection.readyState === 1) {
      checks.database = true;
    } else {
      errors.push('Database not connected');
    }

    // Check essential environment variables
    const requiredEnvVars = [
      'MONGODB_URI',
      'JWT_SECRET',
      'PORT',
    ];

    const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

    if (missingEnvVars.length === 0) {
      checks.environment = true;
    } else {
      errors.push(`Missing env vars: ${missingEnvVars.join(', ')}`);
    }

    // Determine overall readiness
    const ready = checks.database && checks.environment;

    if (ready) {
      return res.status(200).json({
        ok: true,
        ready: true,
        checks,
        timestamp: new Date().toISOString(),
      });
    } else {
      return res.status(503).json({
        ok: false,
        ready: false,
        checks,
        errors,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error('[Health] Readiness check failed', error);

    return res.status(503).json({
      ok: false,
      ready: false,
      checks,
      errors: [...errors, 'Internal error during readiness check'],
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Detailed status (for debugging, optional)
 * 
 * GET /status
 */
const getStatus = async (req, res) => {
  try {
    const status = {
      service: 'ph4-backend',
      version: process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      node: process.version,
      env: process.env.NODE_ENV || 'development',
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      },
      database: {
        connected: mongoose.connection.readyState === 1,
        state: ['disconnected', 'connected', 'connecting', 'disconnecting'][
          mongoose.connection.readyState
        ],
      },
    };

    res.status(200).json({
      ok: true,
      ...status,
    });
  } catch (error) {
    logger.error('[Health] Status check failed', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to get status',
    });
  }
};

module.exports = {
  getHealth,
  getReadiness,
  getStatus,
};
