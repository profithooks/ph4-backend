/**
 * Customer model
 */
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Please provide customer name'],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    
    // Credit Limit Control (Step 4: Hard Control - Rockefeller-grade atomic enforcement)
    creditLimitEnabled: {
      type: Boolean,
      default: false,
    },
    creditLimitAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    creditLimitGraceAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    creditLimitAllowOverride: {
      type: Boolean,
      default: true,
    },
    creditLimitUpdatedAt: {
      type: Date,
    },
    creditLimitUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    
    // ATOMIC OUTSTANDING TRACKING
    // Maintained atomically using $inc operations for Rockefeller-grade concurrency safety
    // This is the SINGLE SOURCE OF TRUTH for credit enforcement (NOT computed from ledger on-the-fly)
    creditOutstanding: {
      type: Number,
      default: 0,
      min: 0, // Never negative
    },
    
    // Soft Delete (Step 5: Staff Accountability)
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    deleteReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for common queries
customerSchema.index({userId: 1, createdAt: -1}); // List customers (most recent first)
customerSchema.index({userId: 1, name: 1}); // Search by name
customerSchema.index({userId: 1, phone: 1}); // Search by phone

// Text index for search functionality
customerSchema.index({name: 'text', phone: 'text'});

// Index creation logging
customerSchema.on('index', (error) => {
  if (error) {
    console.error('[Customer] Index build error:', error);
  } else {
    console.log('[Customer] Indexes built successfully');
  }
});

module.exports = mongoose.model('Customer', customerSchema);
