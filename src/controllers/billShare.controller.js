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
  
  // Return URL pointing to web frontend viewer route
  return `${base}/b/${token}`;
};

/**
 * Create or get share link for a bill
 * POST /api/bills/:id/share-link
 */
exports.createBillShareLink = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const billId = req.params.id;

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
      return res.status(200).json({
        success: true,
        data: {
          url,
          token: shareLink.token,
        },
      });
    }

    // Create new share link
    const token = crypto.randomBytes(24).toString('hex'); // 48 chars

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
    });

    res.status(201).json({
      success: true,
      data: {
        url,
        token: shareLink.token,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    logger.error('[BillShare] Create link error', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    next(error);
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
      return res.status(200).json({
        success: true,
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

    res.status(200).json({
      success: true,
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
