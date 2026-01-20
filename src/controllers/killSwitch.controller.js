/**
 * Kill-Switch Controller
 * 
 * Manages global and per-feature kill-switches
 * Step 23: Go-Live & Rollout Control
 */
const asyncHandler = require('express-async-handler');
const BusinessSettings = require('../models/BusinessSettings');
const AuditEvent = require('../models/AuditEvent');
const Notification = require('../models/Notification');
const NotificationAttempt = require('../models/NotificationAttempt');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const GLOBAL_PAUSE_PHRASE = 'PAUSE_SYSTEM';

/**
 * PATCH /api/v1/settings/kill-switch
 * Update global or feature kill-switches
 */
const updateKillSwitches = asyncHandler(async (req, res) => {
  const { globalKillSwitch, featureKillSwitches, confirmPhrase } = req.body;
  const businessId = req.user.businessId;
  const userId = req.user._id;

  // If setting global kill-switch to true, require phrase
  if (globalKillSwitch === true) {
    if (confirmPhrase !== GLOBAL_PAUSE_PHRASE) {
      throw new AppError(
        `To pause the entire system, type exactly: ${GLOBAL_PAUSE_PHRASE}`,
        400,
        'VALIDATION_ERROR',
        { requiredPhrase: GLOBAL_PAUSE_PHRASE }
      );
    }
  }

  // Get or create settings
  const settings = await BusinessSettings.getOrCreate(userId, businessId);

  const changes = [];

  // Update global kill-switch
  if (globalKillSwitch !== undefined) {
    const wasEnabled = settings.globalKillSwitch;
    settings.globalKillSwitch = globalKillSwitch;
    
    if (globalKillSwitch && !wasEnabled) {
      settings.globalKillSwitchActivatedAt = new Date();
      settings.globalKillSwitchActivatedBy = userId;
      changes.push('global_enabled');
    } else if (!globalKillSwitch && wasEnabled) {
      changes.push('global_disabled');
    }
  }

  // Update feature kill-switches
  if (featureKillSwitches) {
    if (!settings.featureKillSwitches) {
      settings.featureKillSwitches = {};
    }

    for (const [feature, enabled] of Object.entries(featureKillSwitches)) {
      const wasEnabled = settings.featureKillSwitches[feature];
      settings.featureKillSwitches[feature] = enabled;
      
      if (enabled && !wasEnabled) {
        changes.push(`feature_${feature}_enabled`);
      } else if (!enabled && wasEnabled) {
        changes.push(`feature_${feature}_disabled`);
      }
    }
    
    // Mark as modified for Mongoose to detect nested object change
    settings.markModified('featureKillSwitches');
  }

  settings.updatedBy = userId;
  await settings.save();

  // Create audit events for each change
  for (const change of changes) {
    const action = change.includes('global')
      ? (change.includes('enabled') ? 'SYSTEM_PAUSED' : 'SYSTEM_RESUMED')
      : (change.includes('enabled') ? 'FEATURE_PAUSED' : 'FEATURE_RESUMED');
    
    await AuditEvent.create({
      at: new Date(),
      businessId,
      actorUserId: userId,
      actorRole: 'OWNER',
      action,
      entityType: 'SYSTEM',
      metadata: {
        change,
        globalKillSwitch: settings.globalKillSwitch,
        featureKillSwitches: settings.featureKillSwitches,
        requestId: req.requestId,
      },
    });
  }

  // Create in-app notification for global pause
  if (globalKillSwitch === true && changes.includes('global_enabled')) {
    try {
      const notification = await Notification.create({
        businessId,
        userId,
        kind: 'SYSTEM',
        title: 'System Paused',
        body: 'The system has been paused. Only read-only operations are allowed.',
        channels: ['IN_APP'],
        metadata: {
          action: 'SYSTEM_PAUSED',
          activatedAt: settings.globalKillSwitchActivatedAt,
        },
      });

      await NotificationAttempt.create({
        notificationId: notification._id,
        channel: 'IN_APP',
        status: 'SENT',
        attemptNo: 1,
        nextAttemptAt: new Date(),
      });
    } catch (error) {
      logger.error('[KillSwitch] Failed to create notification', error);
    }
  }

  logger.info('[KillSwitch] Kill-switches updated', {
    businessId,
    changes,
    globalKillSwitch: settings.globalKillSwitch,
  });

  res.success({
    killSwitches: {
      globalKillSwitch: settings.globalKillSwitch,
      globalKillSwitchActivatedAt: settings.globalKillSwitchActivatedAt,
      featureKillSwitches: settings.featureKillSwitches || {},
    },
    message: changes.length > 0 ? 'Kill-switches updated successfully' : 'No changes made',
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

/**
 * GET /api/v1/settings/kill-switch
 * Get current kill-switch status
 */
const getKillSwitchStatus = asyncHandler(async (req, res) => {
  const businessId = req.user.businessId;
  const userId = req.user._id;

  const settings = await BusinessSettings.getOrCreate(userId, businessId);

  res.success({
    killSwitches: {
      globalKillSwitch: settings.globalKillSwitch || false,
      globalKillSwitchActivatedAt: settings.globalKillSwitchActivatedAt,
      globalKillSwitchActivatedBy: settings.globalKillSwitchActivatedBy,
      featureKillSwitches: settings.featureKillSwitches || {
        recoveryEngine: false,
        followupEngine: false,
        offlineSync: false,
        notifications: false,
        insights: false,
        backupRestore: false,
      },
    },
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

module.exports = {
  updateKillSwitches,
  getKillSwitchStatus,
};
