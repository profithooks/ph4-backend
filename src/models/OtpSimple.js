/**
 * Simple OTP Model for Zero-Friction Auth
 * Stores OTPs with TTL (5 min expiry)
 */
const mongoose = require('mongoose');

const otpSimpleSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
      default: () => new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index - automatically delete expired OTPs
otpSimpleSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});

// Index for cleanup
otpSimpleSchema.index({createdAt: 1}, {expireAfterSeconds: 3600}); // Delete after 1 hour

const OtpSimple = mongoose.model('OtpSimple', otpSimpleSchema);

module.exports = OtpSimple;
