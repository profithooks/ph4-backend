/**
 * OTP Authentication Controller
 * Handles OTP-based login/signup via MSG91 (or other providers)
 */
const asyncHandler = require('express-async-handler');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OtpAttempt = require('../models/OtpAttempt');
const { normalizeE164, isValidE164, maskPhone } = require('../utils/phone');
const { assertOtpRequestAllowed, assertOtpVerifyAllowed } = require('../services/rateLimit.service');
const otpService = require('../services/otp/otp.service');
const { jwtSecret, jwtExpire } = require('../config/env');
const AppError = require('../utils/AppError');

// Generate JWT token (same as existing auth)
const generateToken = (id) => {
  return jwt.sign({ id }, jwtSecret, {
    expiresIn: jwtExpire,
  });
};

// Extract client IP from request
const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    'unknown'
  );
};

// @desc    Request OTP (send OTP to phone)
// @route   POST /api/auth/otp/request
// @access  Public
const requestOtp = asyncHandler(async (req, res) => {
  const { countryCode, phone } = req.body;

  // Validate input
  if (!countryCode || !phone) {
    throw new AppError(
      'Please provide countryCode and phone',
      400,
      'MISSING_FIELDS'
    );
  }

  // Normalize to E.164
  let phoneE164;
  try {
    phoneE164 = normalizeE164({ countryCode, phone });
  } catch (error) {
    throw new AppError(
      `Invalid phone format: ${error.message}`,
      400,
      'INVALID_PHONE'
    );
  }

  // Validate E.164 format
  if (!isValidE164(phoneE164)) {
    throw new AppError('Invalid phone number format', 400, 'INVALID_PHONE');
  }

  // Get client info for rate limiting and audit
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  const requestId = req.headers['x-request-id'] || 'no-request-id';

  console.log(`[OTP Request] ${maskPhone(phoneE164)} from IP ${ip}`);

  // Rate limit check
  await assertOtpRequestAllowed(phoneE164, ip);

  // Send OTP via provider
  const result = await otpService.sendOtp({ phoneE164 });

  // Log attempt (audit trail)
  await OtpAttempt.logAttempt({
    phoneE164,
    type: 'REQUEST',
    ok: result.ok,
    reason: result.ok ? 'SUCCESS' : (result.error || 'PROVIDER_FAIL'),
    ip,
    userAgent,
    meta: {
      provider: result.provider,
      providerRequestId: result.providerRequestId,
      requestId,
      ...result.raw,
    },
  });

  // Return response
  if (result.ok) {
    console.log(`[OTP Request] SUCCESS for ${maskPhone(phoneE164)}`);
    res.status(200).json({
      success: true,
      phoneE164Masked: maskPhone(phoneE164),
      message: 'OTP sent successfully',
    });
  } else {
    console.error(`[OTP Request] FAILED for ${maskPhone(phoneE164)}:`, result.error);
    throw new AppError(
      'Failed to send OTP. Please try again.',
      502,
      'OTP_SEND_FAILED'
    );
  }
});

// @desc    Verify OTP and login/signup
// @route   POST /api/auth/otp/verify
// @access  Public
const verifyOtp = asyncHandler(async (req, res) => {
  const { countryCode, phone, otp } = req.body;

  // Validate input
  if (!countryCode || !phone || !otp) {
    throw new AppError(
      'Please provide countryCode, phone, and otp',
      400,
      'MISSING_FIELDS'
    );
  }

  // Normalize to E.164
  let phoneE164;
  try {
    phoneE164 = normalizeE164({ countryCode, phone });
  } catch (error) {
    throw new AppError(
      `Invalid phone format: ${error.message}`,
      400,
      'INVALID_PHONE'
    );
  }

  // Validate E.164 format
  if (!isValidE164(phoneE164)) {
    throw new AppError('Invalid phone number format', 400, 'INVALID_PHONE');
  }

  // Validate OTP format (6 digits)
  if (!/^\d{4,6}$/.test(otp)) {
    throw new AppError('Invalid OTP format', 400, 'INVALID_OTP_FORMAT');
  }

  // Get client info
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  const requestId = req.headers['x-request-id'] || 'no-request-id';

  console.log(`[OTP Verify] ${maskPhone(phoneE164)} from IP ${ip}`);

  // Rate limit check
  await assertOtpVerifyAllowed(phoneE164, ip);

  // Verify OTP via provider
  const result = await otpService.verifyOtp({ phoneE164, otp });

  // Log attempt (audit trail)
  await OtpAttempt.logAttempt({
    phoneE164,
    type: 'VERIFY',
    ok: result.ok,
    reason: result.ok ? 'SUCCESS' : (result.error || 'INVALID_OTP'),
    ip,
    userAgent,
    meta: {
      provider: result.provider,
      requestId,
      ...result.raw,
    },
  });

  // If verification failed
  if (!result.ok) {
    console.warn(`[OTP Verify] FAILED for ${maskPhone(phoneE164)}:`, result.error);
    throw new AppError(
      result.error || 'Invalid OTP',
      401,
      'INVALID_OTP'
    );
  }

  console.log(`[OTP Verify] SUCCESS for ${maskPhone(phoneE164)}`);

  // OTP verified! Now find or create user
  let user = await User.findOne({ phoneE164 });

  if (!user) {
    // User doesn't exist - create new user (signup via OTP)
    console.log(`[OTP Verify] Creating new user for ${maskPhone(phoneE164)}`);
    
    // Extract phone number for display (without country code)
    const phoneDisplay = phone.replace(/\D/g, '');
    
    user = await User.create({
      phoneE164,
      phone: phoneDisplay,
      phoneVerified: true,
      name: phoneDisplay, // Default name to phone number
      email: `${phoneDisplay}@ph4.temp`, // Temporary email (can be updated later)
    });
  } else {
    // Existing user - mark phone as verified
    if (!user.phoneVerified) {
      user.phoneVerified = true;
      await user.save();
    }
    console.log(`[OTP Verify] Existing user logged in: ${maskPhone(phoneE164)}`);
  }

  // Generate JWT token
  const token = generateToken(user._id);

  // Return success with token and user info
  res.status(200).json({
    success: true,
    message: 'Login successful',
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      phoneE164: user.phoneE164,
      phoneVerified: user.phoneVerified,
    },
  });
});

module.exports = {
  requestOtp,
  verifyOtp,
};
