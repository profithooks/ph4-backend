/**
 * AuditEvent Model
 * 
 * Immutable audit trail for critical operations
 * Tracks credit limit changes, breaches, and overrides
 */
const mongoose = require('mongoose');

const auditEventSchema = new mongoose.Schema(
  {
    // When
    at: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    
    // Business context
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    
    // Who performed the action
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    
    actorRole: {
      type: String,
      enum: ['OWNER', 'ADMIN', 'STAFF', 'SYSTEM'],
      required: true,
    },
    
    // What action
    action: {
      type: String,
      enum: [
        // Credit Control (Step 4)
        'CREDIT_LIMIT_SET',
        'CREDIT_LIMIT_BREACH_BLOCK',
        'CREDIT_LIMIT_OVERRIDE',
        
        // Bill Operations (Step 5)
        'BILL_CREATED',
        'BILL_UPDATED',
        'BILL_DELETED',
        'BILL_STATUS_CHANGED',
        
        // Customer Operations (Step 5)
        'CUSTOMER_CREATED',
        'CUSTOMER_UPDATED',
        'CUSTOMER_DELETED',
        
        // Follow-Up Operations (Step 5)
        'FOLLOWUP_CREATED',
        'FOLLOWUP_UPDATED',
        'FOLLOWUP_STATUS_CHANGED',
        'FOLLOWUP_DELETED',
        
        // Recovery Operations (Step 5-6)
        'RECOVERY_UPDATED',
        'PROMISE_CREATED',
        'PROMISE_UPDATED',
        'PROMISE_CANCELLED',
        'PROMISE_BROKEN',         // Step 6: Promise marked as broken
      ],
      required: true,
      index: true,
    },
    
    // What entity was affected
    entityType: {
      type: String,
      enum: ['CUSTOMER', 'BILL', 'LEDGER', 'FOLLOWUP', 'RECOVERY', 'PROMISE', 'RECOVERY_CASE'],
      required: true,
    },
    
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    
    // Customer context (for filtering)
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      index: true,
    },
    
    // Delete/override reason (required for destructive ops)
    reason: {
      type: String,
    },
    
    // Change tracking (for updates)
    diff: {
      before: mongoose.Schema.Types.Mixed,    // State before change (capped)
      after: mongoose.Schema.Types.Mixed,     // State after change (capped)
      changedKeys: [String],                  // List of changed field names
    },
    
    // Details
    metadata: {
      // Request trace
      requestId: String,
      
      // Credit limit specific (from Step 4)
      exposureSnapshot: {
        currentOutstanding: Number,
        attemptedDelta: Number,
        resultingExposure: Number,
        limit: Number,
        grace: Number,
        threshold: Number,
      },
      
      // Entity context
      billId: mongoose.Schema.Types.ObjectId,
      billNo: String,
      billAmount: Number,
      customerName: String,
      
      // Additional context
      notes: String,
    },
    
    // Optional tracking
    ip: String,
    userAgent: String,
  },
  {
    timestamps: true,  // Adds createdAt, updatedAt
  }
);

// Compound indexes for queries
auditEventSchema.index({entityType: 1, entityId: 1, createdAt: -1}); // Entity audit trail
auditEventSchema.index({actorUserId: 1, createdAt: -1}); // User actions
auditEventSchema.index({action: 1, createdAt: -1}); // Action type queries
auditEventSchema.index({businessId: 1, createdAt: -1}); // Business audit log
auditEventSchema.index({customerId: 1, createdAt: -1}); // Customer-specific audit

// TTL index: Keep audit events for 1 year (regulatory compliance)
auditEventSchema.index({createdAt: 1}, {expireAfterSeconds: 365 * 24 * 60 * 60});

module.exports = mongoose.model('AuditEvent', auditEventSchema);
