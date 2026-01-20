/**
 * Error handling middleware - Production hardened
 * 
 * SECURITY: Never leaks stack traces or internal paths to clients in production
 * RELIABILITY: Logs all failed mutations to ReliabilityEvent for diagnostics
 */
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const ReliabilityEvent = require('../models/ReliabilityEvent');

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Map HTTP status to error category and retryability
 */
const classifyError = (statusCode, code) => {
  // Determine if error is retryable
  const retryable = statusCode >= 500 || statusCode === 429 || code === 'TIMEOUT';
  
  // Map to standard error codes
  let errorCode = code;
  
  if (statusCode === 400) {
    errorCode = code || 'VALIDATION_ERROR';
  } else if (statusCode === 401 || statusCode === 403) {
    errorCode = code || 'AUTH_ERROR';
  } else if (statusCode === 404) {
    errorCode = 'NOT_FOUND';
  } else if (statusCode === 409) {
    errorCode = 'CONFLICT';
  } else if (statusCode === 429) {
    errorCode = 'RATE_LIMIT';
  } else if (statusCode === 502 || statusCode === 503) {
    errorCode = 'NETWORK_DEPENDENCY';
  } else if (statusCode >= 500) {
    errorCode = 'SERVER_ERROR';
  }
  
  return {code: errorCode, retryable};
};

/**
 * Log ReliabilityEvent for failed mutations
 */
const logReliabilityEvent = async (req, statusCode, code, message, details) => {
  // Only log for mutating operations (POST, PUT, PATCH, DELETE)
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  
  if (!isMutation) {
    return; // Skip logging for read operations
  }
  
  try {
    const {code: errorCode, retryable} = classifyError(statusCode, code);
    
    // Determine event kind based on route
    let kind = 'WRITE_FAIL';
    if (req.path.includes('/followup') || req.path.includes('/recovery')) {
      kind = 'ENGINE_FAIL';
    } else if (req.path.includes('/message')) {
      kind = 'NOTIF_FAIL';
    }
    
    await ReliabilityEvent.create({
      requestId: req.requestId || 'unknown',
      at: new Date(),
      layer: 'backend',
      kind,
      route: req.path,
      method: req.method,
      userId: req.user?._id || req.user?.id,
      businessId: req.user?.businessId,
      code: errorCode,
      message,
      details: isDevelopment ? details : undefined, // Only include details in dev
      retryable,
      status: statusCode,
    });
  } catch (logError) {
    // Don't let logging errors crash the request
    logger.error('Failed to log ReliabilityEvent', logError);
  }
};

/**
 * Central error handler
 * 
 * @param {Error} err - The error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
const errorHandler = async (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Server Error';
  let code = err.code || 'SERVER_ERROR';
  let errors = err.errors || undefined;

  // Log error server-side with full details
  logger.error('Request error', err, {
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    requestId: req.requestId,
    statusCode,
    code,
  });

  // Handle specific error types
  
  // 1. Mongoose CastError (invalid ObjectId format)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid id format';
    code = 'INVALID_ID';
  }

  // 2. Mongoose duplicate key error
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    message = `Duplicate value for ${field}`;
    code = 'DUPLICATE_VALUE';
  }

  // 3. Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    // Extract field-level errors
    errors = Object.values(err.errors || {}).map(e => ({
      field: e.path,
      message: e.message,
    }));
  }

  // 4. JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  }

  // 5. Joi validation errors (already handled by validate middleware, but just in case)
  if (err.isJoi || err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
  }

  // Classify error and determine retryability
  const {code: errorCode, retryable} = classifyError(statusCode, code);
  code = errorCode;

  // Build error details for logging
  const errorDetails = {
    originalCode: err.code,
    statusCode,
    errors,
  };
  
  if (isDevelopment) {
    errorDetails.stack = err.stack;
    errorDetails.path = err.path;
    errorDetails.value = err.value;
  }

  // Log ReliabilityEvent for failed mutations
  await logReliabilityEvent(req, statusCode, code, message, errorDetails);

  // Build standardized response envelope
  const response = {
    ok: false,
    requestId: req.requestId || 'unknown',
    error: {
      code,
      message,
      retryable,
    },
  };

  // Add validation errors if present
  if (errors && errors.length > 0) {
    response.error.details = errors;
  }

  // CRITICAL: Never send stack traces or internal details to client in production
  if (isDevelopment) {
    // Development: Include helpful debugging info
    response.error.stack = err.stack;
    response.error.originalError = err.message;
    if (err.path) response.error.path = err.path;
    if (err.value) response.error.value = err.value;
  } else {
    // Production: Generic message for 500 errors to avoid leaking internals
    if (statusCode === 500) {
      response.error.message = 'Internal server error';
      response.error.code = 'INTERNAL_ERROR';
      // Remove any error details that might leak sensitive info
      delete response.error.details;
    }
  }

  // Send response
  res.status(statusCode).json(response);
};

module.exports = errorHandler;
