/**
 * Security configuration for production hardening
 */

/**
 * Parse CORS origins from environment
 */
const getCorsOrigins = () => {
  if (process.env.CORS_ORIGINS) {
    return process.env.CORS_ORIGINS.split(',').map(origin => origin.trim());
  }
  // Default dev origins
  return ['http://localhost:19000', 'http://localhost:8081', 'http://localhost:3000'];
};

/**
 * CORS configuration
 */
const corsOptions = {
  origin: getCorsOrigins(),
  credentials: process.env.CORS_CREDENTIALS === 'true',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  maxAge: 86400, // 24 hours
};

/**
 * Rate limit configurations
 */
const rateLimitConfig = {
  global: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // 300 requests per window per IP
    message: {
      success: false,
      message: 'Too many requests, please try again later',
      code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
  },
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 requests per window per IP
    skipSuccessfulRequests: true,
    message: {
      success: false,
      message: 'Too many authentication attempts, please try again later',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
  },
};

/**
 * Body parser limits
 */
const bodyLimits = {
  json: '1mb',
  urlencoded: '1mb',
};

/**
 * Trust proxy setting
 */
const trustProxy = process.env.TRUST_PROXY === 'true';

module.exports = {
  corsOptions,
  rateLimitConfig,
  bodyLimits,
  trustProxy,
};
