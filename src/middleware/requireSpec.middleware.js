/**
 * RequireSpec Middleware
 * 
 * Enforces spec code mapping on routes
 * Step 14: Control Spec Compliance Gate
 */
const {assertSpecMapping} = require('../spec/ph4SpecRegistry');
const logger = require('../utils/logger');

/**
 * Middleware factory to require spec code mapping
 * 
 * @param {String[]} specCodes - Array of spec codes this endpoint implements
 * @returns {Function} Express middleware
 */
const requireSpec = (specCodes) => {
  // Validate spec codes at registration time
  try {
    assertSpecMapping(specCodes);
  } catch (error) {
    // Fail fast: invalid spec codes should crash the app at startup
    logger.error('[RequireSpec] Invalid spec codes', {
      specCodes,
      error: error.message,
    });
    throw error;
  }

  // Return middleware
  return (req, res, next) => {
    // Attach spec codes to res.locals for logging/debugging
    res.locals.specCodes = specCodes;

    // In dev mode, optionally include spec codes in response envelope
    if (process.env.NODE_ENV === 'development' && res.success) {
      const originalSuccess = res.success.bind(res);
      res.success = (data, statusCode = 200) => {
        return originalSuccess(data, statusCode, {
          _meta: {
            specCodes,
          },
        });
      };
    }

    // Log spec codes with request (for observability)
    logger.debug('[RequireSpec] Route mapped', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      specCodes,
    });

    next();
  };
};

/**
 * Get spec codes from response locals (for logging)
 */
const getSpecCodes = (res) => {
  return res.locals.specCodes || [];
};

module.exports = {
  requireSpec,
  getSpecCodes,
};
