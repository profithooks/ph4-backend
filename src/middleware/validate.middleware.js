/**
 * DEPRECATED: Joi validation middleware (OLD FORMAT)
 * 
 * ⚠️  DO NOT USE THIS FILE - Use validation.middleware.js instead
 * 
 * This file returns non-standard envelope: {success:false, message, errors}
 * Standard envelope: {ok:false, requestId, error:{code, message, retryable, details}}
 * 
 * MIGRATION PATH:
 * - Replace: const {validate} = require('./middleware/validate.middleware');
 * - With:    const {validate} = require('./middleware/validation.middleware');
 * 
 * This file is kept for backward compatibility but will be removed in future.
 */

const logger = require('../utils/logger');

/**
 * @deprecated Use validation.middleware.js instead
 */
const validate = (schema) => {
  return (req, res, next) => {
    logger.warn('[DEPRECATED] Using old validate.middleware.js - migrate to validation.middleware.js', {
      requestId: req.requestId,
      path: req.path,
    });
    
    const {error, value} = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      // OLD FORMAT (non-standard)
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors,
      });
    }

    req.body = value;
    next();
  };
};

module.exports = {validate};
