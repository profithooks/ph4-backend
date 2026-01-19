const mongoose = require('mongoose');

/**
 * RecoveryEvent - Tracks idempotent state transitions
 * Prevents duplicate promise/status changes from sync replay
 */
const recoveryEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RecoveryCase',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['PROMISE', 'STATUS'],
      required: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    resultCaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RecoveryCase',
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Unique index on userId + idempotencyKey to prevent duplicate transitions
recoveryEventSchema.index({userId: 1, idempotencyKey: 1}, {unique: true});

module.exports = mongoose.model('RecoveryEvent', recoveryEventSchema);
