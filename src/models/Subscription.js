/**
 * Subscription model for Pro plan management
 */
const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    planId: {
      type: String,
      enum: ['ph4_pro_monthly'],
      required: true,
      default: 'ph4_pro_monthly',
    },
    provider: {
      type: String,
      enum: ['razorpay', 'manual'],
      required: true,
      default: 'razorpay',
    },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'expired'],
      required: true,
      default: 'active',
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    // Razorpay identifiers
    providerPaymentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    providerOrderId: {
      type: String,
      required: true,
      index: true,
    },
    providerSignature: {
      type: String,
    },
    // Raw provider payload for auditing
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    // Amount paid (in paise for Razorpay)
    amountPaid: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for efficient queries
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ expiresAt: 1, status: 1 });

// Index creation logging
subscriptionSchema.on('index', (error) => {
  if (error) {
    console.error('[Subscription] Index build error:', error);
  } else {
    console.log('[Subscription] Indexes built successfully');
  }
});

/**
 * Find active subscription for a user
 */
subscriptionSchema.statics.findActiveByUserId = function(userId) {
  return this.findOne({
    userId,
    status: 'active',
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });
};

/**
 * Check if subscription is expired and mark it
 */
subscriptionSchema.methods.checkAndMarkExpired = async function() {
  if (this.status === 'active' && new Date() > this.expiresAt) {
    this.status = 'expired';
    await this.save();
    console.log(`[Subscription] Marked subscription ${this._id} as expired for user ${this.userId}`);
    return true;
  }
  return false;
};

/**
 * Get expiry information for a user's subscription
 * Returns null if no active subscription or subscription info with days left
 */
subscriptionSchema.statics.getExpiryInfo = async function(userId) {
  const subscription = await this.findOne({
    userId,
    status: 'active',
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });
  
  if (!subscription) {
    return null;
  }
  
  const now = new Date();
  const daysLeft = Math.ceil((subscription.expiresAt - now) / (1000 * 60 * 60 * 24));
  const isExpiring = daysLeft <= 7; // Warning threshold: 7 days
  
  return {
    expiresAt: subscription.expiresAt,
    daysLeft: Math.max(0, daysLeft),
    isExpiring,
    planId: subscription.planId,
  };
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
