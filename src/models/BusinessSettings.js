/**
 * BusinessSettings model - Single source of truth for user business configuration
 */
const mongoose = require('mongoose');

const businessSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    recoveryEnabled: {
      type: Boolean,
      default: false,
    },
    autoFollowupEnabled: {
      type: Boolean,
      default: false,
    },
    ledgerEnabled: {
      type: Boolean,
      default: true, // Enabled by default (existing feature)
    },
    followupCadence: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'CUSTOM'],
      default: 'DAILY',
    },
    escalationDays: {
      type: Number,
      default: 7,
      min: [0, 'Escalation days cannot be negative'],
    },
    gracePeriodDays: {
      type: Number,
      default: 0,
      min: [0, 'Grace period days cannot be negative'],
    },
    channelsEnabled: {
      whatsapp: {
        type: Boolean,
        default: true,
      },
      sms: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
  },
);

// Ensure one settings doc per user
businessSettingsSchema.index({userId: 1}, {unique: true});

// Index creation logging
businessSettingsSchema.on('index', (error) => {
  if (error) {
    console.error('[BusinessSettings] Index build error:', error);
  } else {
    console.log('[BusinessSettings] Indexes built successfully');
  }
});

module.exports = mongoose.model('BusinessSettings', businessSettingsSchema);
