/**
 * Migration Model
 * 
 * Tracks applied database migrations
 * Step 15: Release Candidate
 */
const mongoose = require('mongoose');

const migrationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    durationMs: {
      type: Number,
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED'],
      default: 'SUCCESS',
    },
    error: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const Migration = mongoose.model('Migration', migrationSchema);

module.exports = Migration;
