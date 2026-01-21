/**
 * Webhook Controller - Razorpay Payment Webhooks
 * 
 * Handles incoming webhooks from Razorpay for payment events.
 * 
 * Security:
 * - Signature verification (MANDATORY)
 * - Idempotency (prevents duplicate activations)
 * - Audit logging (stores full payload)
 * 
 * Events Handled:
 * - payment.captured (one-time payment)
 * - subscription.activated (recurring subscription)
 */

const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const {
  verifyWebhookSignature,
  extractPaymentDetails,
  validatePaymentDetails,
} = require('../utils/razorpayWebhook');

/**
 * Handle Razorpay webhook events
 * 
 * POST /webhooks/razorpay
 * 
 * @route   POST /webhooks/razorpay
 * @access  Public (with signature verification)
 */
const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  
  // Step 1: Verify signature
  if (!webhookSecret) {
    console.error('[Webhook] RAZORPAY_WEBHOOK_SECRET not configured');
    return res.status(500).json({
      success: false,
      message: 'Webhook configuration error',
    });
  }
  
  const isValid = verifyWebhookSignature(req.rawBody, signature, webhookSecret);
  
  if (!isValid) {
    console.warn('[Webhook] Invalid signature received');
    return res.status(401).json({
      success: false,
      message: 'Invalid signature',
    });
  }
  
  // Step 2: Extract event type
  const event = req.body.event;
  console.log(`[Webhook] Received event: ${event}`);
  
  // Step 3: Handle supported events
  if (event === 'payment.captured') {
    return handlePaymentCaptured(req, res);
  }
  
  if (event === 'subscription.activated') {
    return handleSubscriptionActivated(req, res);
  }
  
  // Step 4: Ignore unsupported events (but return 200 OK)
  console.log(`[Webhook] Ignoring unsupported event: ${event}`);
  return res.status(200).json({
    success: true,
    message: 'Event ignored',
  });
});

/**
 * Handle payment.captured event
 * Activates Pro plan for user after successful payment
 */
const handlePaymentCaptured = asyncHandler(async (req, res) => {
  // Extract payment details
  const details = extractPaymentDetails(req.body);
  
  if (!details) {
    console.error('[Webhook] Failed to extract payment details');
    return res.status(400).json({
      success: false,
      message: 'Invalid payload structure',
    });
  }
  
  // Validate required fields
  const validation = validatePaymentDetails(details);
  if (!validation.valid) {
    console.error('[Webhook] Missing required fields:', validation.missing);
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
      missing: validation.missing,
    });
  }
  
  const { paymentId, orderId, amount, currency, userId } = details;
  
  console.log(`[Webhook] Processing payment.captured: ${paymentId} for user ${userId}`);
  
  // Check idempotency - has this payment been processed already?
  const existingSubscription = await Subscription.findOne({ providerPaymentId: paymentId });
  
  if (existingSubscription) {
    console.log(`[Webhook] Payment ${paymentId} already processed - idempotent success`);
    return res.status(200).json({
      success: true,
      message: 'Payment already processed',
      subscriptionId: existingSubscription._id,
    });
  }
  
  // Find user
  const user = await User.findById(userId);
  
  if (!user) {
    console.error(`[Webhook] User not found: ${userId}`);
    return res.status(404).json({
      success: false,
      message: 'User not found',
    });
  }
  
  try {
    // Activate Pro plan
    user.planStatus = 'pro';
    user.planActivatedAt = new Date();
    await user.save();
    
    console.log(`[Webhook] User ${userId} upgraded to Pro`);
    
    // Create subscription record
    const subscription = await Subscription.create({
      userId: user._id,
      planId: 'ph4_pro_monthly',
      provider: 'razorpay',
      status: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amountPaid: amount,
      currency: currency || 'INR',
      metadata: req.body, // Store full webhook payload for audit
    });
    
    console.log(`[Webhook] Subscription created: ${subscription._id}`);
    
    return res.status(200).json({
      success: true,
      message: 'Pro plan activated',
      userId: user._id,
      subscriptionId: subscription._id,
    });
  } catch (error) {
    console.error('[Webhook] Error activating Pro:', error);
    
    // Return 500 so Razorpay will retry
    return res.status(500).json({
      success: false,
      message: 'Failed to activate Pro',
      error: error.message,
    });
  }
});

/**
 * Handle subscription.activated event
 * (For recurring Razorpay subscriptions, if implemented)
 */
const handleSubscriptionActivated = asyncHandler(async (req, res) => {
  // Similar logic to payment.captured
  // For now, return success (not implemented yet)
  console.log('[Webhook] subscription.activated event received (not yet implemented)');
  
  return res.status(200).json({
    success: true,
    message: 'Subscription event acknowledged',
  });
});

module.exports = {
  handleRazorpayWebhook,
};
