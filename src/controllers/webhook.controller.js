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
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const logger = require('../utils/logger');
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
  
  // Step 1: Check if webhook secret is configured
  if (!webhookSecret) {
    console.error('[Webhook] RAZORPAY_WEBHOOK_SECRET not configured');
    return res.status(500).json({
      success: false,
      message: 'Webhook configuration error',
    });
  }
  
  // Step 2: Check if signature header exists
  if (!signature) {
    console.warn('[Webhook] Missing X-Razorpay-Signature header');
    return res.status(400).json({
      success: false,
      message: 'Missing signature header',
    });
  }
  
  // Step 3: Get raw body buffer (from express.raw middleware)
  const rawBody = req.body;
  
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    console.error('[Webhook] Missing or invalid raw body buffer');
    return res.status(400).json({
      success: false,
      message: 'Invalid request body',
    });
  }
  
  // Step 4: Verify signature using raw buffer (exact bytes)
  const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
  
  if (!isValid) {
    console.warn('[Webhook] Invalid signature received', {
      bodyLength: rawBody.length,
      signaturePrefix: signature.substring(0, 10),
    });
    return res.status(401).json({
      success: false,
      message: 'Invalid signature',
    });
  }
  
  console.log('[Webhook] Signature verified successfully');
  
  // Step 5: Parse JSON body AFTER signature verification
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    logger.error('[Webhook] Failed to parse JSON body', {
      error: error.message,
      bodyLength: rawBody.length,
      bodyPrefix: rawBody.toString('utf8').substring(0, 100),
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON payload',
      bodyLength: rawBody.length,
    });
  }
  
  // Step 6: Extract event type
  const event = payload.event;
  console.log(`[Webhook] Received event: ${event}`);
  
  // Attach parsed payload to req.body for handlers
  req.body = payload;
  
  // Step 7: Handle supported events
  if (event === 'payment.captured') {
    // Check if it's a bill payment or subscription payment
    const paymentEntity = payload.payload?.payment?.entity;
    const notes = paymentEntity?.notes || {};
    
    if (notes.type === 'bill_payment' && notes.billId) {
      return handleBillPaymentCaptured(req, res);
    }
    
    // Otherwise, handle as subscription/pro payment
    return handlePaymentCaptured(req, res);
  }
  
  if (event === 'subscription.activated') {
    return handleSubscriptionActivated(req, res);
  }
  
  // Step 8: Ignore unsupported events (but return 200 OK)
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
    // Resolve planId from notes or amount mapping
    const { PLANS } = require('../config/proPlans');
    const notes = details.notes || {};
    let planId = notes.planId; // Try notes first (preferred)
    let durationDays = 30; // Default fallback
    
    // Validate planId from notes
    if (planId && PLANS[planId]) {
      durationDays = PLANS[planId].durationDays;
      console.log(`[Webhook] Using planId from notes: ${planId}`);
    } else {
      // Fallback: Map amount to planId
      console.warn(`[Webhook] No valid planId in notes, mapping by amount: ${amount}`);
      
      // Match amount to plan (exact match in paise)
      const planEntry = Object.entries(PLANS).find(([key, plan]) => plan.amountPaise === amount);
      
      if (planEntry) {
        planId = planEntry[0];
        durationDays = planEntry[1].durationDays;
        console.log(`[Webhook] Mapped amount ${amount} to planId: ${planId}`);
      } else {
        // No match - log warning and default to monthly
        console.warn(`[Webhook] Amount ${amount} does not match any plan - defaulting to monthly`);
        planId = 'monthly';
        durationDays = 30;
      }
    }
    
    // Activate Pro plan
    user.planStatus = 'pro';
    user.planActivatedAt = new Date();
    await user.save();
    
    console.log(`[Webhook] User ${userId} upgraded to Pro (plan: ${planId})`);
    
    // Create subscription record with resolved planId
    const subscription = await Subscription.create({
      userId: user._id,
      planId: planId, // Now uses 'monthly', 'quarterly', or 'yearly'
      provider: 'razorpay',
      status: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
      providerPaymentId: paymentId,
      providerOrderId: orderId,
      amountPaid: amount,
      currency: currency || 'INR',
      metadata: req.body, // Store full webhook payload for audit
    });
    
    console.log(`[Webhook] Subscription created: ${subscription._id}, planId: ${planId}, expires: ${subscription.expiresAt}`);
    
    // Log audit event
    const AuditEvent = require('../models/AuditEvent');
    await AuditEvent.create({
      action: 'PRO_PURCHASED',
      userId: user._id,
      entityType: 'SUBSCRIPTION',
      entityId: subscription._id,
      metadata: {
        planId: planId,
        amountPaise: amount,
        orderIdPrefix: orderId.substring(0, 16),
        paymentIdPrefix: paymentId.substring(0, 16),
        source: 'webhook',
      },
    });
    
    return res.status(200).json({
      success: true,
      message: 'Pro plan activated',
      userId: user._id,
      subscriptionId: subscription._id,
      planId: planId,
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
 * Handle payment.captured event for bill payments
 * Marks bill as paid and updates payment record
 */
const handleBillPaymentCaptured = asyncHandler(async (req, res) => {
  const payload = req.body.payload?.payment?.entity;
  
  if (!payload) {
    logger.error('[Webhook] Invalid payload for bill payment');
    return res.status(400).json({success: false, message: 'Invalid payload'});
  }
  
  const paymentId = payload.id;
  const orderId = payload.order_id;
  const amount = payload.amount;
  const status = payload.status;
  const method = payload.method;
  const notes = payload.notes || {};
  const billId = notes.billId;
  
  logger.info('[Webhook] Processing bill payment.captured', {
    paymentId,
    orderId,
    billId,
    amount,
    status,
  });
  
  // Step 1: Find payment record
  const payment = await Payment.findOne({providerOrderId: orderId});
  
  if (!payment) {
    logger.error('[Webhook] Payment record not found', {orderId});
    return res.status(404).json({success: false, message: 'Payment not found'});
  }
  
  // Step 2: Check idempotency
  if (payment.webhookProcessed) {
    logger.info('[Webhook] Bill payment already processed - idempotent', {
      paymentId: payment._id,
      billId: payment.billId,
    });
    return res.status(200).json({
      success: true,
      message: 'Payment already processed',
      paymentId: payment._id,
    });
  }
  
  // Step 3: Find bill
  const bill = await Bill.findById(payment.billId);
  
  if (!bill) {
    logger.error('[Webhook] Bill not found', {billId: payment.billId});
    return res.status(404).json({success: false, message: 'Bill not found'});
  }
  
  try {
    // Step 4: Update payment record
    payment.status = 'captured';
    payment.providerPaymentId = paymentId;
    payment.method = method;
    payment.capturedAt = new Date();
    payment.webhookProcessed = true;
    payment.webhookProcessedAt = new Date();
    payment.metadata = {
      ...payment.metadata,
      webhookPayload: payload,
    };
    await payment.save();
    
    logger.info('[Webhook] Payment record updated', {
      paymentId: payment._id,
      status: 'captured',
    });
    
    // Step 5: Update bill - mark as paid
    const amountInRupees = amount / 100; // Convert paise to rupees
    bill.paidAmount = (bill.paidAmount || 0) + amountInRupees;
    
    // Recompute status
    if (bill.paidAmount >= bill.grandTotal) {
      bill.status = 'paid';
    } else if (bill.paidAmount > 0) {
      bill.status = 'partial';
    }
    
    await bill.save();
    
    logger.info('[Webhook] Bill updated', {
      billId: bill._id,
      billNo: bill.billNo,
      paidAmount: bill.paidAmount,
      grandTotal: bill.grandTotal,
      status: bill.status,
    });
    
    // Step 6: Create ledger transaction (debit - payment received)
    const LedgerTransaction = require('../models/LedgerTransaction');
    await LedgerTransaction.create({
      userId: bill.userId,
      customerId: bill.customerId,
      type: 'debit',
      amount: amountInRupees,
      note: `Payment received for Bill ${bill.billNo} via ${method}`,
      metadata: {
        billId: bill._id,
        billNo: bill.billNo,
        source: 'razorpay_payment',
        paymentId: payment._id,
        providerPaymentId: paymentId,
      },
    });
    
    logger.info('[Webhook] Ledger transaction created', {
      billId: bill._id,
      amount: amountInRupees,
    });
    
    return res.status(200).json({
      success: true,
      message: 'Bill payment processed',
      billId: bill._id,
      billNo: bill.billNo,
      paymentId: payment._id,
      status: bill.status,
    });
  } catch (error) {
    logger.error('[Webhook] Error processing bill payment', {
      error: error.message,
      stack: error.stack,
      billId: payment.billId,
    });
    
    // Return 500 so Razorpay will retry
    return res.status(500).json({
      success: false,
      message: 'Failed to process payment',
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
