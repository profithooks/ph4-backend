/**
 * Notification Model
 * 
 * Represents a notification to be sent to a user/customer
 * Independent of transport channel (IN_APP, PUSH, WHATSAPP, SMS)
 */
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    // Business context
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      index: true,
    },
    
    // Notification type
    kind: {
      type: String,
      enum: [
        // New kinds (per NOTIFICATIONS_SPEC.md)
        'OVERDUE_ALERT',
        'DUE_TODAY',
        'PROMISE_DUE_TODAY',
        'PROMISE_BROKEN',
        'FOLLOWUP_DUE',
        'PAYMENT_RECEIVED',
        'DEVICE_APPROVAL_REQUIRED',
        'DAILY_SUMMARY',
        'CREDIT_LIMIT_WARN',
        // Legacy kinds (for backward compatibility)
        'FOLLOWUP',           // Follow-up reminder
        'PROMISE_REMINDER',   // Promise due reminder
        'OVERDUE',            // Overdue payment
        'SYSTEM',             // System notifications
        'BILL_CREATED',       // Bill created
      ],
      required: true,
      index: true,
    },
    
    // Content
    title: {
      type: String,
      required: true,
    },
    
    body: {
      type: String,
      required: true,
    },
    
    // Target channels
    channels: {
      type: [String],
      enum: ['IN_APP', 'PUSH', 'WHATSAPP', 'SMS', 'EMAIL'],
      default: ['IN_APP'],
    },
    
    // Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      // Can include: followupId, billId, recoveryId, etc.
    },
    
    // Read status (for IN_APP notifications)
    readAt: {
      type: Date,
    },
    
    // Idempotency
    idempotencyKey: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
notificationSchema.index({userId: 1, createdAt: -1}); // User's notification feed
notificationSchema.index({customerId: 1, createdAt: -1}); // Customer timeline
notificationSchema.index({userId: 1, kind: 1, createdAt: -1}); // Filter by kind
notificationSchema.index({userId: 1, readAt: 1}); // Unread notifications

// Idempotency index
notificationSchema.index({userId: 1, idempotencyKey: 1}, {
  unique: true,
  partialFilterExpression: {idempotencyKey: {$exists: true}},
});

module.exports = mongoose.model('Notification', notificationSchema);
