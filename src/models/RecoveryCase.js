const mongoose = require('mongoose');

const recoveryCaseSchema = new mongoose.Schema(
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
    customerSnapshot: {
      type: {
        name: String,
        phone: String,
      },
      default: null,
    },
  status: {
    type: String,
    enum: ['open', 'promised', 'paid', 'disputed', 'dropped', 'resolved'],
    default: 'open',
  },
  outstandingSnapshot: {
    type: Number,
    required: true,
  },
  promiseAt: {
    type: Date,
    default: null,
  },
  promiseAmount: {
    type: Number,
    default: null,
  },
  promiseStatus: {
    type: String,
    enum: ['NONE', 'DUE_TODAY', 'UPCOMING', 'OVERDUE', 'PAID', 'BROKEN'],
    default: 'NONE',
  },
  promiseUpdatedAt: {
    type: Date,
    default: null,
  },
  escalationLevel: {
    type: Number,
    default: 0,
    min: 0,
    max: 3,
  },
  lastPromiseAt: {
    type: Date,
    default: null,
  },
  brokenPromisesCount: {
    type: Number,
    default: 0,
  },
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  notes: {
    type: String,
    default: '',
  },
  idempotencyKey: {
    type: String,
    required: true,
  },
  },
  {
    timestamps: true,
  },
);

// Unique index on userId + idempotencyKey to prevent duplicates
recoveryCaseSchema.index({userId: 1, idempotencyKey: 1}, {unique: true});

// Compound indexes for common queries
recoveryCaseSchema.index({userId: 1, status: 1, createdAt: -1}); // Filter by status
recoveryCaseSchema.index({userId: 1, promiseAt: 1, status: 1}); // Promise tracking
recoveryCaseSchema.index({userId: 1, promiseStatus: 1, promiseAt: 1}); // Promises due today, overdue
recoveryCaseSchema.index({customerId: 1, status: 1}); // Customer recovery status
recoveryCaseSchema.index({userId: 1, createdAt: -1}); // List all cases
recoveryCaseSchema.index({userId: 1, priority: -1, status: 1}); // Priority-based queries

// Step 7: Insights performance indexes
recoveryCaseSchema.index({userId: 1, status: 1, promiseAt: 1, promiseAmount: 1}); // Cash-in forecast

// Index creation logging
recoveryCaseSchema.on('index', (error) => {
  if (error) {
    console.error('[RecoveryCase] Index build error:', error);
  } else {
    console.log('[RecoveryCase] Indexes built successfully');
  }
});

module.exports = mongoose.model('RecoveryCase', recoveryCaseSchema);
