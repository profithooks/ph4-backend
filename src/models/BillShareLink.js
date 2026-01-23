const mongoose = require('mongoose');

const billShareLinkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    lastAccessAt: {
      type: Date,
      default: null,
    },
    accessCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: false, // We manage createdAt manually
  },
);

// Compound index for quick lookups
billShareLinkSchema.index({userId: 1, billId: 1, status: 1});

const BillShareLink = mongoose.model('BillShareLink', billShareLinkSchema);

module.exports = BillShareLink;
