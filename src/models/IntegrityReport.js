/**
 * IntegrityReport Model
 * 
 * Tracks data integrity check results and repairs
 * Step 21: Data Integrity & Reconciliation
 */
const mongoose = require('mongoose');

const integrityCheckSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    enum: [
      'TODAY_COUNTERS',
      'CUSTOMER_OUTSTANDING',
      'PROMISE_BROKEN_FLAGS',
      'IDEMPOTENCY_UNIQUENESS',
      'NOTIFICATION_ATTEMPT_TRANSITIONS',
    ],
  },
  status: {
    type: String,
    enum: ['PASS', 'WARN', 'FAIL'],
    required: true,
  },
  expected: mongoose.Schema.Types.Mixed,
  actual: mongoose.Schema.Types.Mixed,
  sampleIds: [String],
  details: String,
  canRepair: {
    type: Boolean,
    default: false,
  },
}, { _id: false });

const integrityRepairSchema = new mongoose.Schema({
  code: String,
  countFixed: Number,
  sampleIds: [String],
  details: String,
}, { _id: false });

const integrityReportSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    runAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    status: {
      type: String,
      enum: ['PASS', 'WARN', 'FAIL'],
      required: true,
    },
    checks: [integrityCheckSchema],
    repaired: [integrityRepairSchema],
    requestId: String,
    triggeredBy: {
      type: String,
      enum: ['CRON', 'MANUAL'],
      default: 'CRON',
    },
    durationMs: Number,
  },
  {
    timestamps: true,
  }
);

// Indexes
integrityReportSchema.index({ businessId: 1, runAt: -1 });
integrityReportSchema.index({ status: 1, runAt: -1 });

const IntegrityReport = mongoose.model('IntegrityReport', integrityReportSchema);

module.exports = IntegrityReport;
