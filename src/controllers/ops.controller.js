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

module.exports = {
  activateProManually,
  getUserEntitlement,
};
