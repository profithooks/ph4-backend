/**
 * CronLock Model
 * 
 * Distributed lock for cron jobs to prevent duplicate execution
 * across multiple app instances (multi-pod deployment)
 * 
 * DESIGN:
 * - One document per cron job (identified by name)
 * - Lock acquired via atomic findOneAndUpdate
 * - Lock expires after lockDuration (9 minutes for 10-minute cron)
 * - Only ONE instance can hold lock at a time
 * 
 * USAGE:
 * const lock = await acquireLock('recovery_task_processing', 9 * 60 * 1000);
 * if (!lock.acquired) {
 *   console.log('Another instance is processing, skip');
 *   return;
 * }
 * // Execute job
 * await releaseLock('recovery_task_processing', lock.ownerId);
 */

const mongoose = require('mongoose');

const cronLockSchema = new mongoose.Schema(
  {
    // Cron job name (unique identifier)
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    
    // When lock expires (UTC timestamp)
    lockedUntil: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Instance ID that owns the lock (for debugging)
    ownerId: {
      type: String,
      required: true,
    },
    
    // Last execution stats (optional, for monitoring)
    lastExecutionAt: {
      type: Date,
    },
    
    lastExecutionDuration: {
      type: Number, // milliseconds
    },
    
    lastExecutionStatus: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'SKIPPED'],
    },
    
    lastExecutionStats: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Unique index on name (enforces one lock per cron job)
cronLockSchema.index({name: 1}, {unique: true});

// Index for lock expiry queries
cronLockSchema.index({lockedUntil: 1});

// Index creation logging
cronLockSchema.on('index', (error) => {
  if (error) {
    console.error('[CronLock] Index build error:', error);
  } else {
    console.log('[CronLock] Indexes built successfully');
  }
});

module.exports = mongoose.model('CronLock', cronLockSchema);
