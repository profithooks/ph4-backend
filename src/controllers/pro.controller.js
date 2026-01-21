/**
 * Pro plan activation controller
 */
const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const razorpayService = require('../services/razorpay.service');

/**
 * @desc    Activate Pro plan after successful payment
 * @route   POST /api/v1/pro/activate
 * @access  Private
 */
exports.activatePro = asyncHandler(async (req, res, next) => {
  const { providerPaymentId, providerOrderId, providerSignature, planId = 'ph4_pro_monthly' } = req.body;

  // Validate required fields
  if (!providerPaymentId || !providerOrderId) {
    return next(new AppError('Payment ID and Order ID are required', 400));
  }

  const userId = req.user._id;

  // 1. Verify payment signature (if Razorpay secret is available)
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
  
  if (razorpaySecret && providerSignature) {
    const isValid = razorpayService.verifyPaymentSignature(
      providerOrderId,
      providerPaymentId,
      providerSignature,
      razorpaySecret
    );

    if (!isValid) {
      console.error('[Pro] Invalid payment signature for user:', userId);
      return next(new AppError('Invalid payment signature', 400, 'PAYMENT_VERIFICATION_FAILED'));
    }
  } else {
    console.warn('[Pro] Payment signature verification skipped (missing secret or signature)');
  }

  // 2. Check for duplicate payment
  const existingSubscription = await Subscription.findOne({ providerPaymentId });
  if (existingSubscription) {
    console.log('[Pro] Duplicate payment attempt:', providerPaymentId);
    return next(new AppError('This payment has already been processed', 400, 'DUPLICATE_PAYMENT'));
  }

  // 3. Get plan details
  const planDetails = razorpayService.getPlanDetails(planId);

  // 4. Calculate expiry date
  const startedAt = new Date();
  const expiresAt = razorpayService.calculateExpiryDate(planId);

  // 5. Create subscription record
  const subscription = await Subscription.create({
    userId,
    planId,
    provider: 'razorpay',
    status: 'active',
    startedAt,
    expiresAt,
    providerPaymentId,
    providerOrderId,
    providerSignature,
    amountPaid: planDetails.amount,
    currency: planDetails.currency,
    metadata: {
      planName: planDetails.name,
      activatedAt: startedAt.toISOString(),
    },
  });

  console.log('[Pro] Subscription created:', subscription._id, 'for user:', userId);

  // 6. Update user plan status
  req.user.planStatus = 'pro';
  req.user.planActivatedAt = startedAt;
  await req.user.save();

  console.log('[Pro] User upgraded to Pro:', userId);

  // 7. Return updated entitlement
  res.status(200).json({
    success: true,
    message: 'Pro plan activated successfully',
    data: {
      planStatus: req.user.planStatus,
      planActivatedAt: req.user.planActivatedAt,
      subscriptionId: subscription._id,
      expiresAt: subscription.expiresAt,
    },
  });
});

/**
 * @desc    Get current subscription status
 * @route   GET /api/v1/pro/subscription
 * @access  Private
 */
exports.getSubscription = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Find active subscription
  const subscription = await Subscription.findActiveByUserId(userId);

  if (!subscription) {
    return res.status(200).json({
      success: true,
      data: {
        hasActiveSubscription: false,
        planStatus: req.user.planStatus,
      },
    });
  }

  res.status(200).json({
    success: true,
    data: {
      hasActiveSubscription: true,
      planStatus: req.user.planStatus,
      planId: subscription.planId,
      status: subscription.status,
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
      daysRemaining: Math.ceil((subscription.expiresAt - new Date()) / (1000 * 60 * 60 * 24)),
    },
  });
});
