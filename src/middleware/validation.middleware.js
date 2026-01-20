/**
 * Validation Middleware
 * 
 * Input validation using Joi for all endpoints
 * Step 12: Production Readiness
 */
const Joi = require('joi');
const logger = require('../utils/logger');

/**
 * Validate request using Joi schema
 * 
 * @param {Object} schema - Joi schema object { body?, query?, params? }
 * @returns {Function} Express middleware
 */
const validate = (schema) => {
  return (req, res, next) => {
    try {
      const validationOptions = {
        abortEarly: false, // Return all errors
        stripUnknown: true, // Remove unknown fields
        allowUnknown: false,
      };

      // Validate body
      if (schema.body) {
        const {error, value} = schema.body.validate(req.body, validationOptions);
        if (error) {
          return sendValidationError(req, res, error, 'body');
        }
        req.body = value;
      }

      // Validate query
      if (schema.query) {
        const {error, value} = schema.query.validate(req.query, validationOptions);
        if (error) {
          return sendValidationError(req, res, error, 'query');
        }
        req.query = value;
      }

      // Validate params
      if (schema.params) {
        const {error, value} = schema.params.validate(req.params, validationOptions);
        if (error) {
          return sendValidationError(req, res, error, 'params');
        }
        req.params = value;
      }

      next();
    } catch (error) {
      logger.error('[Validation] Middleware error', {requestId: req.requestId, error});
      next(error);
    }
  };
};

/**
 * Send validation error response
 */
const sendValidationError = (req, res, error, source) => {
  const details = error.details.map((detail) => ({
    field: detail.path.join('.'),
    message: detail.message,
    type: detail.type,
  }));

  logger.warn('[Validation] Input validation failed', {
    requestId: req.requestId,
    source,
    details,
  });

  return res.status(400).json({
    ok: false,
    requestId: req.requestId,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input data',
      retryable: false,
      details: {
        source,
        errors: details,
      },
    },
  });
};

/**
 * Common validation schemas
 */

// MongoDB ObjectId
const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

// Pagination
const paginationSchema = {
  limit: Joi.number().integer().min(1).max(100).default(20),
  cursor: Joi.string().optional(),
  offset: Joi.number().integer().min(0).default(0),
};

// Date
const dateSchema = Joi.date().iso();

// Phone (simple)
const phoneSchema = Joi.string().regex(/^[0-9]{10,15}$/);

module.exports = {
  validate,
  objectIdSchema,
  paginationSchema,
  dateSchema,
  phoneSchema,
};
