/**
 * ResetJob Model
 * 
 * Tracks business reset jobs with auto-backup
 * Step 22: One-Button Business Reset
 */
const mongoose = require('mongoose');

const resetJobSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['QUEUED', 'BACKING_UP', 'RESETTING', 'DONE', 'FAILED'],
      default: 'QUEUED',
      index: true,
    },
    backupExportJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExportJob',
    },
    backupDownloadUrl: String,
    progress: {
      phase: String,
      percent: Number,
      message: String,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    startedAt: Date,
    finishedAt: Date,
    error: {
      code: String,
      message: String,
    },
    requestId: String,
    
    // Post-reset integrity report
    integrityReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IntegrityReport',
    },
    
    // Stats
    stats: {
      customersDeleted: Number,
      billsDeleted: Number,
      followupsDeleted: Number,
      recoveriesDeleted: Number,
      notificationsDeleted: Number,
      supportTicketsDeleted: Number,
      idempotencyKeysDeleted: Number,
      devicesCleared: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
resetJobSchema.index({ businessId: 1, createdAt: -1 });
resetJobSchema.index({ status: 1, createdAt: -1 });

const ResetJob = mongoose.model('ResetJob', resetJobSchema);

module.exports = ResetJob;
