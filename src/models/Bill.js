const mongoose = require('mongoose');

const billItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    default: null,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  qty: {
    type: Number,
    required: true,
    min: 0,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  total: {
    type: Number,
    required: true,
    min: 0,
  },
});

const billSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    billNo: {
      type: String,
      required: true,
      trim: true,
    },
    items: {
      type: [billItemSchema],
      required: true,
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: 'Bill must have at least one item',
      },
    },
    subTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    grandTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['unpaid', 'partial', 'paid', 'cancelled'],
      default: 'unpaid',
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
      sparse: true,
    },
    
    // Dispute & Recovery Pause (Step 9: Dispute Resolution)
    disputeStatus: {
      type: String,
      enum: ['none', 'open', 'resolved'],
      default: 'none',
      index: true,
    },
    disputeReason: {
      type: String,
      default: '',
      trim: true,
    },
    disputeNotes: {
      type: String,
      default: '',
      trim: true,
    },
    disputeOpenedAt: {
      type: Date,
      default: null,
    },
    disputeResolvedAt: {
      type: Date,
      default: null,
    },
    recoveryPaused: {
      type: Boolean,
      default: false,
      index: true,
    },
    recoveryPausedAt: {
      type: Date,
      default: null,
    },
    recoveryPausedUntil: {
      type: Date,
      default: null,
    },
    recoveryPausedReason: {
      type: String,
      default: '',
      trim: true,
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
  }
);

// Compound index for idempotency
billSchema.index({userId: 1, idempotencyKey: 1}, {unique: true, sparse: true});

// Index for queries
billSchema.index({userId: 1, customerId: 1, status: 1});
billSchema.index({userId: 1, billNo: 1}, {unique: true});

// Indexes for Bills Ledger (performance optimization)
billSchema.index({userId: 1, createdAt: -1}); // Default sort by date
billSchema.index({userId: 1, status: 1, createdAt: -1}); // Filter by status + date
billSchema.index({userId: 1, customerId: 1, createdAt: -1}); // Filter by customer + date
billSchema.index({userId: 1, dueDate: 1}); // For overdue queries

// Compute status based on paid amount
billSchema.methods.computeStatus = function () {
  if (this.status === 'cancelled') {
    return 'cancelled';
  }
  
  if (this.paidAmount === 0) {
    return 'unpaid';
  } else if (this.paidAmount >= this.grandTotal) {
    return 'paid';
  } else {
    return 'partial';
  }
};

// Update status before saving
billSchema.pre('save', function (next) {
  if (this.status !== 'cancelled') {
    this.status = this.computeStatus();
  }
  next();
});

// Virtual fields for computed values
billSchema.virtual('pendingAmount').get(function () {
  return Math.max(0, this.grandTotal - this.paidAmount);
});

billSchema.virtual('isOverdue').get(function () {
  if (!this.dueDate || this.status === 'paid' || this.status === 'cancelled') {
    return false;
  }
  return new Date(this.dueDate) < new Date() && this.pendingAmount > 0;
});

// Ensure virtuals are included in JSON and lean queries
billSchema.set('toJSON', {virtuals: true});
billSchema.set('toObject', {virtuals: true});

// Index creation logging
billSchema.on('index', (error) => {
  if (error) {
    console.error('[Bill] Index build error:', error);
  } else {
    console.log('[Bill] Indexes built successfully');
  }
});

/**
 * Check if bill should be excluded from recovery/follow-up
 * @returns {boolean} - true if bill should be excluded
 */
billSchema.methods.isExcludedFromRecovery = function () {
  // Exclude if disputed
  if (this.disputeStatus === 'open') {
    return true;
  }
  
  // Exclude if recovery is paused
  if (this.recoveryPaused) {
    // Check if pause has expired
    if (this.recoveryPausedUntil) {
      const now = new Date();
      if (now < this.recoveryPausedUntil) {
        return true; // Pause is still active
      }
      // Pause expired but flag not reset - still exclude to be safe
      return true;
    }
    // No expiry date, indefinite pause
    return true;
  }
  
  return false;
};

/**
 * Check if recovery pause has expired
 * @returns {boolean} - true if pause has expired
 */
billSchema.methods.isRecoveryPauseExpired = function () {
  if (!this.recoveryPaused || !this.recoveryPausedUntil) {
    return false;
  }
  return new Date() >= this.recoveryPausedUntil;
};

const Bill = mongoose.model('Bill', billSchema);

module.exports = Bill;
