/**
 * Razorpay Webhook Utilities
 * 
 * Signature verification and payload validation for Razorpay webhooks.
 * 
 * Security:
 * - Uses HMAC SHA256 for signature verification
 * - Timing-safe comparison to prevent timing attacks
 * - Raw body required for signature verification
 */

const crypto = require('crypto');

/**
 * Verify Razorpay webhook signature
 * 
 * @param {string|Buffer} rawBody - Raw request body (before JSON parsing)
 * @param {string} signature - X-Razorpay-Signature header value
 * @param {string} secret - Webhook secret from Razorpay dashboard
 * @returns {boolean} True if signature is valid
 */
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) {
    console.error('[RazorpayWebhook] Missing required parameters for signature verification');
    return false;
  }
  
  try {
    // Generate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    
    // Use timing-safe comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
    
    if (!isValid) {
      console.warn('[RazorpayWebhook] Signature verification failed');
    }
    
    return isValid;
  } catch (error) {
    console.error('[RazorpayWebhook] Signature verification error:', error.message);
    return false;
  }
}

/**
 * Extract payment details from webhook payload
 * 
 * @param {Object} webhookPayload - Parsed webhook body
 * @returns {Object|null} Payment details or null if invalid
 */
function extractPaymentDetails(webhookPayload) {
  try {
    const event = webhookPayload.event;
    
    if (event === 'payment.captured') {
      const payment = webhookPayload.payload?.payment?.entity;
      
      if (!payment) {
        console.error('[RazorpayWebhook] Missing payment entity in payload');
        return null;
      }
      
      return {
        paymentId: payment.id,
        orderId: payment.order_id,
        amount: payment.amount, // in paise
        currency: payment.currency || 'INR',
        status: payment.status,
        method: payment.method,
        email: payment.email,
        contact: payment.contact,
        userId: payment.notes?.userId,
        notes: payment.notes,
        createdAt: payment.created_at,
      };
    }
    
    if (event === 'subscription.activated') {
      const subscription = webhookPayload.payload?.subscription?.entity;
      
      if (!subscription) {
        console.error('[RazorpayWebhook] Missing subscription entity in payload');
        return null;
      }
      
      return {
        subscriptionId: subscription.id,
        planId: subscription.plan_id,
        status: subscription.status,
        userId: subscription.notes?.userId,
        notes: subscription.notes,
        createdAt: subscription.created_at,
      };
    }
    
    console.log(`[RazorpayWebhook] Unsupported event type: ${event}`);
    return null;
  } catch (error) {
    console.error('[RazorpayWebhook] Error extracting payment details:', error);
    return null;
  }
}

/**
 * Validate required fields in payment details
 * 
 * @param {Object} details - Payment details from extractPaymentDetails
 * @returns {Object} { valid: boolean, missing: string[] }
 */
function validatePaymentDetails(details) {
  if (!details) {
    return { valid: false, missing: ['details'] };
  }
  
  const required = ['paymentId', 'orderId', 'amount', 'userId'];
  const missing = required.filter(field => !details[field]);
  
  return {
    valid: missing.length === 0,
    missing,
  };
}

module.exports = {
  verifyWebhookSignature,
  extractPaymentDetails,
  validatePaymentDetails,
};
