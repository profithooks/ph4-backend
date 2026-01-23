/**
 * Ops Controller - Internal Operations & Manual Overrides
 * 
 * SECURITY: These endpoints are for internal use only.
 * - Non-production: Open for testing
 * - Production: Requires ADMIN_SECRET header
 */

const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Subscription = require('../models/Subscription');

/**
 * Manually activate Pro plan for a user
 * 
 * POST /ops/users/:id/activate-pro
 * 
 * @route   POST /ops/users/:id/activate-pro
 * @access  Private (Admin only in production)
 * @desc    Manually upgrade user to Pro (for support/testing)
 * 
 * Use cases:
 * - Testing Pro features
 * - Comp accounts
 * - Payment issues (manual resolution)
 */
const activateProManually = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const { durationDays = 30, reason = 'manual_activation' } = req.body;
  
  console.log(`[Ops] Manual Pro activation requested for user ${userId}`);
  
  // Find user
  const user = await User.findById(userId);
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found',
    });
  }
  
  // Check if already Pro
  if (user.planStatus === 'pro') {
    console.log(`[Ops] User ${userId} is already Pro`);
    
    // Find active subscription
    const existingSub = await Subscription.findActiveByUserId(userId);
    
    return res.status(200).json({
      success: true,
      message: 'User is already Pro',
      user: {
        id: user._id,
        planStatus: user.planStatus,
        planActivatedAt: user.planActivatedAt,
      },
      subscription: existingSub ? {
        id: existingSub._id,
        expiresAt: existingSub.expiresAt,
      } : null,
    });
  }
  
  try {
    // Activate Pro
    user.planStatus = 'pro';
    user.planActivatedAt = new Date();
    await user.save();
    
    console.log(`[Ops] User ${userId} upgraded to Pro (manual)`);
    
    // Create subscription record
    const subscription = await Subscription.create({
      userId: user._id,
      planId: 'ph4_pro_monthly',
      provider: 'manual', // Special provider for manual activations
      status: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
      providerPaymentId: `manual_${Date.now()}`,
      providerOrderId: `manual_${user._id}`,
      amountPaid: 0, // Manual activation - no payment
      currency: 'INR',
      metadata: {
        activatedBy: 'manual',
        reason,
        timestamp: new Date().toISOString(),
      },
    });
    
    console.log(`[Ops] Manual subscription created: ${subscription._id}`);
    
    return res.status(200).json({
      success: true,
      message: 'Pro plan activated manually',
      user: {
        id: user._id,
        email: user.email,
        mobile: user.mobile,
        planStatus: user.planStatus,
        planActivatedAt: user.planActivatedAt,
      },
      subscription: {
        id: subscription._id,
        expiresAt: subscription.expiresAt,
        durationDays,
      },
    });
  } catch (error) {
    console.error('[Ops] Error activating Pro manually:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to activate Pro',
      error: error.message,
    });
  }
});

/**
 * Get user entitlement details (for debugging)
 * 
 * GET /ops/users/:id/entitlement
 * 
 * @route   GET /ops/users/:id/entitlement
 * @access  Private (Admin only in production)
 * @desc    Get detailed entitlement info for debugging
 */
const getUserEntitlement = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  
  const user = await User.findById(userId);
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found',
    });
  }
  
  // Ensure daily counter is fresh
  await user.ensureDailyWriteCounter();
  
  // Find active subscription
  const subscription = await Subscription.findActiveByUserId(userId);
  
  return res.status(200).json({
    success: true,
    user: {
      id: user._id,
      email: user.email,
      mobile: user.mobile,
      planStatus: user.planStatus,
      trialEndsAt: user.trialEndsAt,
      planActivatedAt: user.planActivatedAt,
      dailyWriteCount: user.dailyWriteCount,
      dailyWriteDate: user.dailyWriteDate,
    },
    subscription: subscription ? {
      id: subscription._id,
      provider: subscription.provider,
      status: subscription.status,
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
      providerPaymentId: subscription.providerPaymentId,
    } : null,
  });
});

/**
 * Send test push notification
 * 
 * @route   POST /ops/users/:id/test-push
 * @access  Admin (X-Admin-Secret required in production)
 * @body    { kind?: string, title?: string, body?: string }
 * @desc    Send a test push notification to user's devices
 */
const logger = require('../utils/logger');

const sendTestPush = async (req, res) => {
  try {
    const {id: userId} = req.params;
    const {kind = 'DAILY_SUMMARY', title, body} = req.body;

    const User = require('../models/User');
    const Device = require('../models/Device');
    const {createNotification} = require('../services/notificationService');
    const {isFirebaseConfigured} = require('../config/firebase');

    // Check Firebase
    if (!isFirebaseConfigured()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FIREBASE_NOT_CONFIGURED',
          message: 'Firebase is not configured. Cannot send push notifications.',
        },
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
    }

    // Check for devices with FCM tokens
    const devices = await Device.find({
      userId: user._id,
      status: 'TRUSTED',
      fcmToken: {$ne: null, $exists: true},
    }).lean();

    if (devices.length === 0) {
      // Show all devices for debugging
      const allDevices = await Device.find({userId: user._id}).lean();
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_DEVICES',
          message: 'No trusted devices with FCM tokens found',
          devices: allDevices.map(d => ({
            deviceName: d.deviceName,
            platform: d.platform,
            status: d.status,
            hasFcmToken: !!d.fcmToken,
            deviceId: d.deviceId,
          })),
        },
      });
    }

    // Create notification
    const notificationTitle = title || `Test Notification (${kind})`;
    const notificationBody = body || `This is a test push notification for ${user.name}`;

    const result = await createNotification({
      userId: user._id,
      businessId: user.businessId || user._id,
      kind,
      title: notificationTitle,
      body: notificationBody,
      channels: ['IN_APP', 'PUSH'],
      metadata: {
        kind,
        entityType: 'system',
        entityId: 'test',
        customerId: null,
        billId: null,
        occurredAt: new Date().toISOString(),
        idempotencyKey: `TEST_${Date.now()}`,
        deeplink: 'ph4://today',
      },
      idempotencyKey: `TEST_${Date.now()}`,
    });

    // The notification delivery worker will pick this up and send it
    // But we can also trigger immediate delivery for testing
    const {runWorker} = require('../workers/notificationDelivery.worker');
    const workerStats = await runWorker();

    res.status(200).json({
      success: true,
      data: {
        notificationId: result.notification._id,
        notificationKind: kind,
        title: notificationTitle,
        body: notificationBody,
        devicesFound: devices.length,
        devices: devices.map(d => ({
          deviceName: d.deviceName,
          platform: d.platform,
          deviceId: d.deviceId,
        })),
        attemptsCreated: result.attempts.length,
        workerStats: {
          processed: workerStats.processed,
          succeeded: workerStats.succeeded,
          failed: workerStats.failed,
        },
        message: 'Test notification created. Check device within a few seconds.',
      },
    });
  } catch (error) {
    logger.error('[Ops] Test push failed', {
      error: error.message,
      userId: req.params.id,
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    });
  }
};

module.exports = {
  activateProManually,
  getUserEntitlement,
  sendTestPush,
};
