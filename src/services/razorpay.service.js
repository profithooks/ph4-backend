/**
 * Razorpay service for payment verification
 */
const crypto = require('crypto');

/**
 * Verify Razorpay payment signature
 * @param {string} orderId - Razorpay order ID
 * @param {string} paymentId - Razorpay payment ID
 * @param {string} signature - Razorpay signature
 * @param {string} secret - Razorpay key secret
 * @returns {boolean} - True if signature is valid
 */
const verifyPaymentSignature = (orderId, paymentId, signature, secret) => {
  try {
    // Create expected signature
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Compare signatures
    return expectedSignature === signature;
  } catch (error) {
    console.error('[Razorpay] Signature verification error:', error);
    return false;
  }
};

/**
 * Calculate subscription expiry date
 * @param {string} planId - Plan identifier
 * @returns {Date} - Expiry date
 */
const calculateExpiryDate = (planId) => {
  const now = new Date();
  
  switch (planId) {
    case 'ph4_pro_monthly':
      // Add 30 days
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    default:
      throw new Error(`Unknown plan ID: ${planId}`);
  }
};

/**
 * Get plan details
 * @param {string} planId - Plan identifier
 * @returns {object} - Plan details
 */
const getPlanDetails = (planId) => {
  const plans = {
    ph4_pro_monthly: {
      id: 'ph4_pro_monthly',
      name: 'PH4 Pro (Monthly)',
      amount: 29900, // ₹299 in paise
      currency: 'INR',
      duration: 30, // days
    },
  };

  const plan = plans[planId];
  if (!plan) {
    throw new Error(`Unknown plan ID: ${planId}`);
  }

  return plan;
};

module.exports = {
  verifyPaymentSignature,
  calculateExpiryDate,
  getPlanDetails,
};
