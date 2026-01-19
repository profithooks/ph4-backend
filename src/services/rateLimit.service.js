/**
 * Rate Limiting Service for OTP operations
 * Mongo-based rate limiting with audit trail
 */
const OtpAttempt = require('../models/OtpAttempt');
const AppError = require('../utils/AppError');

// Default limits (can be overridden by env vars)
const OTP_REQUEST_LIMIT = parseInt(process.env.OTP_REQUEST_LIMIT) || 5;
const OTP_REQUEST_WINDOW_MIN = parseInt(process.env.OTP_REQUEST_WINDOW_MIN) || 15;
const OTP_VERIFY_LIMIT = parseInt(process.env.OTP_VERIFY_LIMIT) || 5;
const OTP_VERIFY_WINDOW_MIN = parseInt(process.env.OTP_VERIFY_WINDOW_MIN) || 15;

/**
 * Assert that OTP request is allowed (rate limit check)
 * @param {string} phoneE164 - Phone number in E.164 format
 * @param {string} ip - Client IP address
 * @throws {AppError} - 429 if rate limit exceeded
 */
const assertOtpRequestAllowed = async (phoneE164, ip) => {
  const count = await OtpAttempt.countRecent({
    phoneE164,
    ip,
    type: 'REQUEST',
    windowMinutes: OTP_REQUEST_WINDOW_MIN,
  });

  if (count >= OTP_REQUEST_LIMIT) {
    console.warn(
      `[RateLimit] OTP request limit exceeded for ${phoneE164?.slice(
        0,
        6
      )}*** from IP ${ip}`
    );

    // Log the rate limit hit
    await OtpAttempt.logAttempt({
      phoneE164,
      ip,
      type: 'REQUEST',
      ok: false,
      reason: 'RATE_LIMIT',
      meta: {
        attemptCount: count,
        limit: OTP_REQUEST_LIMIT,
        windowMinutes: OTP_REQUEST_WINDOW_MIN,
      },
    });

    throw new AppError(
      `Too many OTP requests. Please try again after ${OTP_REQUEST_WINDOW_MIN} minutes.`,
      429,
      'RATE_LIMIT_EXCEEDED'
    );
  }

  console.log(
    `[RateLimit] OTP request allowed: ${count + 1}/${OTP_REQUEST_LIMIT} in ${OTP_REQUEST_WINDOW_MIN}min window`
  );
};

/**
 * Assert that OTP verification is allowed (rate limit check)
 * @param {string} phoneE164 - Phone number in E.164 format
 * @param {string} ip - Client IP address
 * @throws {AppError} - 429 if rate limit exceeded
 */
const assertOtpVerifyAllowed = async (phoneE164, ip) => {
  const count = await OtpAttempt.countRecent({
    phoneE164,
    ip,
    type: 'VERIFY',
    windowMinutes: OTP_VERIFY_WINDOW_MIN,
  });

  if (count >= OTP_VERIFY_LIMIT) {
    console.warn(
      `[RateLimit] OTP verify limit exceeded for ${phoneE164?.slice(
        0,
        6
      )}*** from IP ${ip}`
    );

    // Log the rate limit hit
    await OtpAttempt.logAttempt({
      phoneE164,
      ip,
      type: 'VERIFY',
      ok: false,
      reason: 'RATE_LIMIT',
      meta: {
        attemptCount: count,
        limit: OTP_VERIFY_LIMIT,
        windowMinutes: OTP_VERIFY_WINDOW_MIN,
      },
    });

    throw new AppError(
      `Too many OTP verification attempts. Please try again after ${OTP_VERIFY_WINDOW_MIN} minutes.`,
      429,
      'RATE_LIMIT_EXCEEDED'
    );
  }

  console.log(
    `[RateLimit] OTP verify allowed: ${count + 1}/${OTP_VERIFY_LIMIT} in ${OTP_VERIFY_WINDOW_MIN}min window`
  );
};

/**
 * Get current rate limit status (for debugging/monitoring)
 * @param {string} phoneE164
 * @param {string} ip
 * @returns {Object} - { request: { count, limit }, verify: { count, limit } }
 */
const getRateLimitStatus = async (phoneE164, ip) => {
  const [requestCount, verifyCount] = await Promise.all([
    OtpAttempt.countRecent({
      phoneE164,
      ip,
      type: 'REQUEST',
      windowMinutes: OTP_REQUEST_WINDOW_MIN,
    }),
    OtpAttempt.countRecent({
      phoneE164,
      ip,
      type: 'VERIFY',
      windowMinutes: OTP_VERIFY_WINDOW_MIN,
    }),
  ]);

  return {
    request: {
      count: requestCount,
      limit: OTP_REQUEST_LIMIT,
      windowMinutes: OTP_REQUEST_WINDOW_MIN,
      remaining: Math.max(0, OTP_REQUEST_LIMIT - requestCount),
    },
    verify: {
      count: verifyCount,
      limit: OTP_VERIFY_LIMIT,
      windowMinutes: OTP_VERIFY_WINDOW_MIN,
      remaining: Math.max(0, OTP_VERIFY_LIMIT - verifyCount),
    },
  };
};

module.exports = {
  assertOtpRequestAllowed,
  assertOtpVerifyAllowed,
  getRateLimitStatus,
};
