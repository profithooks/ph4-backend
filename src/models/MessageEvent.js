/**
 * MessageEvent model - Stores message proof events idempotently
 */
const mongoose = require('mongoose');

const messageEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer ID is required'],
      index: true,
    },
    channel: {
      type: String,
      enum: ['WHATSAPP', 'SMS', 'CALL', 'OTHER'],
      default: 'WHATSAPP',
      required: true,
    },
    templateKey: {
      type: String,
      required: [true, 'Template key is required'],
      trim: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Payload is required'],
    },
    status: {
      type: String,
      enum: ['CREATED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED'],
      default: 'CREATED',
      required: true,
    },
    provider: {
      type: String,
      enum: ['MOCK', 'GUPSHUP', 'META', 'OTHER'],
      default: 'MOCK',
      required: true,
    },
    providerMessageId: {
      type: String,
      trim: true,
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextAttemptAt: {
      type: Date,
      index: true,
    },
    lastAttemptAt: {
      type: Date,
    },
    lastError: {
      type: String,
    },
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
    },
    lockUntil: {
      type: Date,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: [true, 'Idempotency key is required'],
      trim: true,
    },
    requestId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

// Unique index for idempotency
messageEventSchema.index({userId: 1, idempotencyKey: 1}, {unique: true});

// Index for customer timeline queries
messageEventSchema.index({customerId: 1, createdAt: -1});

// Index for delivery scheduler (find pending messages)
messageEventSchema.index({status: 1, nextAttemptAt: 1});

// Index for lease management
messageEventSchema.index({lockUntil: 1});

// Additional indexes for queries
messageEventSchema.index({userId: 1, createdAt: -1}); // User's message history
messageEventSchema.index({userId: 1, status: 1, createdAt: -1}); // Filter by status

// Index creation logging
messageEventSchema.on('index', (error) => {
  if (error) {
    console.error('[MessageEvent] Index build error:', error);
  } else {
    console.log('[MessageEvent] Indexes built successfully');
  }
});

module.exports = mongoose.model('MessageEvent', messageEventSchema);
