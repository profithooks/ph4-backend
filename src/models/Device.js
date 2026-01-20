/**
 * Device Model
 * 
 * Device binding and trusted device management
 * Step 9: Trust & Survival
 */
const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
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
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    deviceName: {
      type: String,
      default: 'Unknown Device',
    },
    platform: {
      type: String,
      enum: ['ios', 'android', 'web', 'unknown'],
      default: 'unknown',
    },
    osVersion: String,
    appVersion: String,
    modelName: String,
    status: {
      type: String,
      enum: ['TRUSTED', 'PENDING', 'BLOCKED'],
      default: 'PENDING',
      index: true,
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: Date,
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    blockedAt: Date,
    blockedReason: String,
  },
  {
    timestamps: true,
  }
);

// Compound indexes
deviceSchema.index({userId: 1, deviceId: 1}, {unique: true});
deviceSchema.index({businessId: 1, status: 1});
deviceSchema.index({userId: 1, status: 1, lastSeenAt: -1});

// Helper method to check if device is trusted
deviceSchema.methods.isTrusted = function () {
  return this.status === 'TRUSTED';
};

// Helper method to update last seen
deviceSchema.methods.updateLastSeen = async function () {
  this.lastSeenAt = new Date();
  return await this.save();
};

const Device = mongoose.model('Device', deviceSchema);

module.exports = Device;
