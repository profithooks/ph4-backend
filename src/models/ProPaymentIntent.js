/**
 * ProPaymentIntent Model
 * 
 * Stores payment intents for Pro subscription purchases
 * Tracks order creation before payment completion
 */
const mongoose = require('mongoose');

const proPaymentIntentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    
    // Plan Details
    planId: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly'],
      required: true,
      index: true,
    },
    
    // Payment Gateway Details
    provider: {
      type: String,
      enum: ['razorpay'],
      default: 'razorpay',
      required: true,
    },
    providerOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    providerPaymentId: {
      type: String,
      default: null,
    },
    providerSignature: {
      type: String,
      default: null,
    },
    
    // Payment Status
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'expired'],
      default: 'created',
      index: true,
    },
    
    // Amount Details (server-computed, immutable)
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    
    // Receipt
    receipt: {
      type: String,
      required: true,
    },
    
    // Payment completion timestamps
    paidAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    
    // Webhook processing
    webhookProcessed: {
      type: Boolean,
      default: false,
      index: true,
    },
    webhookProcessedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
proPaymentIntentSchema.index({ userId: 1, planId: 1, status: 1 });
proPaymentIntentSchema.index({ userId: 1, createdAt: -1 });
proPaymentIntentSchema.index({ status: 1, expiresAt: 1 });

// Index creation logging
proPaymentIntentSchema.on('index', (error) => {
  if (error) {
    console.error('[ProPaymentIntent] Index build error:', error);
  } else {
    console.log('[ProPaymentIntent] Indexes built successfully');
  }
});

/**
 * Find existing pending intent for user and plan within time window
 * @param {ObjectId} userId - User ID
 * @param {string} planId - Plan ID
 * @param {number} withinMinutes - Time window in minutes (default 10)
 * @returns {Promise<ProPaymentIntent|null>}
 */
proPaymentIntentSchema.statics.findPendingIntent = function(userId, planId, withinMinutes = 10) {
  const cutoffTime = new Date(Date.now() - withinMinutes * 60 * 1000);
  
  return this.findOne({
    userId,
    planId,
    status: 'created',
    createdAt: { $gte: cutoffTime },
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });
};

/**
 * Mark intent as expired
 */
proPaymentIntentSchema.methods.markExpired = async function() {
  if (this.status === 'created' && new Date() > this.expiresAt) {
    this.status = 'expired';
    await this.save();
    console.log(`[ProPaymentIntent] Marked intent ${this._id} as expired for user ${this.userId}`);
    return true;
  }
  return false;
};

const ProPaymentIntent = mongoose.model('ProPaymentIntent', proPaymentIntentSchema);

module.exports = ProPaymentIntent;
