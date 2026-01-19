/**
 * AttemptLog Model
 * Tracks contact attempts with customers (calls, WhatsApp, visits)
 */

const mongoose = require('mongoose');

const attemptLogSchema = new mongoose.Schema(
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
    entityType: {
      type: String,
      enum: ['FOLLOWUP_TASK', 'RECOVERY_CASE'],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['CALL', 'WHATSAPP', 'VISIT'],
      required: true,
    },
    outcome: {
      type: String,
      enum: ['NO_ANSWER', 'PROMISED', 'PAID', 'DENIED', 'RESCHEDULED', 'WRONG_NUMBER'],
      required: true,
    },
    note: {
      type: String,
      default: '',
    },
    promiseAt: {
      type: Date,
      default: null,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
attemptLogSchema.index({ customerId: 1, createdAt: -1 });
attemptLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model('AttemptLog', attemptLogSchema);
