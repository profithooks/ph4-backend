/**
 * UserSecurityState Model
 * 
 * Tracks security-related state for abuse prevention
 * Step 20: Security & Abuse Hardening
 */
const mongoose = require('mongoose');

const userSecurityStateSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    
    // OTP abuse tracking
    otpFailCount: {
      type: Number,
      default: 0,
    },
    otpLockedUntil: Date,
    lastOtpSentAt: Date,
    otpSentCountDay: {
      type: Number,
      default: 0,
    },
    otpSentCountDayResetAt: Date,
    
    // Recovery PIN abuse tracking
    pinFailCount: {
      type: Number,
      default: 0,
    },
    pinLockedUntil: Date,
    
    // Device/session tracking
    lastIp: String,
    lastUserAgent: String,
    lastSuccessfulLogin: Date,
    
    // Suspicious activity flags
    suspiciousActivityCount: {
      type: Number,
      default: 0,
    },
    lastSuspiciousActivityAt: Date,
    
    // Support spam tracking
    ticketsCreatedToday: {
      type: Number,
      default: 0,
    },
    ticketsResetAt: Date,
    messagesCreatedToday: {
      type: Number,
      default: 0,
    },
    messagesResetAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes
userSecurityStateSchema.index({ phone: 1 }, { unique: true });
userSecurityStateSchema.index({ otpLockedUntil: 1 });
userSecurityStateSchema.index({ pinLockedUntil: 1 });

const UserSecurityState = mongoose.model('UserSecurityState', userSecurityStateSchema);

module.exports = UserSecurityState;
