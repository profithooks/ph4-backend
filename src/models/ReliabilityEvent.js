/**
 * ReliabilityEvent Model
 * 
 * Tracks all failed mutations, engine actions, and sync failures
 * for end-to-end traceability and diagnostics
 */
const mongoose = require('mongoose');

const reliabilityEventSchema = new mongoose.Schema(
  {
    // Request tracking
    requestId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Timestamp
    at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    
    // Event source
    layer: {
      type: String,
      enum: ['backend', 'frontend'],
      required: true,
    },
    
    // Event type
    kind: {
      type: String,
      enum: ['WRITE_FAIL', 'ENGINE_FAIL', 'SYNC_FAIL', 'NOTIF_FAIL'],
      required: true,
      index: true,
    },
    
    // Request context
    route: {
      type: String,
      required: true,
    },
    
    method: {
      type: String,
      required: true,
    },
    
    // User context
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    
    // Entity context
    entityType: {
      type: String,
    },
    
    entityId: {
      type: String,
    },
    
    // Error details
    code: {
      type: String,
      required: true,
      index: true,
    },
    
    message: {
      type: String,
      required: true,
    },
    
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
    
    retryable: {
      type: Boolean,
      default: false,
    },
    
    status: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common queries
reliabilityEventSchema.index({userId: 1, at: -1});
reliabilityEventSchema.index({businessId: 1, at: -1});
reliabilityEventSchema.index({kind: 1, at: -1});
reliabilityEventSchema.index({requestId: 1, at: -1});

// TTL index - automatically delete events older than 30 days
reliabilityEventSchema.index({at: 1}, {expireAfterSeconds: 30 * 24 * 60 * 60});

module.exports = mongoose.model('ReliabilityEvent', reliabilityEventSchema);
