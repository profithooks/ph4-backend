/**
 * DEPRECATED: Console-based request logging middleware
 * 
 * ⚠️  DO NOT USE THIS FILE - Use requestLogger.middleware.js instead
 * 
 * This file uses console.log which is not structured and hard to parse.
 * Standard logger: Winston-based requestLogger.middleware.js
 * 
 * MIGRATION PATH:
 * - Replace: const requestLogger = require('./middleware/request-logger.middleware');
 * - With:    const requestLogger = require('./middleware/requestLogger.middleware');
 * 
 * This file is kept for backward compatibility but should not be used.
 * Only active in NODE_ENV=development for legacy debugging.
 */

const logger = require('../utils/logger');

/**
 * @deprecated Use requestLogger.middleware.js instead
 */
const requestLogger = (req, res, next) => {
  // Only run in development (gated for production safety)
  if (process.env.NODE_ENV === 'production') {
    logger.warn('[DEPRECATED] request-logger.middleware.js used in production - should use requestLogger.middleware.js');
    return next();
  }
  const method = req.method;
  const path = req.path;
  const originalUrl = req.originalUrl;
  const requestId = req.header('X-Request-Id') || 'NO_RID';
  const idempotencyKey = req.header('Idempotency-Key') || 'NO_IDEM';
  const uid = req._reqUid || 'NO_UID';

  const logFinOnly = process.env.LOG_FIN_ONLY === 'true';
  const isHealthPath = originalUrl === '/api/health';
  const isLedgerPath =
    originalUrl.startsWith('/api/ledger/credit') ||
    originalUrl.startsWith('/api/ledger/debit');

  // Log once on request entry (unless LOG_FIN_ONLY mode)
  if (!logFinOnly) {
    console.log(
      `REQ uid=${uid} ${method} ${path} rid=${requestId} idem=${idempotencyKey}`,
    );
  }

  // Log once when response finishes
  res.on('finish', () => {
    if (logFinOnly) {
      // In LOG_FIN_ONLY mode, only log ledger endpoints to reduce noise
      if (isLedgerPath) {
        console.log(
          `FIN uid=${uid} status=${res.statusCode} path=${req.path} rid=${requestId} idem=${idempotencyKey}`,
        );
      }
    } else {
      // Normal mode: log all FIN with path
      console.log(
        `FIN uid=${uid} status=${res.statusCode} path=${req.path} rid=${requestId} idem=${idempotencyKey}`,
      );
    }
  });

  next();
};

module.exports = requestLogger;
