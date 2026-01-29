/**
 * Pro plan activation controller
 */
const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const ProPaymentIntent = require('../models/ProPaymentIntent');
const AuditEvent = require('../models/AuditEvent');
const razorpayService = require('../services/razorpay.service');
const { razorpayKeyId, razorpayKeySecret } = require('../config/env');
const logger = require('../utils/logger');

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

/**
 * @desc    Get available Pro plans
 * @route   GET /api/v1/pro/plans
 * @access  Private
 */
exports.getProPlans = asyncHandler(async (req, res, next) => {
  const requestId = req.requestId;
  const userId = req.user._id;
  const businessId = req.user._id;
  
  logger.info('[Pro] Getting available plans', {
    requestId,
    userId,
    businessId,
  });
  
  // Get all Pro plans from service (single source of truth)
  const plans = razorpayService.getProPlans();
  
  res.status(200).json({
    success: true,
    data: {
      plans,
      currentPlanStatus: req.user.planStatus,
    },
  });
});

/**
 * @desc    Create Pro subscription order
 * @route   POST /api/v1/pro/order
 * @access  Private
 */
exports.createProOrder = asyncHandler(async (req, res, next) => {
  const { planId } = req.body;
  const requestId = req.requestId;
  const userId = req.user._id;
  const businessId = req.user._id;
  
  logger.info('[Pro] Creating order', {
    requestId,
    userId,
    businessId,
    planId,
  });
  
  // Step 1: Validate planId
  if (!planId) {
    return next(new AppError('planId is required', 400, 'MISSING_PLAN_ID'));
  }
  
  // Validate plan exists
  let planDetails;
  try {
    planDetails = razorpayService.getProPlanDetails(planId);
  } catch (error) {
    return next(new AppError(error.message, 400, 'INVALID_PLAN_ID'));
  }
  
  // Step 2: Check for existing pending intent (idempotency - 10 minutes)
  const existingIntent = await ProPaymentIntent.findPendingIntent(userId, planId, 10);
  
  if (existingIntent) {
    logger.info('[Pro] Returning existing pending order', {
      requestId,
      userId,
      planId,
      orderId: existingIntent.providerOrderId,
      intentId: existingIntent._id,
      createdAt: existingIntent.createdAt,
    });
    
    return res.status(200).json({
      success: true,
      data: {
        orderId: existingIntent.providerOrderId,
        amount: existingIntent.amount,
        currency: existingIntent.currency,
        keyId: razorpayKeyId,
        planId: existingIntent.planId,
        receipt: existingIntent.receipt,
        intentId: existingIntent._id,
        createdAt: existingIntent.createdAt,
        expiresAt: existingIntent.expiresAt,
        reused: true,
      },
    });
  }
  
  // Step 3: Create Razorpay order
  let razorpayOrder;
  try {
    razorpayOrder = await razorpayService.createProSubscriptionOrder({
      userId,
      businessId,
      planId,
    });
  } catch (error) {
    logger.error('[Pro] Razorpay order creation failed', {
      requestId,
      userId,
      planId,
      error: error.message,
    });
    return next(new AppError('Failed to create payment order', 500, 'ORDER_CREATION_FAILED'));
  }
  
  // Step 4: Persist payment intent
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Expires in 15 minutes
  
  try {
    const paymentIntent = await ProPaymentIntent.create({
      userId,
      businessId,
      planId,
      provider: 'razorpay',
      providerOrderId: razorpayOrder.orderId,
      status: 'created',
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      receipt: razorpayOrder.receipt,
      expiresAt,
      metadata: {
        planName: planDetails.name,
        planDuration: planDetails.duration,
        createdByRequestId: requestId,
      },
    });
    
    logger.info('[Pro] Payment intent created', {
      requestId,
      userId,
      businessId,
      planId,
      orderId: razorpayOrder.orderId,
      intentId: paymentIntent._id,
      amount: razorpayOrder.amount,
      expiresAt,
    });
    
    // Step 5: Return order details to mobile
    res.status(200).json({
      success: true,
      data: {
        orderId: razorpayOrder.orderId,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: razorpayKeyId,
        planId: planId,
        receipt: razorpayOrder.receipt,
        intentId: paymentIntent._id,
        createdAt: paymentIntent.createdAt,
        expiresAt: paymentIntent.expiresAt,
        reused: false,
      },
    });
  } catch (error) {
    logger.error('[Pro] Payment intent creation failed', {
      requestId,
      userId,
      planId,
      orderId: razorpayOrder.orderId,
      error: error.message,
    });
    return next(new AppError('Failed to store payment intent', 500, 'INTENT_CREATION_FAILED'));
  }
});

/**
 * @desc    Verify payment and activate Pro plan
 * @route   POST /api/v1/pro/verify
 * @access  Private
 */
exports.verifyAndActivatePro = asyncHandler(async (req, res, next) => {
  const { planId, orderId, paymentId, signature } = req.body;
  const requestId = req.requestId;
  const userId = req.user._id;
  const businessId = req.user._id;
  
  logger.info('[Pro] Verifying payment', {
    requestId,
    userId,
    businessId,
    planId,
    orderId,
    paymentId,
  });
  
  // Step 1: Validate required fields
  if (!planId || !orderId || !paymentId || !signature) {
    return next(new AppError('planId, orderId, paymentId, and signature are required', 400, 'MISSING_REQUIRED_FIELDS'));
  }
  
  // Step 2: Look up payment intent by orderId and userId
  const paymentIntent = await ProPaymentIntent.findOne({
    providerOrderId: orderId,
    userId,
  });
  
  if (!paymentIntent) {
    logger.error('[Pro] Payment intent not found', {
      requestId,
      userId,
      orderId,
    });
    return next(new AppError('Payment intent not found', 404, 'INTENT_NOT_FOUND'));
  }
  
  // Step 3: Check if already paid (idempotency)
  if (paymentIntent.status === 'paid') {
    logger.info('[Pro] Payment already processed (idempotent)', {
      requestId,
      userId,
      orderId,
      paymentId,
      intentId: paymentIntent._id,
    });
    
    // Find existing subscription
    const subscription = await Subscription.findOne({
      userId,
      providerOrderId: orderId,
    });
    
    if (!subscription) {
      logger.error('[Pro] Subscription not found for paid intent', {
        requestId,
        userId,
        orderId,
      });
      return next(new AppError('Subscription not found', 500, 'SUBSCRIPTION_NOT_FOUND'));
    }
    
    // Return success with existing entitlement
    return res.status(200).json({
      ok: true,
      data: {
        planStatus: req.user.planStatus,
        endsAt: subscription.expiresAt,
        subscriptionId: subscription._id,
        entitlementSnapshot: {
          planStatus: req.user.planStatus,
          planActivatedAt: req.user.planActivatedAt,
          trialEndsAt: req.user.trialEndsAt,
        },
        alreadyProcessed: true,
      },
    });
  }
  
  // Step 4: Verify Razorpay signature
  if (!razorpayKeySecret) {
    logger.error('[Pro] RAZORPAY_KEY_SECRET not configured', {
      requestId,
      userId,
    });
    return next(new AppError('Payment verification not configured', 500, 'VERIFICATION_CONFIG_ERROR'));
  }
  
  const isValidSignature = razorpayService.verifyPaymentSignature(
    orderId,
    paymentId,
    signature,
    razorpayKeySecret
  );
  
  if (!isValidSignature) {
    logger.error('[Pro] Invalid payment signature', {
      requestId,
      userId,
      orderId,
      paymentId,
      signaturePrefix: signature.substring(0, 10),
    });
    return next(new AppError('Invalid payment signature', 400, 'INVALID_SIGNATURE'));
  }
  
  logger.info('[Pro] Payment signature verified', {
    requestId,
    userId,
    orderId,
    paymentId,
  });
  
  // Step 5: Get plan details
  let planDetails;
  try {
    planDetails = razorpayService.getProPlanDetails(planId);
  } catch (error) {
    logger.error('[Pro] Invalid plan ID', {
      requestId,
      userId,
      planId,
      error: error.message,
    });
    return next(new AppError(error.message, 400, 'INVALID_PLAN_ID'));
  }
  
  // Step 6: Calculate subscription dates
  const startedAt = new Date();
  const expiresAt = razorpayService.calculateExpiryDate(planId);
  
  try {
    // Step 7: Update payment intent status
    paymentIntent.status = 'paid';
    paymentIntent.providerPaymentId = paymentId;
    paymentIntent.providerSignature = signature;
    paymentIntent.paidAt = startedAt;
    await paymentIntent.save();
    
    logger.info('[Pro] Payment intent marked as paid', {
      requestId,
      userId,
      intentId: paymentIntent._id,
      orderId,
      paymentId,
    });
    
    // Step 8: Create or update subscription record
    let subscription = await Subscription.findOne({
      userId,
      providerOrderId: orderId,
    });
    
    if (subscription) {
      // Update existing subscription
      subscription.status = 'active';
      subscription.startedAt = startedAt;
      subscription.expiresAt = expiresAt;
      subscription.providerPaymentId = paymentId;
      subscription.providerSignature = signature;
      await subscription.save();
      
      logger.info('[Pro] Subscription updated', {
        requestId,
        userId,
        subscriptionId: subscription._id,
        orderId,
      });
    } else {
      // Create new subscription
      subscription = await Subscription.create({
        userId,
        planId: planDetails.id,
        provider: 'razorpay',
        status: 'active',
        startedAt,
        expiresAt,
        providerPaymentId: paymentId,
        providerOrderId: orderId,
        providerSignature: signature,
        amountPaid: paymentIntent.amount,
        currency: paymentIntent.currency,
        metadata: {
          planName: planDetails.name,
          planDuration: planDetails.duration,
          activatedAt: startedAt.toISOString(),
          activatedVia: 'verify_endpoint',
          requestId,
        },
      });
      
      logger.info('[Pro] Subscription created', {
        requestId,
        userId,
        subscriptionId: subscription._id,
        orderId,
        planId,
      });
    }
    
    // Step 9: Update user entitlement (requirePro checks this)
    req.user.planStatus = 'pro';
    req.user.planActivatedAt = startedAt;
    await req.user.save();
    
    logger.info('[Pro] User upgraded to Pro', {
      requestId,
      userId,
      planStatus: 'pro',
      planActivatedAt: startedAt,
    });
    
    // Step 10: Log audit event
    try {
      await AuditEvent.create({
        actorUserId: userId,
        actorRole: 'OWNER',
        action: 'PRO_PURCHASED',
        entityType: 'SUBSCRIPTION',
        entityId: subscription._id,
        businessId,
        metadata: {
          planId: planDetails.id,
          planName: planDetails.name,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          duration: planDetails.duration,
          orderIdPrefix: orderId.substring(0, 16),
          paymentIdPrefix: paymentId.substring(0, 16),
          expiresAt: expiresAt.toISOString(),
          requestId,
        },
      });
      
      logger.info('[Pro] Audit event created', {
        requestId,
        userId,
        action: 'PRO_PURCHASED',
        subscriptionId: subscription._id,
      });
    } catch (auditError) {
      // Don't fail the request if audit logging fails
      logger.error('[Pro] Failed to create audit event', {
        requestId,
        userId,
        error: auditError.message,
      });
    }
    
    // Step 11: Return success with entitlement snapshot
    res.status(200).json({
      ok: true,
      data: {
        planStatus: req.user.planStatus,
        endsAt: subscription.expiresAt,
        subscriptionId: subscription._id,
        entitlementSnapshot: {
          planStatus: req.user.planStatus,
          planActivatedAt: req.user.planActivatedAt,
          trialEndsAt: req.user.trialEndsAt,
        },
        alreadyProcessed: false,
      },
    });
  } catch (error) {
    logger.error('[Pro] Failed to activate Pro', {
      requestId,
      userId,
      orderId,
      paymentId,
      error: error.message,
      stack: error.stack,
    });
    
    return next(new AppError('Failed to activate Pro plan', 500, 'ACTIVATION_FAILED'));
  }
});
