/**
 * Idempotency Middleware
 * 
 * Prevents duplicate processing of mutations by storing and replaying responses
 * Critical for offline-first sync where operations may be retried
 */
const IdempotencyKey = require('../models/IdempotencyKey');
const logger = require('../utils/logger');

/**
 * Hash a request for debugging (simple hash)
 */
const hashRequest = (method, path, body) => {
  const str = JSON.stringify({method, path, body: body || null});
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

/**
 * Idempotency middleware
 * 
 * Usage: app.use(idempotencyMiddleware)
 * Or on specific routes: router.post('/bills', idempotencyMiddleware, createBill)
 */
const idempotencyMiddleware = async (req, res, next) => {
  // Only apply to mutations (POST/PUT/PATCH/DELETE)
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  
  if (!isMutation) {
    return next();
  }
  
  // Get idempotency key from header
  const idempotencyKey =
    req.headers['x-idempotency-key'] ||
    req.headers['idempotency-key'];
  
  // If no key, proceed normally
  if (!idempotencyKey) {
    return next();
  }
  
  try {
    // Check if this key has been seen before
    const existing = await IdempotencyKey.findOne({key: idempotencyKey});
    
    if (existing) {
      // Idempotent request - return stored response
      logger.info('Idempotent request detected', {
        key: idempotencyKey,
        method: req.method,
        path: req.path,
        userId: req.user?.id || req.user?._id,
        storedStatus: existing.responseStatus,
      });
      
      // Return the stored response with same status code
      return res.status(existing.responseStatus).json(existing.responseBody);
    }
    
    // New idempotency key - proceed with request
    // But capture the response to store it
    
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);
    
    let capturedStatus = 200;
    let capturedBody = null;
    
    // Override res.status to capture status code
    res.status = function (code) {
      capturedStatus = code;
      return originalStatus(code);
    };
    
    // Override res.json to capture response body
    res.json = async function (body) {
      capturedBody = body;
      
      // Store idempotency record (fire and forget to avoid blocking response)
      storeIdempotencyRecord({
        key: idempotencyKey,
        userId: req.user?._id || req.user?.id,
        businessId: req.user?.businessId,
        method: req.method,
        path: req.path,
        requestHash: hashRequest(req.method, req.path, req.body),
        responseStatus: capturedStatus,
        responseBody: body,
        wasSuccessful: capturedStatus >= 200 && capturedStatus < 300,
      });
      
      // Send response normally
      return originalJson(body);
    };
    
    next();
  } catch (error) {
    logger.error('Idempotency middleware error', error);
    // Don't block request on idempotency errors
    next();
  }
};

/**
 * Store idempotency record (async, fire-and-forget)
 */
const storeIdempotencyRecord = async record => {
  try {
    // Cap responseBody size to prevent bloat (e.g., 100KB)
    const MAX_BODY_SIZE = 100 * 1024;
    let bodyToStore = record.responseBody;
    
    const bodyStr = JSON.stringify(bodyToStore);
    if (bodyStr.length > MAX_BODY_SIZE) {
      // Truncate large responses
      bodyToStore = {
        _truncated: true,
        _originalSize: bodyStr.length,
        ok: bodyToStore.ok,
        requestId: bodyToStore.requestId,
        error: bodyToStore.error,
        data: bodyToStore.data ? {_truncated: true} : undefined,
      };
    }
    
    await IdempotencyKey.create({
      ...record,
      responseBody: bodyToStore,
    });
    
    logger.debug('Stored idempotency record', {
      key: record.key,
      status: record.responseStatus,
    });
  } catch (error) {
    // Log but don't throw - storing idempotency is best-effort
    logger.error('Failed to store idempotency record', error, {
      key: record.key,
    });
  }
};

module.exports = idempotencyMiddleware;
