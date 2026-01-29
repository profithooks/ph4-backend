/**
 * DEV Push Notification Test Controller
 * 
 * Secure endpoint for testing push notifications from live backend (Render)
 * Requires authentication + DEV_PUSH_KEY header
 */
const asyncHandler = require('express-async-handler');
const Device = require('../models/Device');
const { sendToTokens } = require('../services/push/fcmClient');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Test push notification endpoint
 * POST /api/v1/dev/push/test
 * 
 * Security:
 * - Requires JWT authentication (protect middleware)
 * - Requires X-DEV-PUSH-KEY header matching DEV_PUSH_KEY env var
 * 
 * Request body (all optional):
 * {
 *   title: "ProfitHooks Live Test",
 *   body: "Sent from Render backend",
 *   data: { type: "test" },
 *   maxTokens: 3
 * }
 * 
 * Response:
 * {
 *   ok: true,
 *   requestId: "...",
 *   selected: [{ tokenPrefix, platform, deviceName }],
 *   results: {
 *     successCount: 2,
 *     failureCount: 1,
 *     failures: [{ tokenPrefix, errorCode, errorMessage }]
 *   }
 * }
 */
exports.testPushNotification = asyncHandler(async (req, res) => {
  const requestId = req.id || uuidv4();
  const userId = req.user._id;
  const businessId = req.user.businessId;

  // Extract request params
  const {
    title = 'ProfitHooks Live Test',
    body = 'Sent from Render backend',
    data = { type: 'test' },
    maxTokens = 3,
  } = req.body;

  logger.info('[DevPush] Test push notification request', {
    requestId,
    userId,
    businessId,
    maxTokens,
  });

  // Validate maxTokens
  const tokensLimit = Math.min(Math.max(1, parseInt(maxTokens) || 3), 10); // Cap at 10

  try {
    // Find devices with FCM tokens for this user/business
    const devices = await Device.find({
      $or: [
        { userId },
        { businessId },
      ],
      fcmToken: { $ne: null, $exists: true },
      status: 'TRUSTED', // Only send to trusted devices
    })
      .sort({ fcmTokenUpdatedAt: -1, lastSeenAt: -1 }) // Most recent first
      .limit(tokensLimit)
      .lean();

    if (devices.length === 0) {
      logger.warn('[DevPush] No FCM tokens found', {
        requestId,
        userId,
        businessId,
      });

      return res.status(200).json({
        ok: true,
        requestId,
        message: 'No FCM tokens found for this user/business',
        selected: [],
        results: {
          successCount: 0,
          failureCount: 0,
          failures: [],
        },
      });
    }

    // Extract tokens and metadata
    const tokens = devices.map(d => d.fcmToken);
    const selected = devices.map(d => ({
      tokenPrefix: d.fcmToken.substring(0, 20) + '...',
      platform: d.platform || 'unknown',
      deviceName: d.deviceName || 'Unknown Device',
      lastSeen: d.lastSeenAt,
    }));

    logger.info('[DevPush] Sending to tokens', {
      requestId,
      tokenCount: tokens.length,
      platforms: selected.map(s => s.platform),
    });

    // Send push notification via FCM
    const fcmResult = await sendToTokens({
      tokens,
      title,
      body,
      data: {
        ...data,
        requestId, // Include requestId for tracking
      },
    });

    // Format failures (never log full tokens)
    const failures = fcmResult.responses
      .filter(r => !r.success)
      .map(r => ({
        tokenPrefix: r.token.substring(0, 20) + '...',
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        shouldRemoveToken: r.shouldRemoveToken,
      }));

    logger.info('[DevPush] Push notification test completed', {
      requestId,
      successCount: fcmResult.successCount,
      failureCount: fcmResult.failureCount,
    });

    // Return result
    return res.status(200).json({
      ok: true,
      requestId,
      selected,
      results: {
        successCount: fcmResult.successCount,
        failureCount: fcmResult.failureCount,
        failures,
      },
    });
  } catch (error) {
    logger.error('[DevPush] Error testing push notification', {
      requestId,
      userId,
      businessId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: 'Failed to test push notification',
      message: error.message,
    });
  }
});

/**
 * Broadcast push notification to ALL devices (Admin only)
 * POST /api/v1/dev/push/broadcast
 * 
 * Sends to ALL devices with FCM tokens (not just authenticated user)
 */
exports.broadcastPushNotification = asyncHandler(async (req, res) => {
  const requestId = req.id || uuidv4();
  const adminUserId = req.user._id;

  const {
    title = 'ProfitHooks Broadcast',
    body = 'Broadcast notification from backend',
    data = { type: 'broadcast' },
    maxTokens = 100,
    onlyTrusted = true,
  } = req.body;

  logger.info('[DevPush] Broadcast push notification request', {
    requestId,
    adminUserId,
    maxTokens,
    onlyTrusted,
  });

  try {
    const query = {
      fcmToken: { $ne: null, $exists: true },
    };

    if (onlyTrusted) {
      query.status = 'TRUSTED';
    }

    const devices = await Device.find(query)
      .sort({ fcmTokenUpdatedAt: -1, lastSeenAt: -1 })
      .limit(Math.min(parseInt(maxTokens) || 100, 500))
      .lean();

    if (devices.length === 0) {
      logger.warn('[DevPush] No FCM tokens found for broadcast', { requestId });
      return res.status(200).json({
        ok: true,
        requestId,
        message: 'No FCM tokens found in database',
        selected: [],
        results: { successCount: 0, failureCount: 0, failures: [] },
      });
    }

    const tokens = devices.map(d => d.fcmToken);
    const selected = devices.map(d => ({
      tokenPrefix: d.fcmToken.substring(0, 20) + '...',
      platform: d.platform || 'unknown',
      deviceName: d.deviceName || 'Unknown Device',
      status: d.status,
      lastSeen: d.lastSeenAt,
    }));

    logger.info('[DevPush] Broadcasting to tokens', {
      requestId,
      tokenCount: tokens.length,
    });

    const fcmResult = await sendToTokens({
      tokens,
      title,
      body,
      data: { ...data, requestId, broadcast: 'true' },
    });

    const failures = fcmResult.responses
      .filter(r => !r.success)
      .map(r => ({
        tokenPrefix: r.token.substring(0, 20) + '...',
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
      }));

    logger.info('[DevPush] Broadcast completed', {
      requestId,
      totalDevices: devices.length,
      successCount: fcmResult.successCount,
      failureCount: fcmResult.failureCount,
    });

    return res.status(200).json({
      ok: true,
      requestId,
      broadcast: true,
      selected,
      results: {
        successCount: fcmResult.successCount,
        failureCount: fcmResult.failureCount,
        failures,
      },
    });
  } catch (error) {
    logger.error('[DevPush] Error broadcasting', {
      requestId,
      error: error.message,
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: 'Failed to broadcast push notification',
      message: error.message,
    });
  }
});
