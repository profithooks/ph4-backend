/**
 * SupportTicket Model
 * 
 * Customer support tickets with SLA tracking
 * Step 11: Fairness & Support
 */
const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    category: {
      type: String,
      enum: ['BILLING', 'RECOVERY', 'SYNC', 'BUG', 'FEATURE', 'ACCOUNT', 'OTHER'],
      default: 'OTHER',
      index: true,
    },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM',
      index: true,
    },
    status: {
      type: String,
      enum: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },
    slaHours: {
      type: Number,
      default: 48, // Default for MEDIUM priority
    },
    dueAt: {
      type: Date,
      index: true,
    },
    lastReplyAt: Date,
    resolvedAt: Date,
    closedAt: Date,
    assignedTo: {
      type: String, // Support agent email
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
supportTicketSchema.index({businessId: 1, status: 1, createdAt: -1});
supportTicketSchema.index({status: 1, dueAt: 1}); // For SLA monitoring
supportTicketSchema.index({userId: 1, createdAt: -1});

// Virtual for SLA remaining
supportTicketSchema.virtual('slaRemaining').get(function () {
  if (!this.dueAt) return null;
  const now = new Date();
  const remaining = this.dueAt - now;
  return remaining > 0 ? remaining : 0;
});

// Virtual for SLA breached
supportTicketSchema.virtual('slaBreached').get(function () {
  if (!this.dueAt) return false;
  return new Date() > this.dueAt;
});

// Pre-save hook to set dueAt based on priority
supportTicketSchema.pre('save', function (next) {
  if (this.isNew && !this.dueAt) {
    // Set SLA hours based on priority
    if (this.priority === 'HIGH') {
      this.slaHours = 24;
    } else if (this.priority === 'MEDIUM') {
      this.slaHours = 48;
    } else {
      this.slaHours = 72;
    }
    
    // Calculate dueAt
    this.dueAt = new Date(Date.now() + this.slaHours * 60 * 60 * 1000);
  }
  next();
});

// Ensure virtuals are included in JSON
supportTicketSchema.set('toJSON', {virtuals: true});
supportTicketSchema.set('toObject', {virtuals: true});

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

module.exports = SupportTicket;
