/**
 * SupportTicketMessage Model
 * 
 * Messages/replies in support tickets
 * Step 11: Fairness & Support
 */
const mongoose = require('mongoose');

const supportTicketMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
      index: true,
    },
    senderType: {
      type: String,
      enum: ['CUSTOMER', 'SUPPORT'],
      required: true,
    },
    senderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    senderEmail: String, // For support agents
    senderName: String,
    message: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    isInternal: {
      type: Boolean,
      default: false, // Internal notes only visible to support
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
supportTicketMessageSchema.index({ticketId: 1, createdAt: 1});

const SupportTicketMessage = mongoose.model('SupportTicketMessage', supportTicketMessageSchema);

module.exports = SupportTicketMessage;
