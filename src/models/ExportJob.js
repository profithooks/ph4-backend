/**
 * ExportJob Model
 * 
 * Tracks data export jobs and their status
 * Step 10: Data Export + Restore
 */
const mongoose = require('mongoose');

const exportJobSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
      enum: ['QUEUED', 'RUNNING', 'DONE', 'FAILED'],
      default: 'QUEUED',
      index: true,
    },
    filePath: String,
    fileSize: Number,
    downloadUrl: String,
    manifest: {
      formatVersion: String,
      exportedAt: Date,
      businessId: String,
      appVersion: String,
      counts: mongoose.Schema.Types.Mixed,
      checksums: mongoose.Schema.Types.Mixed,
      notes: [String],
    },
    error: {
      code: String,
      message: String,
      details: mongoose.Schema.Types.Mixed,
    },
    startedAt: Date,
    finishedAt: Date,
    expiresAt: Date, // Auto-delete after 7 days
  },
  {
    timestamps: true,
  }
);

// Compound indexes
exportJobSchema.index({businessId: 1, createdAt: -1});
exportJobSchema.index({status: 1, createdAt: 1});
exportJobSchema.index({expiresAt: 1}, {expireAfterSeconds: 0}); // TTL index

const ExportJob = mongoose.model('ExportJob', exportJobSchema);

module.exports = ExportJob;
