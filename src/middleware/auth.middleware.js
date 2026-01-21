/**
 * Authentication middleware
 */
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const {jwtSecret} = require('../config/env');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {checkPlanExpiry} = require('./trialExpiry.middleware');

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    throw new AppError('Not authorized, no token', 401, 'NO_TOKEN');
  }

  try {
    logger.debug('Verifying JWT token', {
      tokenPreview: token.substring(0, 20) + '...',
    });
    
    const decoded = jwt.verify(token, jwtSecret);
    
    logger.debug('Token verified successfully', {
      userId: decoded.id,
    });
    
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Check plan expiry (trial → free, pro → free if subscription expired)
    await checkPlanExpiry(req, res, () => {});

    next();
  } catch (error) {
    logger.warn('Token verification failed', {
      error: error.message,
    });
    throw new AppError('Not authorized, token failed', 401, 'INVALID_TOKEN');
  }
});

module.exports = {protect};
