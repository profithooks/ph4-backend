/**
 * RestoreJob Model
 * 
 * Tracks data restore jobs and their status
 * Step 10: Data Export + Restore
 */
const mongoose = require('mongoose');

const restoreJobSchema = new mongoose.Schema(
  {
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetMode: {
      type: String,
      enum: ['NEW_BUSINESS', 'OVERWRITE'],
      required: true,
    },
    targetBusinessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    newBusinessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    confirmPhrase: String,
    status: {
      type: String,
      enum: ['QUEUED', 'VALIDATING', 'APPLYING', 'DONE', 'FAILED'],
      default: 'QUEUED',
      index: true,
    },
    progress: {
      phase: String,
      percent: Number,
      current: Number,
      total: Number,
      message: String,
    },
    uploadedFilePath: String,
    manifest: {
      formatVersion: String,
      exportedAt: Date,
      businessId: String,
      appVersion: String,
      counts: mongoose.Schema.Types.Mixed,
      checksums: mongoose.Schema.Types.Mixed,
      notes: [String],
    },
    result: {
      countsImported: mongoose.Schema.Types.Mixed,
      warnings: [String],
      newBusinessId: String,
    },
    error: {
      code: String,
      message: String,
      details: mongoose.Schema.Types.Mixed,
    },
    startedAt: Date,
    finishedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Compound indexes
restoreJobSchema.index({requestedBy: 1, createdAt: -1});
restoreJobSchema.index({status: 1, createdAt: 1});

const RestoreJob = mongoose.model('RestoreJob', restoreJobSchema);

module.exports = RestoreJob;
