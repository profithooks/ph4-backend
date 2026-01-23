/**
 * Zero-Friction OTP Auth Controller
 * Static OTP = "0000" for now (no SMS provider integration)
 */
const asyncHandler = require('express-async-handler');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OtpSimple = require('../models/OtpSimple');
const {jwtSecret, jwtExpire} = require('../config/env');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// In-memory rate limiter (simple implementation)
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

const checkRateLimit = (key) => {
  const now = Date.now();
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, [now]);
    return true;
  }
  
  const attempts = rateLimitMap.get(key).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (attempts.length >= RATE_LIMIT_MAX) {
    return false;
  }
  
  attempts.push(now);
  rateLimitMap.set(key, attempts);
  return true;
};

// Normalize mobile number (remove spaces, keep only digits)
const normalizeMobile = (mobile) => {
  return mobile.replace(/\s+/g, '').replace(/[^\d]/g, '');
};

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({id}, jwtSecret, {
    expiresIn: jwtExpire, // Short-lived access token
  });
};

// Generate refresh token (longer-lived)
const generateRefreshToken = (id) => {
  return jwt.sign({id, type: 'refresh'}, jwtSecret, {
    expiresIn: '30d', // Long-lived refresh token
  });
};

/**
 * @route   POST /api/v1/auth/otp/request
 * @desc    Request OTP for mobile number
 * @access  Public
 */
exports.requestOtp = asyncHandler(async (req, res) => {
  const {mobile, countryCode = '+91'} = req.body;
  
  // Validate mobile
  if (!mobile) {
    throw new AppError('Mobile number is required', 400, 'MISSING_MOBILE');
  }
  
  const normalizedMobile = normalizeMobile(mobile);
  
  // Validate mobile format (8-13 digits)
  if (!/^\d{8,13}$/.test(normalizedMobile)) {
    throw new AppError('Invalid mobile number format', 400, 'INVALID_MOBILE');
  }
  
  // Rate limit check (IP + mobile)
  const rateLimitKey = `${req.ip || 'unknown'}-${normalizedMobile}`;
  if (!checkRateLimit(rateLimitKey)) {
    throw new AppError(
      'Too many OTP requests. Please try again later.',
      429,
      'RATE_LIMIT_EXCEEDED'
    );
  }
  
  // Create or find user by mobile
  const fullMobile = `${countryCode}${normalizedMobile}`;
  let user = await User.findOne({mobile: normalizedMobile});
  
  if (!user) {
    // Create new user (will be completed after OTP verification)
    user = await User.create({
      mobile: normalizedMobile,
      countryCode,
      phoneE164: fullMobile,
      phoneVerified: false,
    });
    
    logger.info('[OTP] New user created for OTP auth', {
      userId: user._id,
      mobile: normalizedMobile,
    });
  }
  
  // Generate static OTP (for now, always "0000")
  const otp = '0000';
  
  // Store OTP in database
  await OtpSimple.create({
    mobile: normalizedMobile,
    otp,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
  });
  
  logger.info('[OTP] OTP requested', {
    mobile: normalizedMobile,
    userId: user._id,
  });
  
  // In development, return OTP hint
  const response = {
    success: true,
    message: 'OTP sent successfully',
  };
  
  if (process.env.NODE_ENV === 'development' || process.env.SHOW_OTP_HINT === 'true') {
    response.otpHint = otp; // Show OTP in dev mode
  }
  
  res.status(200).json(response);
});

/**
 * @route   POST /api/v1/auth/otp/verify
 * @desc    Verify OTP and issue tokens
 * @access  Public
 */
exports.verifyOtp = asyncHandler(async (req, res) => {
  const {mobile, otp, device} = req.body;
  
  // Validate
  if (!mobile || !otp) {
    throw new AppError('Mobile and OTP are required', 400, 'MISSING_FIELDS');
  }
  
  const normalizedMobile = normalizeMobile(mobile);
  
  // Find OTP record
  const otpRecord = await OtpSimple.findOne({
    mobile: normalizedMobile,
    verified: false,
    expiresAt: {$gt: new Date()},
  }).sort({createdAt: -1});
  
  if (!otpRecord) {
    throw new AppError('Invalid or expired OTP', 400, 'INVALID_OTP');
  }
  
  // Verify OTP (static "0000" for now)
  if (otp !== '0000' && otp !== otpRecord.otp) {
    throw new AppError('Invalid OTP', 400, 'INVALID_OTP');
  }
  
  // Mark OTP as verified
  otpRecord.verified = true;
  await otpRecord.save();
  
  // Find or create user
  let user = await User.findOne({mobile: normalizedMobile});
  
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  
  // Update user as verified
  user.phoneVerified = true;
  await user.save();
  
  // Generate tokens
  const accessToken = generateToken(user._id);
  const refreshToken = generateRefreshToken(user._id);
  
  // Check if businessName is set
  const needsBusinessName = !user.businessName || user.businessName.trim() === '';
  
  logger.info('[OTP] OTP verified successfully', {
    userId: user._id,
    mobile: normalizedMobile,
    needsBusinessName,
  });
  
  res.status(200).json({
    success: true,
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      mobile: user.mobile,
      countryCode: user.countryCode,
      businessName: user.businessName,
      role: user.role,
    },
    needsBusinessName,
  });
});

/**
 * @route   POST /api/v1/auth/mobile/login
 * @desc    Login/Signup with mobile only (skip OTP for now)
 * @access  Public
 */
exports.mobileLogin = asyncHandler(async (req, res) => {
  const {mobile, countryCode = '+91', device} = req.body;
  
  // Validate
  if (!mobile) {
    throw new AppError('Mobile number is required', 400, 'MISSING_MOBILE');
  }
  
  const normalizedMobile = normalizeMobile(mobile);
  
  // Validate mobile format (8-13 digits)
  if (!/^\d{8,13}$/.test(normalizedMobile)) {
    throw new AppError('Invalid mobile number format', 400, 'INVALID_MOBILE');
  }
  
  // Find or create user
  const fullMobile = `${countryCode}${normalizedMobile}`;
  let user = await User.findOne({mobile: normalizedMobile});
  
  if (!user) {
    // Create new user (skip OTP verification for now)
    user = await User.create({
      mobile: normalizedMobile,
      countryCode,
      phoneE164: fullMobile,
      phoneVerified: true, // Mark as verified since we're skipping OTP
    });
    
    logger.info('[MobileLogin] New user created', {
      userId: user._id,
      mobile: normalizedMobile,
    });
  } else {
    // Existing user - mark phone as verified
    if (!user.phoneVerified) {
      user.phoneVerified = true;
      await user.save();
    }
  }
  
  // Generate tokens
  const accessToken = generateToken(user._id);
  const refreshToken = generateRefreshToken(user._id);
  
  // Check if businessName is set
  const needsBusinessName = !user.businessName || user.businessName.trim() === '';
  
  logger.info('[MobileLogin] User logged in', {
    userId: user._id,
    mobile: normalizedMobile,
    needsBusinessName,
  });
  
  res.status(200).json({
    success: true,
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      mobile: user.mobile,
      countryCode: user.countryCode,
      businessName: user.businessName,
      role: user.role,
    },
    needsBusinessName,
  });
});

/**
 * @route   PATCH /api/v1/auth/me/business
 * @desc    Set business name (after OTP auth)
 * @access  Private
 */
exports.setBusinessName = asyncHandler(async (req, res) => {
  const {businessName} = req.body;
  
  // Validate
  if (!businessName || businessName.trim().length < 2) {
    throw new AppError(
      'Business name must be at least 2 characters',
      400,
      'INVALID_BUSINESS_NAME'
    );
  }
  
  if (businessName.length > 60) {
    throw new AppError(
      'Business name must be less than 60 characters',
      400,
      'BUSINESS_NAME_TOO_LONG'
    );
  }
  
  // Update user
  const user = await User.findById(req.user._id);
  
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  
  user.businessName = businessName.trim();
  // Also set name if not set
  if (!user.name) {
    user.name = businessName.trim();
  }
  await user.save();
  
  logger.info('[OTP] Business name set', {
    userId: user._id,
    businessName: user.businessName,
  });
  
  res.status(200).json({
    success: true,
    user: {
      id: user._id,
      mobile: user.mobile,
      businessName: user.businessName,
      name: user.name,
      role: user.role,
    },
  });
});

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
exports.refreshToken = asyncHandler(async (req, res) => {
  const {refreshToken} = req.body;
  
  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400, 'MISSING_REFRESH_TOKEN');
  }
  
  try {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, jwtSecret);
    
    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 401, 'INVALID_TOKEN_TYPE');
    }
    
    // Find user
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    
    // Generate new access token
    const newAccessToken = generateToken(user._id);
    
    logger.debug('[OTP] Token refreshed', {
      userId: user._id,
    });
    
    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      user: {
        id: user._id,
        mobile: user.mobile,
        businessName: user.businessName,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    logger.warn('[OTP] Refresh token verification failed', {
      error: error.message,
    });
    throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }
});
