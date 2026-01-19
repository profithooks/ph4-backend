/**
 * User model for authentication
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
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
