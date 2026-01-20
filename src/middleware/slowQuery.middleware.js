/**
 * Slow Query Logging Middleware
 * 
 * Logs MongoDB queries that take longer than threshold
 * Enable with SLOW_QUERY_LOG=true (dev/staging only)
 * Step 19: Stability Under Stress
 */
const logger = require('../utils/logger');

const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS, 10) || 200;
const SLOW_QUERY_LOG_ENABLED = process.env.SLOW_QUERY_LOG === 'true';

/**
 * Mongoose plugin to log slow queries
 */
function slowQueryPlugin(schema) {
  if (!SLOW_QUERY_LOG_ENABLED) {
    return; // Disabled
  }

  // Hook into all query operations
  const operations = [
    'count',
    'countDocuments',
    'estimatedDocumentCount',
    'find',
    'findOne',
    'findOneAndDelete',
    'findOneAndRemove',
    'findOneAndReplace',
    'findOneAndUpdate',
    'remove',
    'update',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'aggregate',
  ];

  operations.forEach((op) => {
    schema.pre(op, function() {
      this._startTime = Date.now();
    });

    schema.post(op, function() {
      if (this._startTime) {
        const duration = Date.now() - this._startTime;
        
        if (duration > SLOW_QUERY_THRESHOLD_MS) {
          const modelName = this.model?.modelName || this.constructor?.modelName || 'Unknown';
          const filter = JSON.stringify(this.getFilter?.() || this._conditions || {});
          
          logger.warn('[SlowQuery]', {
            model: modelName,
            operation: op,
            durationMs: duration,
            filter: filter.length > 200 ? filter.substring(0, 200) + '...' : filter,
            threshold: SLOW_QUERY_THRESHOLD_MS,
          });
        }
      }
    });
  });
}

/**
 * Express middleware to attach requestId to queries (optional)
 */
function slowQueryRequestMiddleware(req, res, next) {
  if (SLOW_QUERY_LOG_ENABLED) {
    // Store requestId for potential use in query logging
    req.queryContext = {
      requestId: req.requestId,
      path: req.path,
      method: req.method,
    };
  }
  next();
}

module.exports = {
  slowQueryPlugin,
  slowQueryRequestMiddleware,
  SLOW_QUERY_LOG_ENABLED,
};
