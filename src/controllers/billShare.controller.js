const crypto = require('crypto');
const Bill = require('../models/Bill');
const BillShareLink = require('../models/BillShareLink');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {publicAppBaseUrl, nodeEnv} = require('../config/env');

/**
 * Generate public bill URL (points to web frontend viewer)
 * Rules:
 * - Uses PUBLIC_APP_BASE_URL (web frontend domain)
 * - Path: /b/:token (web route, not backend)
 * - In production: PUBLIC_APP_BASE_URL must be set
 * - In dev: defaults to http://localhost:5173
 */
const generatePublicUrl = (token) => {
  try {
    // Validate production requirement
    if (nodeEnv === 'production' && !publicAppBaseUrl) {
      throw new AppError(
        'PUBLIC_APP_BASE_URL must be set in production environment',
        500,
        'MISSING_PUBLIC_APP_BASE_URL'
      );
    }
    
    // Ensure base URL doesn't end with trailing slash
    const base = (publicAppBaseUrl || 'http://localhost:5173').replace(/\/$/, '');
    
    // Validate token
    if (!token || typeof token !== 'string') {
      throw new AppError('Invalid token provided', 500, 'INVALID_TOKEN');
    }
    
    // Return URL pointing to web frontend viewer route
    return `${base}/b/${token}`;
  } catch (error) {
    // Re-throw AppError as-is
    if (error instanceof AppError) {
      throw error;
    }
    // Wrap unexpected errors
    logger.error('[BillShare] generatePublicUrl error', {
      error: error.message,
      stack: error.stack,
      token: token ? token.substring(0, 8) + '...' : 'null',
      nodeEnv,
      hasPublicAppBaseUrl: !!publicAppBaseUrl,
    });
    throw new AppError(
      'Failed to generate share URL',
      500,
      'URL_GENERATION_ERROR'
    );
  }
};

/**
 * Create or get share link for a bill
 * POST /api/bills/:id/share-link
 */
exports.createBillShareLink = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const billId = req.params.id;

    // Validate inputs
    if (!userId) {
      throw new AppError('User not authenticated', 401, 'UNAUTHORIZED');
    }
    if (!billId) {
      throw new AppError('Bill ID is required', 400, 'MISSING_BILL_ID');
    }

    // Load bill and verify ownership
    const bill = await Bill.findOne({_id: billId, userId});
    if (!bill) {
      throw new AppError('Bill not found', 404, 'BILL_NOT_FOUND');
    }

    // Check if active link already exists (idempotent)
    let shareLink = await BillShareLink.findOne({
      userId,
      billId,
      status: 'active',
    });

    if (shareLink) {
      // Return existing link
      const url = generatePublicUrl(shareLink.token);
      return res.success({
        url,
        token: shareLink.token,
      });
    }

    // Create new share link
    let token;
    let attempts = 0;
    const maxAttempts = 5;
    
    // Retry token generation if there's a collision (unlikely but possible)
    while (attempts < maxAttempts) {
      token = crypto.randomBytes(24).toString('hex'); // 48 chars
      
      // Check if token already exists (extremely unlikely but handle it)
      const existing = await BillShareLink.findOne({token});
      if (!existing) {
        break;
      }
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new AppError('Failed to generate unique token', 500, 'TOKEN_GENERATION_FAILED');
    }

    shareLink = await BillShareLink.create({
      userId,
      billId,
      token,
      status: 'active',
    });

    const url = generatePublicUrl(shareLink.token);

    logger.info('[BillShare] Share link created', {
      requestId: req.requestId,
      userId: userId.toString(),
      billId: billId.toString(),
      token: shareLink.token.substring(0, 8) + '...',
      url,
    });

    res.success({
      url,
      token: shareLink.token,
    }, null, 201);
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    
    // Log full error details for debugging
    logger.error('[BillShare] Create link error', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
      userId: req.user?._id?.toString(),
      billId: req.params?.id,
      nodeEnv,
      hasPublicAppBaseUrl: !!publicAppBaseUrl,
    });
    
    // Return generic error to client
    next(new AppError(
      'Failed to create share link. Please try again.',
      500,
      'SHARE_LINK_CREATION_FAILED'
    ));
  }
};

/**
 * Revoke share link for a bill
 * DELETE /api/bills/:id/share-link
 */
exports.revokeBillShareLink = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const billId = req.params.id;

    // Find active link
    const shareLink = await BillShareLink.findOne({
      userId,
      billId,
      status: 'active',
    });

    if (!shareLink) {
      // Already revoked or never existed - return success (idempotent)
      return res.success({
        message: 'Share link already revoked or does not exist',
      });
    }

    // Revoke link
    shareLink.status = 'revoked';
    shareLink.revokedAt = new Date();
    await shareLink.save();

    logger.info('[BillShare] Share link revoked', {
      requestId: req.requestId,
      userId: userId.toString(),
      billId: billId.toString(),
      token: shareLink.token.substring(0, 8) + '...',
    });

    res.success({
      message: 'Share link revoked successfully',
    });
  } catch (error) {
    logger.error('[BillShare] Revoke link error', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};
