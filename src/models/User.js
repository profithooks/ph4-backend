/**
 * User model for authentication
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: function() {
        // Name required only if not OTP-only user
        return !this.mobile;
      },
      trim: true,
    },
    email: {
      type: String,
      required: function() {
        // Email required only if not OTP-only user  
        return !this.mobile;
      },
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    phoneE164: {
      type: String,
      unique: true,
      sparse: true, // Allow null values, only enforce uniqueness for non-null
      index: true,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    // OTP-only auth fields
    mobile: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true,
    },
    countryCode: {
      type: String,
      default: '+91',
    },
    businessName: {
      type: String,
      trim: true,
      maxlength: 60,
    },
    password: {
      type: String,
      // Password not required for OTP-based signups
      required: function () {
        // Password required only if phoneE164 is not provided
        return !this.phoneE164;
      },
      minlength: 6,
      select: false,
    },
    
    // Freemium Model - Entitlement
    planStatus: {
      type: String,
      enum: ['trial', 'free', 'pro'],
      default: 'trial',
      index: true,
    },
    trialEndsAt: {
      type: Date,
      // Set 30 days from now on user creation
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    planActivatedAt: {
      type: Date,
      default: null,
    },
    dailyWriteCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    dailyWriteDate: {
      type: String, // YYYY-MM-DD format
      default: () => new Date().toISOString().split('T')[0],
    },
    
    // Step 9: Trust & Survival - Account Recovery
    recoveryEnabled: {
      type: Boolean,
      default: false,
    },
    recoveryPinHash: {
      type: String,
      select: false,
    },
    recoveryEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
    recoveryUpdatedAt: Date,
  },
  {
    timestamps: true,
  },
);

// Hash password before saving (only if password exists)
userSchema.pre('save', async function (next) {
  // Skip if password not modified or doesn't exist (OTP users)
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Hash recovery PIN before saving (Step 9)
userSchema.pre('save', async function (next) {
  // Skip if recoveryPinHash not modified or doesn't exist
  if (!this.isModified('recoveryPinHash') || !this.recoveryPinHash) {
    return next();
  }
  // Only hash if it's a plain PIN (not already hashed)
  if (!this.recoveryPinHash.startsWith('$2')) {
    const salt = await bcrypt.genSalt(10);
    this.recoveryPinHash = await bcrypt.hash(this.recoveryPinHash, salt);
  }
  next();
});

// Auto-transition trial to free when expired (runs on every save)
userSchema.pre('save', async function (next) {
  // Only check if planStatus is trial
  if (this.planStatus === 'trial' && this.trialEndsAt) {
    const now = new Date();
    if (now >= this.trialEndsAt) {
      // Trial expired - transition to free
      this.planStatus = 'free';
      this.planActivatedAt = now;
      console.log(`[User] Trial expired for user ${this._id}, transitioned to free plan`);
    }
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/**
 * Ensure daily write counter is reset if date changed
 * Call this before every write operation
 */
userSchema.methods.ensureDailyWriteCounter = async function () {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  if (this.dailyWriteDate !== today) {
    // New day - reset counter
    this.dailyWriteCount = 0;
    this.dailyWriteDate = today;
    await this.save();
    console.log(`[User] Reset daily write counter for user ${this._id}`);
  }
  
  return this;
};

/**
 * Check if user can perform a write operation
 * Returns: { allowed: boolean, reason?: string, limit?: number, resetAt?: string }
 */
userSchema.methods.canWrite = function () {
  // Trial users: unlimited
  if (this.planStatus === 'trial') {
    return { allowed: true };
  }
  
  // Pro users: unlimited
  if (this.planStatus === 'pro') {
    return { allowed: true };
  }
  
  // Free users: check daily limit
  if (this.planStatus === 'free') {
    const FREE_DAILY_LIMIT = 10;
    
    if (this.dailyWriteCount >= FREE_DAILY_LIMIT) {
      // Calculate reset time (midnight IST of next day)
      const {getNextISTMidnight} = require('../utils/istTimezone');
      const resetAt = getNextISTMidnight();
      
      return {
        allowed: false,
        reason: 'Daily customer write limit reached',
        limit: FREE_DAILY_LIMIT,
        resetAt: resetAt.toISOString(),
      };
    }
    
    return { allowed: true };
  }
  
  // Unknown plan status - deny by default
  return {
    allowed: false,
    reason: 'Invalid plan status',
  };
};

/**
 * Increment daily write counter
 * Call this after a successful write operation
 */
userSchema.methods.incrementWriteCount = async function () {
  this.dailyWriteCount += 1;
  await this.save();
  console.log(`[User] Write count incremented for user ${this._id}: ${this.dailyWriteCount}`);
  return this;
};

// Index creation logging
userSchema.on('index', (error) => {
  if (error) {
    console.error('[User] Index build error:', error);
  } else {
    console.log('[User] Indexes built successfully');
  }
});

module.exports = mongoose.model('User', userSchema);
