const mongoose = require('mongoose');

const followUpTaskSchema = new mongoose.Schema(
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
    channel: {
      type: String,
      enum: ['call', 'whatsapp', 'sms'],
      required: true,
    },
    dueAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'done', 'skipped'],
      default: 'pending',
    },
    followupStatus: {
      type: String,
      enum: ['OPEN', 'DUE_TODAY', 'OVERDUE', 'COMPLETED', 'ESCALATED'],
      default: 'OPEN',
    },
    balance: {
      type: Number,
      required: true,
    },
    note: {
      type: String,
      default: '',
    },
    title: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      enum: ['MANUAL', 'AUTO_PAYMENT_DUE', 'AUTO_PROMISE_MISSED', 'AUTO_BILL_UNPAID'],
      default: 'MANUAL',
    },
    reason: {
      type: String,
      default: 'outstanding_balance',
    },
    parentFollowupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FollowUpTask',
      default: null,
      index: true,
    },
    escalationLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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
followUpTaskSchema.index({userId: 1, idempotencyKey: 1}, {unique: true});

// Compound indexes for common queries
followUpTaskSchema.index({userId: 1, status: 1, dueAt: 1}); // Today's tasks, pending tasks
followUpTaskSchema.index({userId: 1, dueAt: 1}); // Date-based queries (due today, overdue)
followUpTaskSchema.index({userId: 1, createdAt: -1}); // List all tasks
followUpTaskSchema.index({customerId: 1, createdAt: -1}); // Customer timeline
followUpTaskSchema.index({userId: 1, customerId: 1, status: 1}); // Customer's pending tasks
followUpTaskSchema.index({userId: 1, followupStatus: 1, dueAt: 1}); // Filter by followup status

// Index creation logging
followUpTaskSchema.on('index', (error) => {
  if (error) {
    console.error('[FollowUpTask] Index build error:', error);
  } else {
    console.log('[FollowUpTask] Indexes built successfully');
  }
});

module.exports = mongoose.model('FollowUpTask', followUpTaskSchema);
