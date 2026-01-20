/**
 * IdempotencyKey Model
 * 
 * Stores idempotency keys and their responses to prevent duplicate operations
 * Critical for offline-first sync where same operation may be replayed
 */
const mongoose = require('mongoose');

const idempotencyKeySchema = new mongoose.Schema(
  {
    // The idempotency key (UUID from client)
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
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
    
    // Request context
    method: {
      type: String,
      required: true,
    },
    
    path: {
      type: String,
      required: true,
    },
    
    // Request hash for debugging (optional)
    requestHash: {
      type: String,
    },
    
    // Stored response
    responseStatus: {
      type: Number,
      required: true,
    },
    
    responseBody: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    
    // Metadata
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    
    // Optional: Track if this was a successful operation
    wasSuccessful: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound indexes for common queries
idempotencyKeySchema.index({key: 1, userId: 1});
idempotencyKeySchema.index({userId: 1, createdAt: -1});

// TTL index - automatically delete records older than 7 days
// Idempotency is only needed for a short window (offline replay)
idempotencyKeySchema.index({createdAt: 1}, {expireAfterSeconds: 7 * 24 * 60 * 60});

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);
