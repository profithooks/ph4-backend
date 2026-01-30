/**
 * DailyStats Model
 * 
 * Stores pre-computed daily statistics for business and global metrics
 * Generated once per day via cron (00:05 IST)
 */
const mongoose = require('mongoose');

const dailyStatsSchema = new mongoose.Schema({
  // Date key in IST format (YYYY-MM-DD)
  dateKey: {
    type: String,
    required: true,
    index: true,
  },
  
  // Scope: 'business' or 'global'
  scope: {
    type: String,
    required: true,
    enum: ['business', 'global'],
    index: true,
  },
  
  // Business ID (required for scope='business', null for scope='global')
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  
  // Computed metrics
  metrics: {
    billsCount: { type: Number, default: 0 },
    billedAmount: { type: Number, default: 0 },
    collectedAmount: { type: Number, default: 0 },
    pendingAmount: { type: Number, default: 0 },
    followupsCount: { type: Number, default: 0 },
  },
  
  // Projection flag (only for global scope when data is sparse)
  isProjected: {
    type: Boolean,
    default: false,
  },
  
  // When stats were generated
  generatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound unique index: one stat per (date, scope, business)
dailyStatsSchema.index(
  { dateKey: 1, scope: 1, businessId: 1 },
  { unique: true }
);

const DailyStats = mongoose.model('DailyStats', dailyStatsSchema);

module.exports = DailyStats;
