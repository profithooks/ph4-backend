/**
 * Kill-Switch Middleware
 * 
 * Enforces global and per-feature kill-switches for production safety
 * Step 23: Go-Live & Rollout Control
 */
const BusinessSettings = require('../models/BusinessSettings');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// Read-only HTTP methods
const READ_ONLY_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Feature to route pattern mapping
const FEATURE_ROUTES = {
  recoveryEngine: ['/api/recovery', '/api/v1/today/chase', '/api/promises'],
  followupEngine: ['/api/followups'],
  offlineSync: ['/api/v1/diagnostics/sync'],
  notifications: ['/api/v1/notifications'],
  insights: ['/api/v1/insights'],
  backupRestore: ['/api/v1/backup', '/api/v1/security/business-reset'],
};

/**
 * Check if route matches a feature pattern
 */
function matchesFeatureRoute(path, featureRoutes) {
  return featureRoutes.some(pattern => path.startsWith(pattern));
}

/**
 * Global Kill-Switch Middleware
 * Blocks all writes when globalKillSwitch = true
 */
async function checkGlobalKillSwitch(req, res, next) {
  try {
    // Skip for unauthenticated requests (let auth middleware handle)
    if (!req.user || !req.user.businessId) {
      return next();
    }

    // Skip for health/status endpoints
    if (req.path.startsWith('/health') || req.path.startsWith('/ready') || req.path.startsWith('/status')) {
      return next();
    }

    // Get business settings
    const settings = await BusinessSettings.findOne({ businessId: req.user.businessId }).lean();
    
    if (!settings) {
      return next();
    }

    // Check global kill-switch
    if (settings.globalKillSwitch === true) {
      // Allow read-only operations
      if (READ_ONLY_METHODS.includes(req.method.toUpperCase())) {
        return next();
      }

      // Block writes
      logger.warn('[KillSwitch] Global kill-switch blocked write', {
        method: req.method,
        path: req.path,
        businessId: req.user.businessId,
        userId: req.user._id,
      });

      throw new AppError(
        'System is currently paused by the owner. Only read-only operations are allowed.',
        503,
        'SYSTEM_PAUSED',
        {
          globalKillSwitch: true,
          activatedAt: settings.globalKillSwitchActivatedAt,
        }
      );
    }

    next();
  } catch (error) {
    if (error.code === 'SYSTEM_PAUSED') {
      next(error);
    } else {
      logger.error('[KillSwitch] Error checking global kill-switch', error);
      next();
    }
  }
}

/**
 * Feature Kill-Switch Middleware Factory
 * Returns middleware that checks if a specific feature is paused
 */
function requireFeatureActive(featureName) {
  return async (req, res, next) => {
    try {
      // Skip for unauthenticated requests
      if (!req.user || !req.user.businessId) {
        return next();
      }

      // Get business settings
      const settings = await BusinessSettings.findOne({ businessId: req.user.businessId }).lean();
      
      if (!settings) {
        return next();
      }

      // Check if feature is paused
      const featureKillSwitch = settings.featureKillSwitches?.[featureName];
      
      if (featureKillSwitch === true) {
        logger.warn('[KillSwitch] Feature kill-switch blocked request', {
          feature: featureName,
          method: req.method,
          path: req.path,
          businessId: req.user.businessId,
          userId: req.user._id,
        });

        throw new AppError(
          `${featureName} is temporarily paused by the owner.`,
          503,
          'FEATURE_PAUSED',
          {
            feature: featureName,
            featureKillSwitch: true,
          }
        );
      }

      next();
    } catch (error) {
      if (error.code === 'FEATURE_PAUSED') {
        next(error);
      } else {
        logger.error('[KillSwitch] Error checking feature kill-switch', error);
        next();
      }
    }
  };
}

/**
 * Auto-detect feature from route and check kill-switch
 */
async function checkFeatureKillSwitches(req, res, next) {
  try {
    // Skip for unauthenticated requests
    if (!req.user || !req.user.businessId) {
      return next();
    }

    // Skip for read-only operations
    if (READ_ONLY_METHODS.includes(req.method.toUpperCase())) {
      return next();
    }

    // Get business settings
    const settings = await BusinessSettings.findOne({ businessId: req.user.businessId }).lean();
    
    if (!settings || !settings.featureKillSwitches) {
      return next();
    }

    // Check each feature
    for (const [featureName, routes] of Object.entries(FEATURE_ROUTES)) {
      if (matchesFeatureRoute(req.path, routes)) {
        const featureKillSwitch = settings.featureKillSwitches[featureName];
        
        if (featureKillSwitch === true) {
          logger.warn('[KillSwitch] Auto-detected feature paused', {
            feature: featureName,
            method: req.method,
            path: req.path,
            businessId: req.user.businessId,
          });

          throw new AppError(
            `${featureName} is temporarily paused by the owner.`,
            503,
            'FEATURE_PAUSED',
            {
              feature: featureName,
              featureKillSwitch: true,
            }
          );
        }
      }
    }

    next();
  } catch (error) {
    if (error.code === 'FEATURE_PAUSED') {
      next(error);
    } else {
      logger.error('[KillSwitch] Error checking feature kill-switches', error);
      next();
    }
  }
}

module.exports = {
  checkGlobalKillSwitch,
  requireFeatureActive,
  checkFeatureKillSwitches,
};
