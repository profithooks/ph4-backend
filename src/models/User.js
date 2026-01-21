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

// Compare password method
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
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
