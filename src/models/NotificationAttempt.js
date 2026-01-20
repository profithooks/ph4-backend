/**
 * NotificationAttempt Model
 * 
 * Tracks delivery attempts for notifications across different channels
 * Implements queue/lease/retry pattern for reliable delivery
 */
const mongoose = require('mongoose');

const notificationAttemptSchema = new mongoose.Schema(
  {
    // Link to notification
    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      required: true,
      index: true,
    },
    
    // Delivery channel
    channel: {
      type: String,
      enum: ['IN_APP', 'PUSH', 'WHATSAPP', 'SMS', 'EMAIL'],
      required: true,
    },
    
    // Status lifecycle
    status: {
      type: String,
      enum: [
        'QUEUED',           // Waiting to be sent
        'LEASED',           // Being processed by worker
        'SENT',             // Successfully sent
        'FAILED',           // Permanently failed
        'RETRY_SCHEDULED',  // Failed but will retry
        'CANCELLED',        // Cancelled (e.g., user deleted)
      ],
      default: 'QUEUED',
      required: true,
      index: true,
    },
    
    // Attempt tracking
    attemptNo: {
      type: Number,
      default: 0,
      min: 0,
    },
    
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
    },
    
    // Scheduling
    nextAttemptAt: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Lease management (for queue/lease pattern)
    leasedUntil: {
      type: Date,
      index: true,
    },
    
    // Last error
    lastError: {
      code: {
        type: String,
      },
      message: {
        type: String,
      },
      retryable: {
        type: Boolean,
      },
      providerResponse: {
        type: mongoose.Schema.Types.Mixed,
      },
    },
    
    // Provider tracking
    providerMessageId: {
      type: String,
    },
    
    providerStatus: {
      type: String,
    },
    
    // Request tracing
    requestId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for queries
notificationAttemptSchema.index({notificationId: 1, createdAt: -1}); // Attempts per notification
notificationAttemptSchema.index({status: 1, nextAttemptAt: 1}); // Worker queue
notificationAttemptSchema.index({status: 1, leasedUntil: 1}); // Lease management
notificationAttemptSchema.index({channel: 1, status: 1}); // Channel stats

// RECOVERY LADDER: Unique index to prevent duplicate attempts (multi-instance safe)
notificationAttemptSchema.index(
  {notificationId: 1, channel: 1},
  {unique: true}
);

// Index creation logging
notificationAttemptSchema.on('index', (error) => {
  if (error) {
    console.error('[NotificationAttempt] Index build error:', error);
  } else {
    console.log('[NotificationAttempt] Indexes built successfully');
  }
});

module.exports = mongoose.model('NotificationAttempt', notificationAttemptSchema);
