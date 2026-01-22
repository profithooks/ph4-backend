/**
 * BusinessSettings Model
 * 
 * Business-wide configuration including interest policy
 * Step 8: Interest Calculation + Financial Year
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
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    
    // Interest Policy
    interestEnabled: {
      type: Boolean,
      default: false,
    },
    interestRatePctPerMonth: {
      type: Number,
      default: 2,
      min: 0,
      max: 10, // Safety cap at 10% per month
    },
    interestGraceDays: {
      type: Number,
      default: 0,
      min: 0,
      max: 365,
    },
    interestBasis: {
      type: String,
      enum: ['DAILY_SIMPLE'],
      default: 'DAILY_SIMPLE',
    },
    interestRounding: {
      type: String,
      enum: ['NEAREST_RUPEE'],
      default: 'NEAREST_RUPEE',
    },
    interestCapPctOfPrincipal: {
      type: Number,
      default: 100,
      min: 0,
      max: 500, // Max 500% of principal
    },
    interestApplyOn: {
      type: String,
      enum: ['OVERDUE_ONLY'],
      default: 'OVERDUE_ONLY',
    },
    
    // Financial Year
    financialYearStartMonth: {
      type: Number,
      default: 4, // April (India FY)
      min: 1,
      max: 12,
    },
    
    // Step 11: Plan & Billing
    planName: {
      type: String,
      enum: ['FREE', 'PRO'],
      default: 'FREE',
    },
    seatsIncluded: {
      type: Number,
      default: 2, // 1 owner + 1 staff
    },
    premiumInsightsEnabled: {
      type: Boolean,
      default: false,
    },
    premiumInsightsCustomerCap: {
      type: Number,
      default: 50, // FREE plan limit
    },
    planEffectiveAt: Date,
    planUpdatedAt: Date,
    
    // Step 9: Recovery & Follow-up Engine Settings
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
      default: true,
    },
    followupCadence: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'CUSTOM'],
      default: 'DAILY',
    },
    escalationDays: {
      type: Number,
      default: 7,
      min: 0,
    },
    gracePeriodDays: {
      type: Number,
      default: 0,
      min: 0,
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
    
    // Step 17: Pilot Mode
    pilotModeEnabled: {
      type: Boolean,
      default: false,
    },
    pilotModeEnabledAt: Date,
    pilotModeEnabledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    pilotModeProfile: {
      type: String,
      enum: ['KARAD_V1'],
      default: 'KARAD_V1',
    },
    
    // Step 23: Kill-Switches (Go-Live & Rollout Control)
    globalKillSwitch: {
      type: Boolean,
      default: false,
    },
    globalKillSwitchActivatedAt: Date,
    globalKillSwitchActivatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    featureKillSwitches: {
      recoveryEngine: {
        type: Boolean,
        default: false,
      },
      followupEngine: {
        type: Boolean,
        default: false,
      },
      offlineSync: {
        type: Boolean,
        default: false,
      },
      notifications: {
        type: Boolean,
        default: false,
      },
      insights: {
        type: Boolean,
        default: false,
      },
      backupRestore: {
        type: Boolean,
        default: false,
      },
    },
    
    // Audit fields
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
businessSettingsSchema.index({userId: 1}, {unique: true});

// Helper method to get or create default settings
businessSettingsSchema.statics.getOrCreate = async function (userId, businessId) {
  let settings = await this.findOne({userId});
  
  if (!settings) {
    settings = await this.create({
      userId,
      businessId: businessId || userId,
    });
  }
  
  return settings;
};

const BusinessSettings = mongoose.model('BusinessSettings', businessSettingsSchema);

module.exports = BusinessSettings;
