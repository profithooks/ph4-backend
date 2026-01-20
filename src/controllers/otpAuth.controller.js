/**
 * OTP Authentication Controller
 * Handles OTP-based login/signup via MSG91 (or other providers)
 */
const asyncHandler = require('express-async-handler');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const OtpAttempt = require('../models/OtpAttempt');
const AuditEvent = require('../models/AuditEvent');
const { normalizeE164, isValidE164, maskPhone } = require('../utils/phone');
const { assertOtpRequestAllowed, assertOtpVerifyAllowed } = require('../services/rateLimit.service');
const otpService = require('../services/otp/otp.service');
const { jwtSecret, jwtExpire } = require('../config/env');
const AppError = require('../utils/AppError');
const { getOrCreateDevice, verifyDeviceTrusted } = require('../services/device.service');

// Generate JWT token (Step 9: include deviceId)
const generateToken = (id, deviceId = null) => {
  const payload = { id };
  if (deviceId) {
    payload.deviceId = deviceId;
  }
  return jwt.sign(payload, jwtSecret, {
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

  // Step 9: Device binding
  const deviceId = req.headers['x-device-id'];
  const deviceName = req.headers['x-device-name'] || 'Unknown Device';
  const platform = req.headers['x-device-platform'] || 'unknown';
  const appVersion = req.headers['x-app-version'];
  
  if (!deviceId) {
    throw new AppError(
      'Device ID required. Please update your app.',
      400,
      'DEVICE_ID_REQUIRED'
    );
  }
  
  // Get or create device
  const device = await getOrCreateDevice({
    userId: user._id,
    businessId: user._id, // For single-user businesses
    deviceId,
    deviceMeta: {
      deviceName,
      platform,
      appVersion,
    },
  });
  
  // Check device status
  if (device.status === 'BLOCKED') {
    throw new AppError(
      'This device has been blocked. Contact support.',
      403,
      'DEVICE_BLOCKED'
    );
  }
  
  if (device.status === 'PENDING') {
    // Device needs approval
    throw new AppError(
      'New device requires owner approval',
      403,
      'DEVICE_APPROVAL_REQUIRED',
      {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        message: 'This device is awaiting approval. Please approve from your trusted device or use account recovery.',
      }
    );
  }
  
  // Device is TRUSTED - generate JWT token with deviceId
  const token = generateToken(user._id, deviceId);

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

// Step 9: Recovery flow

// In-memory rate limiter for recovery attempts
const recoveryAttempts = new Map();
const RECOVERY_RATE_LIMIT = 5; // Max attempts per phone per hour
const RECOVERY_RATE_WINDOW = 60 * 60 * 1000; // 1 hour

const checkRecoveryRateLimit = (phoneE164) => {
  const now = Date.now();
  const key = phoneE164;
  
  if (!recoveryAttempts.has(key)) {
    recoveryAttempts.set(key, [now]);
    return true;
  }
  
  const attempts = recoveryAttempts.get(key).filter(t => now - t < RECOVERY_RATE_WINDOW);
  recoveryAttempts.set(key, attempts);
  
  if (attempts.length >= RECOVERY_RATE_LIMIT) {
    return false;
  }
  
  attempts.push(now);
  recoveryAttempts.set(key, attempts);
  return true;
};

// @desc    Init recovery (check if recovery enabled)
// @route   POST /api/auth/recover/init
// @access  Public
const initRecovery = asyncHandler(async (req, res) => {
  const { countryCode, phone } = req.body;
  
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
  
  // Find user
  const user = await User.findOne({ phoneE164 }).select('+recoveryEnabled +recoveryPinHash');
  
  if (!user) {
    // Don't reveal if user exists
    res.status(200).json({
      success: true,
      recoveryEnabled: false,
      method: 'NONE',
    });
    return;
  }
  
  res.status(200).json({
    success: true,
    recoveryEnabled: user.recoveryEnabled || false,
    method: user.recoveryEnabled ? 'PIN' : 'NONE',
    phoneE164Masked: maskPhone(phoneE164),
  });
});

// @desc    Verify recovery PIN
// @route   POST /api/auth/recover/verify
// @access  Public
const verifyRecoveryPin = asyncHandler(async (req, res) => {
  const { countryCode, phone, recoveryPin } = req.body;
  
  if (!countryCode || !phone || !recoveryPin) {
    throw new AppError(
      'Please provide countryCode, phone, and recoveryPin',
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
  
  // Rate limit check
  if (!checkRecoveryRateLimit(phoneE164)) {
    throw new AppError(
      'Too many recovery attempts. Try again later.',
      429,
      'RATE_LIMIT_EXCEEDED'
    );
  }
  
  // Find user
  const user = await User.findOne({ phoneE164 }).select('+recoveryPinHash');
  
  if (!user || !user.recoveryEnabled || !user.recoveryPinHash) {
    throw new AppError(
      'Recovery not enabled for this account',
      400,
      'RECOVERY_NOT_ENABLED'
    );
  }
  
  // Verify PIN
  const isMatch = await bcrypt.compare(recoveryPin, user.recoveryPinHash);
  
  if (!isMatch) {
    // Log recovery attempt failure
    await AuditEvent.create({
      at: new Date(),
      businessId: user._id,
      actorUserId: user._id,
      actorRole: 'USER',
      action: 'RECOVERY_ATTEMPT',
      entityType: 'USER',
      entityId: user._id,
      metadata: {
        success: false,
        phoneE164Masked: maskPhone(phoneE164),
      },
    }).catch(err => console.warn('[Recovery] Audit event creation failed', err));
    
    throw new AppError(
      'Invalid recovery PIN',
      401,
      'INVALID_RECOVERY_PIN'
    );
  }
  
  // PIN verified - generate one-time recovery token (short TTL)
  const recoveryToken = jwt.sign(
    { userId: user._id, type: 'recovery' },
    jwtSecret,
    { expiresIn: '10m' } // 10 minutes only
  );
  
  // Log successful recovery attempt
  await AuditEvent.create({
    at: new Date(),
    businessId: user._id,
    actorUserId: user._id,
    actorRole: 'USER',
    action: 'RECOVERY_ATTEMPT',
    entityType: 'USER',
    entityId: user._id,
    metadata: {
      success: true,
      phoneE164Masked: maskPhone(phoneE164),
    },
  }).catch(err => console.warn('[Recovery] Audit event creation failed', err));
  
  res.status(200).json({
    success: true,
    recoveryToken,
    message: 'Recovery PIN verified. Use this token to approve your device.',
    expiresIn: '10m',
  });
});

// @desc    Approve device using recovery token
// @route   POST /api/auth/recover/approve-device
// @access  Public (with recovery token)
const approveDeviceWithRecovery = asyncHandler(async (req, res) => {
  const { recoveryToken } = req.body;
  const deviceId = req.headers['x-device-id'];
  const deviceName = req.headers['x-device-name'] || 'Unknown Device';
  const platform = req.headers['x-device-platform'] || 'unknown';
  const appVersion = req.headers['x-app-version'];
  
  if (!recoveryToken) {
    throw new AppError(
      'Recovery token required',
      400,
      'MISSING_RECOVERY_TOKEN'
    );
  }
  
  if (!deviceId) {
    throw new AppError(
      'Device ID required',
      400,
      'DEVICE_ID_REQUIRED'
    );
  }
  
  // Verify recovery token
  let decoded;
  try {
    decoded = jwt.verify(recoveryToken, jwtSecret);
  } catch (error) {
    throw new AppError(
      'Invalid or expired recovery token',
      401,
      'INVALID_RECOVERY_TOKEN'
    );
  }
  
  if (decoded.type !== 'recovery') {
    throw new AppError(
      'Invalid token type',
      401,
      'INVALID_TOKEN_TYPE'
    );
  }
  
  const userId = decoded.userId;
  
  // Get or create device and immediately trust it
  const device = await getOrCreateDevice({
    userId,
    businessId: userId,
    deviceId,
    deviceMeta: {
      deviceName,
      platform,
      appVersion,
    },
  });
  
  // Mark device as TRUSTED
  device.status = 'TRUSTED';
  device.approvedBy = userId; // Self-approved via recovery
  device.approvedAt = new Date();
  await device.save();
  
  // Create audit event
  await AuditEvent.create({
    at: new Date(),
    businessId: userId,
    actorUserId: userId,
    actorRole: 'USER',
    action: 'RECOVERY_SUCCESS',
    entityType: 'DEVICE',
    entityId: device._id,
    metadata: {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      method: 'RECOVERY_PIN',
    },
  }).catch(err => console.warn('[Recovery] Audit event creation failed', err));
  
  // Get user info
  const user = await User.findById(userId);
  
  // Generate auth token with deviceId
  const token = generateToken(user._id, deviceId);
  
  res.status(200).json({
    success: true,
    message: 'Device approved successfully via recovery',
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
  initRecovery,
  verifyRecoveryPin,
  approveDeviceWithRecovery,
};

module.exports = {
  requestOtp,
  verifyOtp,
};
