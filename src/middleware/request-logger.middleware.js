/**
 * Request logging middleware
 * Logs every incoming request with fingerprints for tracing
 * Logs once on entry (REQ) and once on finish (FIN)
 *
 * Supports LOG_FIN_ONLY mode for clean test output
 */
const requestLogger = (req, res, next) => {
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
