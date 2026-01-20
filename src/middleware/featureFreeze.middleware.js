/**
 * Feature Freeze Middleware
 * 
 * Blocks non-essential writes in production when FEATURE_FREEZE=true
 * Step 23: Go-Live & Rollout Control
 */
const AuditEvent = require('../models/AuditEvent');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const FEATURE_FREEZE_ENABLED = process.env.FEATURE_FREEZE === 'true';

// Whitelisted routes that are allowed even during feature freeze
// These are essential business operations
const WHITELISTED_ROUTES = [
  // Billing (core operation)
  { method: 'POST', pattern: /^\/api\/bills/ },
  { method: 'PATCH', pattern: /^\/api\/bills/ },
  { method: 'PUT', pattern: /^\/api\/bills/ },
  
  // Customers (core operation)
  { method: 'POST', pattern: /^\/api\/customers/ },
  { method: 'PATCH', pattern: /^\/api\/customers/ },
  { method: 'PUT', pattern: /^\/api\/customers/ },
  
  // Recovery visibility (viewing, not creating new)
  { method: 'GET', pattern: /^\/api\/recovery/ },
  { method: 'GET', pattern: /^\/api\/v1\/today/ },
  
  // Support (essential for issues)
  { method: 'POST', pattern: /^\/api\/v1\/support/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/support/ },
  
  // Diagnostics (troubleshooting)
  { method: 'GET', pattern: /^\/api\/v1\/diagnostics/ },
  { method: 'POST', pattern: /^\/api\/v1\/diagnostics\/integrity\/run/ },
  
  // Ops endpoints (monitoring)
  { method: 'GET', pattern: /^\/api\/v1\/ops/ },
  
  // Kill-switch management (emergency control)
  { method: 'PATCH', pattern: /^\/api\/v1\/settings\/kill-switch/ },
  
  // Auth (essential)
  { method: 'POST', pattern: /^\/api\/auth/ },
  
  // Health checks
  { method: 'GET', pattern: /^\/(health|ready|status)/ },
];

// Read-only methods (always allowed)
const READ_ONLY_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Check if route is whitelisted
 */
function isWhitelisted(method, path) {
  return WHITELISTED_ROUTES.some(route => {
    return route.method === method && route.pattern.test(path);
  });
}

/**
 * Feature Freeze Middleware
 * Blocks non-essential writes when feature freeze is enabled
 */
async function checkFeatureFreeze(req, res, next) {
  // Skip if feature freeze is disabled
  if (!FEATURE_FREEZE_ENABLED) {
    return next();
  }

  const method = req.method.toUpperCase();
  const path = req.path;

  // Allow read-only operations
  if (READ_ONLY_METHODS.includes(method)) {
    return next();
  }

  // Check if route is whitelisted
  if (isWhitelisted(method, path)) {
    return next();
  }

  // Block the request
  logger.warn('[FeatureFreeze] Blocked non-essential write', {
    method,
    path,
    userId: req.user?._id,
    businessId: req.user?.businessId,
  });

  // Create audit event
  if (req.user) {
    try {
      await AuditEvent.create({
        at: new Date(),
        businessId: req.user.businessId,
        actorUserId: req.user._id,
        action: 'FEATURE_FROZEN_BLOCK',
        entityType: 'SYSTEM',
        metadata: {
          method,
          path,
          requestId: req.requestId,
        },
      });
    } catch (error) {
      logger.error('[FeatureFreeze] Failed to create audit event', error);
    }
  }

  throw new AppError(
    'This operation is not available during feature freeze. Only essential business operations are allowed.',
    503,
    'FEATURE_FROZEN',
    {
      method,
      path,
      featureFreezeEnabled: true,
    }
  );
}

module.exports = {
  checkFeatureFreeze,
  FEATURE_FREEZE_ENABLED,
};
