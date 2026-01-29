/**
 * Payment Model
 * 
 * Stores payment records for bills
 */
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
      required: true,
      index: true,
    },
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
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    
    // Payment Gateway Details
    provider: {
      type: String,
      enum: ['razorpay', 'manual'],
      default: 'razorpay',
      required: true,
    },
    providerOrderId: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
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
      enum: ['pending', 'captured', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },
    
    // Amount Details
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    
    // Payment Method
    method: {
      type: String,
      enum: ['card', 'netbanking', 'upi', 'wallet', 'other'],
      default: 'other',
    },
    
    // Customer Details (from payment gateway)
    customerEmail: {
      type: String,
      default: '',
    },
    customerPhone: {
      type: String,
      default: '',
    },
    
    // Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    
    // Timestamps for lifecycle
    capturedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    refundedAt: {
      type: Date,
      default: null,
    },
    
    // Notes
    notes: {
      type: String,
      default: '',
    },
    
    // Idempotency for webhook handling
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

// Index for efficient queries
paymentSchema.index({userId: 1, billId: 1});
paymentSchema.index({businessId: 1, status: 1});
paymentSchema.index({providerOrderId: 1}, {unique: true, sparse: true});

// Index creation logging
paymentSchema.on('index', (error) => {
  if (error) {
    console.error('[Payment] Index build error:', error);
  } else {
    console.log('[Payment] Indexes built successfully');
  }
});

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
