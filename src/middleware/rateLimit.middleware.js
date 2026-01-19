/**
 * Rate limiting middleware
 */
const rateLimit = require('express-rate-limit');
const {rateLimitConfig} = require('../config/security');

/**
 * Global API rate limiter
 * 300 requests per 15 minutes per IP
 */
const globalLimiter = rateLimit(rateLimitConfig.global);

/**
 * Auth-specific rate limiter
 * 30 requests per 15 minutes per IP
 * Skips successful requests to allow normal usage after successful auth
 */
const authLimiter = rateLimit(rateLimitConfig.auth);

module.exports = {
  globalLimiter,
  authLimiter,
};
