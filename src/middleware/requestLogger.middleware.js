/**
 * Request Logger Middleware
 * 
 * Structured logging for all requests
 * Step 12: Production Readiness
 */
const logger = require('../utils/logger');

/**
 * Log request and response details
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();

  // Log request start (optional, can be verbose)
  // logger.info('[Request] Start', {
  //   requestId: req.requestId,
  //   method: req.method,
  //   path: req.path,
  //   userId: req.user?._id?.toString(),
  //   businessId: req.user?.businessId?.toString() || req.user?._id?.toString(),
  // });

  // Capture original res.json to log response
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    const durationMs = Date.now() - startTime;

    // Log request completion
    logger.info('[Request] Complete', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      userId: req.user?._id?.toString(),
      businessId: req.user?.businessId?.toString() || req.user?._id?.toString(),
      status: res.statusCode,
      durationMs,
      ok: body?.ok ?? (res.statusCode < 400),
      errorCode: body?.error?.code,
    });

    return originalJson(body);
  };

  next();
};

module.exports = requestLogger;
