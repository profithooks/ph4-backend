const mongoose = require('mongoose');

const ledgerTransactionSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    note: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      enum: ['manual', 'recovery', 'adjustment'],
      default: 'manual',
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
ledgerTransactionSchema.index(
  {userId: 1, idempotencyKey: 1},
  {unique: true},
);

// Compound indexes for common queries
ledgerTransactionSchema.index({userId: 1, createdAt: -1}); // User's transactions timeline
ledgerTransactionSchema.index({userId: 1, customerId: 1, createdAt: -1}); // Customer ledger
ledgerTransactionSchema.index({customerId: 1, createdAt: -1}); // Customer queries
ledgerTransactionSchema.index({userId: 1, type: 1, createdAt: -1}); // Filter by type

// Index creation logging
ledgerTransactionSchema.on('index', (error) => {
  if (error) {
    console.error('[LedgerTransaction] Index build error:', error);
  } else {
    console.log('[LedgerTransaction] Indexes built successfully');
  }
});

module.exports = mongoose.model('LedgerTransaction', ledgerTransactionSchema);
