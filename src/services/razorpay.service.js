/**
 * Razorpay service for payment verification and order creation
 */
const crypto = require('crypto');
const Razorpay = require('razorpay');
const {razorpayKeyId, razorpayKeySecret} = require('../config/env');
const logger = require('../utils/logger');

// Initialize Razorpay instance
let razorpayInstance = null;

const getRazorpayInstance = () => {
  if (!razorpayInstance) {
    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new Error('Razorpay credentials not configured');
    }
    razorpayInstance = new Razorpay({
      key_id: razorpayKeyId,
      key_secret: razorpayKeySecret,
    });
  }
  return razorpayInstance;
};

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
  
  // Handle legacy plan IDs
  if (planId === 'ph4_pro_monthly') {
    return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }
  
  // Handle new plan IDs
  const plan = PRO_PLANS[planId];
  if (!plan) {
    throw new Error(`Unknown plan ID: ${planId}`);
  }
  
  return new Date(now.getTime() + plan.duration * 24 * 60 * 60 * 1000);
};

/**
 * Pro plan configurations (single source of truth)
 * Amount is in paise (INR smallest unit)
 */
const PRO_PLANS = {
  monthly: {
    id: 'monthly',
    name: 'Pro Monthly',
    displayName: 'Pro (Monthly)',
    amount: 29900, // ₹299 in paise
    currency: 'INR',
    duration: 30, // days
    displayPrice: '₹299',
    displayPeriod: 'month',
    savings: null,
  },
  quarterly: {
    id: 'quarterly',
    name: 'Pro Quarterly',
    displayName: 'Pro (Quarterly)',
    amount: 79900, // ₹799 in paise (saves ₹98)
    currency: 'INR',
    duration: 90, // days
    displayPrice: '₹799',
    displayPeriod: '3 months',
    savings: '₹98',
  },
  yearly: {
    id: 'yearly',
    name: 'Pro Yearly',
    displayName: 'Pro (Yearly)',
    amount: 299900, // ₹2999 in paise (saves ₹589)
    currency: 'INR',
    duration: 365, // days
    displayPrice: '₹2999',
    displayPeriod: 'year',
    savings: '₹589',
  },
};

/**
 * Get all Pro plans (for mobile UI)
 * @returns {Array} - Array of plan details
 */
const getProPlans = () => {
  return Object.values(PRO_PLANS);
};

/**
 * Get specific Pro plan details
 * @param {string} planId - Plan identifier (monthly, quarterly, yearly)
 * @returns {object} - Plan details
 */
const getProPlanDetails = (planId) => {
  const plan = PRO_PLANS[planId];
  if (!plan) {
    throw new Error(`Unknown plan ID: ${planId}. Valid plans: ${Object.keys(PRO_PLANS).join(', ')}`);
  }
  return plan;
};

/**
 * Get plan details (legacy - for backward compatibility)
 * @param {string} planId - Plan identifier
 * @returns {object} - Plan details
 */
const getPlanDetails = (planId) => {
  // Legacy plan IDs
  if (planId === 'ph4_pro_monthly') {
    return {
      id: 'ph4_pro_monthly',
      name: 'PH4 Pro (Monthly)',
      amount: 29900,
      currency: 'INR',
      duration: 30,
    };
  }
  
  // New plan IDs
  return getProPlanDetails(planId);
};

/**
 * Create Razorpay order for bill payment
 * @param {Object} params - Order parameters
 * @param {string} params.billId - Bill ID
 * @param {string} params.billNo - Bill number
 * @param {number} params.amount - Amount in rupees
 * @param {string} params.currency - Currency code
 * @param {string} params.customerName - Customer name
 * @param {string} params.customerEmail - Customer email
 * @param {string} params.customerPhone - Customer phone
 * @returns {Promise<Object>} - Razorpay order
 */
const createBillPaymentOrder = async ({
  billId,
  billNo,
  amount,
  currency = 'INR',
  customerName = '',
  customerEmail = '',
  customerPhone = '',
}) => {
  try {
    const rzp = getRazorpayInstance();
    
    // Convert amount to paise (Razorpay expects amount in smallest currency unit)
    const amountInPaise = Math.round(amount * 100);
    
    const orderOptions = {
      amount: amountInPaise,
      currency: currency,
      receipt: `bill_${billNo}_${Date.now()}`,
      notes: {
        billId: billId,
        billNo: billNo,
        type: 'bill_payment',
      },
    };
    
    logger.info('[Razorpay] Creating order for bill payment', {
      billId,
      billNo,
      amount,
      amountInPaise,
      currency,
    });
    
    const order = await rzp.orders.create(orderOptions);
    
    logger.info('[Razorpay] Order created successfully', {
      orderId: order.id,
      billId,
      amount: order.amount,
    });
    
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
    };
  } catch (error) {
    logger.error('[Razorpay] Order creation failed', {
      error: error.message,
      billId,
      amount,
    });
    throw error;
  }
};

/**
 * Verify Razorpay webhook signature
 * @param {string} body - Raw request body
 * @param {string} signature - Razorpay signature from header
 * @param {string} secret - Webhook secret
 * @returns {boolean} - True if signature is valid
 */
const verifyWebhookSignature = (body, signature, secret) => {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    
    return expectedSignature === signature;
  } catch (error) {
    logger.error('[Razorpay] Webhook signature verification error:', error);
    return false;
  }
};

/**
 * Create Razorpay order for Pro subscription
 * @param {Object} params - Order parameters
 * @param {string} params.userId - User ID
 * @param {string} params.businessId - Business ID
 * @param {string} params.planId - Plan ID (monthly, quarterly, yearly)
 * @returns {Promise<Object>} - Razorpay order details
 */
const createProSubscriptionOrder = async ({ userId, businessId, planId }) => {
  try {
    const rzp = getRazorpayInstance();
    
    // Get plan details (server-side source of truth)
    const plan = getProPlanDetails(planId);
    
    const orderOptions = {
      amount: plan.amount, // Amount in paise
      currency: plan.currency,
      receipt: `pro_${planId}_${userId.toString().substring(0, 8)}_${Date.now()}`,
      notes: {
        userId: userId.toString(),
        businessId: businessId.toString(),
        planId: planId,
        type: 'pro_subscription',
        planName: plan.name,
      },
    };
    
    logger.info('[Razorpay] Creating order for Pro subscription', {
      userId,
      businessId,
      planId,
      amount: plan.amount,
      currency: plan.currency,
    });
    
    const order = await rzp.orders.create(orderOptions);
    
    logger.info('[Razorpay] Pro subscription order created', {
      orderId: order.id,
      userId,
      planId,
      amount: order.amount,
    });
    
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      notes: order.notes,
    };
  } catch (error) {
    logger.error('[Razorpay] Pro subscription order creation failed', {
      error: error.message,
      userId,
      planId,
    });
    throw error;
  }
};

module.exports = {
  verifyPaymentSignature,
  calculateExpiryDate,
  getPlanDetails,
  getProPlans,
  getProPlanDetails,
  createBillPaymentOrder,
  createProSubscriptionOrder,
  verifyWebhookSignature,
  getRazorpayInstance,
};
