/**
 * OTP Attempt Model
 * Tracks all OTP request and verify attempts for audit and rate limiting
 * CRITICAL: Do NOT store actual OTP values
 */
const mongoose = require('mongoose');

const otpAttemptSchema = new mongoose.Schema({
  phoneE164: {
    type: String,
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['REQUEST', 'VERIFY'],
    required: true,
    index: true,
  },
  ok: {
    type: Boolean,
    required: true,
    default: false,
  },
  reason: {
    type: String,
    // Common reasons: 'SUCCESS', 'RATE_LIMIT', 'MSG91_FAIL', 'INVALID_OTP', 'NETWORK_ERROR'
  },
  ip: {
    type: String,
    index: true,
  },
  userAgent: {
    type: String,
  },
  meta: {
    type: mongoose.Schema.Types.Mixed,
    // Provider response snippet (sanitized - no OTP, no auth keys)
    // Example: { provider: 'MSG91', requestId: 'xyz', status: 'success' }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Compound index for efficient rate limiting queries
otpAttemptSchema.index({ phoneE164: 1, type: 1, createdAt: -1 });

// Compound index for IP-based rate limiting
otpAttemptSchema.index({ ip: 1, type: 1, createdAt: -1 });

// TTL index - automatically delete attempts older than 30 days
otpAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

// Static method to log an attempt
otpAttemptSchema.statics.logAttempt = async function (attemptData) {
  try {
    const attempt = await this.create(attemptData);
    return attempt;
  } catch (error) {
    console.error('[OtpAttempt] Failed to log attempt:', error);
    // Don't throw - logging failure shouldn't break OTP flow
    return null;
  }
};

// Static method to count recent attempts (for rate limiting)
otpAttemptSchema.statics.countRecent = async function ({
  phoneE164,
  ip,
  type,
  windowMinutes,
}) {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);

  const query = {
    type,
    createdAt: { $gte: cutoff },
  };

  // Rate limit by phone OR IP (whichever is stricter)
  if (phoneE164 && ip) {
    query.$or = [{ phoneE164 }, { ip }];
  } else if (phoneE164) {
    query.phoneE164 = phoneE164;
  } else if (ip) {
    query.ip = ip;
  } else {
    return 0;
  }

  return await this.countDocuments(query);
};

const OtpAttempt = mongoose.model('OtpAttempt', otpAttemptSchema);

module.exports = OtpAttempt;
