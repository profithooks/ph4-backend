/**
 * Business settings controller
 */
const BusinessSettings = require('../models/BusinessSettings');
const AppError = require('../utils/AppError');

/**
 * @route   GET /api/settings
 * @desc    Get business settings for logged-in user (auto-create if missing)
 * @access  Private
 */
exports.getSettings = async (req, res, next) => {
  try {
    let settings = await BusinessSettings.findOne({
      userId: req.user._id,
    });

    // Auto-create with defaults if missing
    if (!settings) {
      settings = await BusinessSettings.create({
        userId: req.user._id,
      });
    }

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/settings
 * @desc    Update business settings (partial update)
 * @access  Private
 */
exports.updateSettings = async (req, res, next) => {
  try {
    const {
      recoveryEnabled,
      autoFollowupEnabled,
      ledgerEnabled,
      followupCadence,
      escalationDays,
      gracePeriodDays,
      channelsEnabled,
      clientUpdatedAt, // ETag-style conflict detection
    } = req.body;

    // Validate numeric ranges
    if (escalationDays !== undefined && escalationDays < 0) {
      return next(
        new AppError('Escalation days cannot be negative', 400, 'VALIDATION_ERROR'),
      );
    }

    if (gracePeriodDays !== undefined && gracePeriodDays < 0) {
      return next(
        new AppError('Grace period days cannot be negative', 400, 'VALIDATION_ERROR'),
      );
    }

    // Validate followupCadence enum
    if (
      followupCadence !== undefined &&
      !['DAILY', 'WEEKLY', 'CUSTOM'].includes(followupCadence)
    ) {
      return next(
        new AppError(
          'Invalid followup cadence. Must be DAILY, WEEKLY, or CUSTOM',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    // Build update object (only include provided fields)
    const updateFields = {};

    if (recoveryEnabled !== undefined) {
      updateFields.recoveryEnabled = recoveryEnabled;
    }
    if (autoFollowupEnabled !== undefined) {
      updateFields.autoFollowupEnabled = autoFollowupEnabled;
    }
    if (ledgerEnabled !== undefined) {
      updateFields.ledgerEnabled = ledgerEnabled;
    }
    if (followupCadence !== undefined) {
      updateFields.followupCadence = followupCadence;
    }
    if (escalationDays !== undefined) {
      updateFields.escalationDays = escalationDays;
    }
    if (gracePeriodDays !== undefined) {
      updateFields.gracePeriodDays = gracePeriodDays;
    }
    if (channelsEnabled !== undefined) {
      // Handle nested channelsEnabled partial update
      if (channelsEnabled.whatsapp !== undefined) {
        updateFields['channelsEnabled.whatsapp'] = channelsEnabled.whatsapp;
      }
      if (channelsEnabled.sms !== undefined) {
        updateFields['channelsEnabled.sms'] = channelsEnabled.sms;
      }
    }

    // Find or create settings
    let settings = await BusinessSettings.findOne({
      userId: req.user._id,
    });

    if (!settings) {
      // Create new settings with provided values
      settings = await BusinessSettings.create({
        userId: req.user._id,
        ...updateFields,
      });
    } else {
      // ETag-style conflict detection
      if (clientUpdatedAt !== undefined) {
        const clientTime = new Date(clientUpdatedAt).getTime();
        const serverTime = new Date(settings.updatedAt).getTime();
        
        if (clientTime < serverTime) {
          // Client is stale, return 409 with latest settings
          return res.status(409).json({
            success: false,
            error: 'SETTINGS_CONFLICT',
            message: 'Settings were updated elsewhere. Please use the latest version.',
            data: settings, // Return latest settings
          });
        }
      }

      // Update existing settings
      settings = await BusinessSettings.findOneAndUpdate(
        {userId: req.user._id},
        {$set: updateFields},
        {
          new: true,
          runValidators: true,
        },
      );
    }

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};
