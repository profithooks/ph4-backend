/**
 * Error handling middleware - Production hardened
 * 
 * SECURITY: Never leaks stack traces or internal paths to clients in production
 */
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Central error handler
 * 
 * @param {Error} err - The error object
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Server Error';
  let code = err.code || 'SERVER_ERROR';
  let errors = err.errors || undefined;

  // Log error server-side with full details
  logger.error('Request error', err, {
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    requestId: req.id,
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

  // Build response object
  const response = {
    success: false,
    error: message,
    code,
  };

  // Add validation errors if present
  if (errors && errors.length > 0) {
    response.errors = errors;
  }

  // CRITICAL: Never send stack traces or internal details to client in production
  if (isDevelopment) {
    // Development: Include helpful debugging info
    response.stack = err.stack;
    response.originalError = err.message;
    if (err.path) response.path = err.path;
    if (err.value) response.value = err.value;
  } else {
    // Production: Generic message for 500 errors to avoid leaking internals
    if (statusCode === 500) {
      response.error = 'Internal server error';
      response.code = 'INTERNAL_ERROR';
      // Remove any error details that might leak sensitive info
      delete response.errors;
    }
  }

  // Send response
  res.status(statusCode).json(response);
};

module.exports = errorHandler;
