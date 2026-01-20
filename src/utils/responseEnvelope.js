/**
 * Response Envelope Utilities
 * 
 * Standardizes all API responses with consistent envelope format:
 * Success: { ok: true, requestId, data }
 * Error: { ok: false, requestId, error: { code, message, retryable } }
 */

/**
 * Send success response with standard envelope
 * 
 * @param {Response} res - Express response object
 * @param {*} data - Response data (existing payload)
 * @param {Object} meta - Optional metadata (e.g., pagination, timezone)
 * @param {number} statusCode - HTTP status code (default: 200)
 */
const sendSuccess = (res, data, meta = null, statusCode = 200) => {
  const requestId = res.req?.requestId || 'unknown';
  
  const response = {
    ok: true,
    requestId,
    data,
  };
  
  // Add meta if provided
  if (meta) {
    response.meta = meta;
  }
  
  res.status(statusCode).json(response);
};

/**
 * Send error response with standard envelope
 * (Note: This is primarily handled by error middleware, but provided for completeness)
 * 
 * @param {Response} res - Express response object
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @param {boolean} retryable - Whether error is retryable
 * @param {*} details - Additional error details (optional)
 */
const sendError = (res, code, message, statusCode = 500, retryable = false, details = null) => {
  const requestId = res.req?.requestId || 'unknown';
  
  const response = {
    ok: false,
    requestId,
    error: {
      code,
      message,
      retryable,
    },
  };
  
  if (details) {
    response.error.details = details;
  }
  
  res.status(statusCode).json(response);
};

/**
 * Express middleware to add response envelope helpers to res object
 * 
 * Usage in routes:
 *   res.success(data)
 *   res.success(data, meta)
 *   res.success(data, meta, 201)
 *   res.fail(code, message)
 *   res.fail(code, message, statusCode, retryable, details)
 * 
 * NEW UNIFIED HELPERS (preferred):
 *   res.ok(data, meta?)
 *   res.error(code, message, details?, retryable?)
 */
const responseEnvelopeMiddleware = (req, res, next) => {
  // Add helper methods to response object
  
  // Success helper (supports meta)
  res.success = (data, metaOrStatusCode = null, statusCode = 200) => {
    // Handle overloaded parameters
    // success(data) -> meta=null, status=200
    // success(data, 201) -> meta=null, status=201
    // success(data, {meta}) -> meta={meta}, status=200
    // success(data, {meta}, 201) -> meta={meta}, status=201
    
    let meta = null;
    let status = 200;
    
    if (typeof metaOrStatusCode === 'number') {
      // success(data, 201)
      status = metaOrStatusCode;
    } else if (metaOrStatusCode && typeof metaOrStatusCode === 'object') {
      // success(data, {meta})
      meta = metaOrStatusCode;
      status = statusCode;
    }
    
    sendSuccess(res, data, meta, status);
  };
  
  // NEW: Cleaner ok() helper
  res.ok = (data, meta = null) => {
    sendSuccess(res, data, meta, 200);
  };
  
  // Error helper
  res.fail = (code, message, statusCode = 500, retryable = false, details = null) => {
    sendError(res, code, message, statusCode, retryable, details);
  };
  
  // NEW: Cleaner error() helper (auto-detects status from code)
  res.error = (code, message, details = null, retryable = null) => {
    // Auto-detect status code from error code
    let status = 500;
    let isRetryable = retryable !== null ? retryable : false;
    
    if (code === 'VALIDATION_ERROR' || code === 'INVALID_INPUT') {
      status = 400;
    } else if (code === 'UNAUTHORIZED' || code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED') {
      status = 401;
    } else if (code === 'FORBIDDEN' || code === 'PERMISSION_DENIED') {
      status = 403;
    } else if (code === 'NOT_FOUND') {
      status = 404;
    } else if (code === 'CONFLICT' || code === 'DUPLICATE' || code === 'CREDIT_LIMIT_EXCEEDED') {
      status = 409;
    } else if (code === 'RATE_LIMIT') {
      status = 429;
      isRetryable = true;
    } else if (code.includes('TIMEOUT') || status >= 500) {
      isRetryable = retryable !== null ? retryable : true;
    }
    
    sendError(res, code, message, status, isRetryable, details);
  };
  
  next();
};

module.exports = {
  sendSuccess,
  sendError,
  responseEnvelopeMiddleware,
};
