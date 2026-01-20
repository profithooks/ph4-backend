/**
 * Rate Limiting Middleware
 * 
 * In-memory rate limiting for sensitive endpoints
 * Step 12: Production Readiness
 */
const logger = require('../utils/logger');

// In-memory store: { key: { count, resetAt } }
const limiterStore = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of limiterStore.entries()) {
    if (data.resetAt < now) {
      limiterStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create rate limiter middleware
 * 
 * @param {Object} options - Rate limit options
 * @param {Number} options.maxAttempts - Max attempts per window
 * @param {Number} options.windowMs - Time window in milliseconds
 * @param {String} options.keyPrefix - Prefix for the limiter key
 * @param {Function} options.keyGenerator - Custom key generator (req => key)
 * @returns {Function} Express middleware
 */
const createRateLimiter = (options) => {
  const {
    maxAttempts = 5,
    windowMs = 15 * 60 * 1000, // 15 minutes
    keyPrefix = 'rl',
    keyGenerator = (req) => {
      // Default: limit by IP + userId (if logged in) + endpoint
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const userId = req.user?._id?.toString() || 'anon';
      const endpoint = req.path;
      return `${ip}-${userId}-${endpoint}`;
    },
  } = options;

  return (req, res, next) => {
    try {
      const key = `${keyPrefix}:${keyGenerator(req)}`;
      const now = Date.now();

      let limiterData = limiterStore.get(key);

      // Initialize or reset if window expired
      if (!limiterData || limiterData.resetAt < now) {
        limiterData = {
          count: 0,
          resetAt: now + windowMs,
        };
        limiterStore.set(key, limiterData);
      }

      // Increment count
      limiterData.count += 1;

      // Check limit
      if (limiterData.count > maxAttempts) {
        const retryAfter = Math.ceil((limiterData.resetAt - now) / 1000);

        logger.warn('[RateLimit] Limit exceeded', {
          requestId: req.requestId,
          key: keyPrefix,
          count: limiterData.count,
          maxAttempts,
          retryAfter,
        });

        return res.status(429).json({
          ok: false,
          requestId: req.requestId,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many attempts. Please try again in ${retryAfter} seconds.`,
            retryable: true,
            retryAfter,
            details: {
              maxAttempts,
              windowSeconds: Math.ceil(windowMs / 1000),
            },
          },
        });
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', maxAttempts);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxAttempts - limiterData.count));
      res.setHeader('X-RateLimit-Reset', limiterData.resetAt);

      next();
    } catch (error) {
      logger.error('[RateLimit] Middleware error', error);
      // Fail open: allow request on rate limiter error
      next();
    }
  };
};

/**
 * Pre-configured rate limiters
 */

// OTP requests: 5 attempts per 15 minutes per phone
const otpLimiter = createRateLimiter({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'otp',
  keyGenerator: (req) => {
    const phone = req.body?.phone || 'unknown';
    const ip = req.ip || 'unknown';
    return `${phone}-${ip}`;
  },
});

// OTP verify: 10 attempts per 15 minutes per phone
const otpVerifyLimiter = createRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'otp-verify',
  keyGenerator: (req) => {
    const phone = req.body?.phone || 'unknown';
    const ip = req.ip || 'unknown';
    return `${phone}-${ip}`;
  },
});

// Recovery PIN verify: 5 attempts per hour per phone
const recoveryPinLimiter = createRateLimiter({
  maxAttempts: 5,
  windowMs: 60 * 60 * 1000,
  keyPrefix: 'recovery-pin',
  keyGenerator: (req) => {
    const phone = req.body?.phone || 'unknown';
    const ip = req.ip || 'unknown';
    return `${phone}-${ip}`;
  },
});

// Support ticket creation: 10 tickets per hour per user
const supportTicketLimiter = createRateLimiter({
  maxAttempts: 10,
  windowMs: 60 * 60 * 1000,
  keyPrefix: 'support-ticket',
  keyGenerator: (req) => {
    const userId = req.user?._id?.toString() || 'anon';
    return userId;
  },
});

// Support message: 30 messages per hour per user
const supportMessageLimiter = createRateLimiter({
  maxAttempts: 30,
  windowMs: 60 * 60 * 1000,
  keyPrefix: 'support-msg',
  keyGenerator: (req) => {
    const userId = req.user?._id?.toString() || 'anon';
    return userId;
  },
});

// General API rate limit: 1000 requests per 5 minutes per user
const generalApiLimiter = createRateLimiter({
  maxAttempts: 1000,
  windowMs: 5 * 60 * 1000,
  keyPrefix: 'api',
  keyGenerator: (req) => {
    const userId = req.user?._id?.toString() || 'anon';
    const ip = req.ip || 'unknown';
    return `${userId}-${ip}`;
  },
});

// Auth routes (login/signup): 10 attempts per 15 minutes per IP
const authLimiter = createRateLimiter({
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'auth',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return ip;
  },
});

// Global API rate limiter (for all /api routes)
const globalLimiter = createRateLimiter({
  maxAttempts: 2000,
  windowMs: 5 * 60 * 1000,
  keyPrefix: 'global',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return ip;
  },
});

module.exports = {
  createRateLimiter,
  otpLimiter,
  otpVerifyLimiter,
  recoveryPinLimiter,
  supportTicketLimiter,
  supportMessageLimiter,
  generalApiLimiter,
  authLimiter,
  globalLimiter,
};
