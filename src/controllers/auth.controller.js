/**
 * Auth controller
 */
const asyncHandler = require('express-async-handler');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {jwtSecret, jwtExpire} = require('../config/env');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// Generate JWT token
const generateToken = id => {
  return jwt.sign({id}, jwtSecret, {
    expiresIn: jwtExpire,
  });
};

// @desc    Register user
// @route   POST /api/auth/signup
// @access  Public
const signup = asyncHandler(async (req, res) => {
  const {name, email, phone, password} = req.body;

  if (!name || !email || !password) {
    throw new AppError(
      'Please provide name, email/phone and password',
      400,
      'MISSING_FIELDS',
    );
  }

  // Check if input is email or phone
  const isEmail = email.includes('@');
  
  // Check for existing user by email OR phone
  const userExists = isEmail 
    ? await User.findOne({email})
    : await User.findOne({$or: [{email}, {phone: email}, {phoneE164: email}]});
    
  if (userExists) {
    throw new AppError('User already exists', 400, 'USER_EXISTS');
  }

  // Create user with email or phone in correct field
  const userData = isEmail 
    ? {name, email, phone, password}
    : {name, email, phone: email, password}; // If not email, treat as phone

  const user = await User.create(userData);

  if (user) {
    logger.info('User registered successfully', {
      userId: user._id,
      email: user.email,
    });

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        token: generateToken(user._id),
      },
    });
  } else {
    throw new AppError('Invalid user data', 400, 'INVALID_USER_DATA');
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const {email, password} = req.body;

  if (!email || !password) {
    throw new AppError(
      'Please provide email/phone and password',
      400,
      'MISSING_CREDENTIALS',
    );
  }

  // Support login with email OR phone number
  // Check if input looks like email (contains @) or phone number
  const isEmail = email.includes('@');
  const query = isEmail 
    ? {email} 
    : {$or: [{email}, {phone: email}, {phoneE164: email}]};

  const user = await User.findOne(query).select('+password');

  if (user && (await user.comparePassword(password))) {
    logger.info('User logged in successfully', {
      userId: user._id,
      email: user.email,
    });

    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        token: generateToken(user._id),
      },
    });
  } else {
    logger.warn('Failed login attempt', {identifier: email});
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }
});

module.exports = {
  signup,
  login,
};
