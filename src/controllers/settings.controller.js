/**
 * Settings Controller
 * 
 * Business settings including general settings and interest policy
 * Step 8: Interest Calculation + Financial Year (added interest functions)
 */
const asyncHandler = require('express-async-handler');
const BusinessSettings = require('../models/BusinessSettings');
const AppError = require('../utils/AppError');
const {getUserRole, isOwner} = require('../middleware/permission.middleware');
const logger = require('../utils/logger');

/**
 * GET /api/settings
 * Get business settings for logged-in user (auto-create if missing)
 * LEGACY endpoint - kept for backward compatibility
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
 * PUT /api/settings
 * Update business settings (partial update)
 * LEGACY endpoint - kept for backward compatibility
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

/**
 * GET /api/settings/interest-policy
 * Get interest policy settings
 * Step 8: Interest Calculation
 */
const getInterestPolicy = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  
  try {
    const settings = await BusinessSettings.getOrCreate(userId, businessId);
    
    res.success({
      interestEnabled: settings.interestEnabled,
      interestRatePctPerMonth: settings.interestRatePctPerMonth,
      interestGraceDays: settings.interestGraceDays,
      interestBasis: settings.interestBasis,
      interestRounding: settings.interestRounding,
      interestCapPctOfPrincipal: settings.interestCapPctOfPrincipal,
      interestApplyOn: settings.interestApplyOn,
      financialYearStartMonth: settings.financialYearStartMonth,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy,
    });
  } catch (error) {
    logger.error('[Settings] Get interest policy failed', error);
    throw error;
  }
});

/**
 * PATCH /api/settings/interest-policy
 * Update interest policy (owner only)
 * Step 8: Interest Calculation
 */
const updateInterestPolicy = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const role = getUserRole(req);
  
  // Owner only
  if (!isOwner(role)) {
    const error = new Error('Owner only');
    error.statusCode = 403;
    error.code = 'OWNER_ONLY';
    throw error;
  }
  
  try {
    const settings = await BusinessSettings.getOrCreate(userId, businessId);
    
    // Update fields
    const {
      interestEnabled,
      interestRatePctPerMonth,
      interestGraceDays,
      interestCapPctOfPrincipal,
      financialYearStartMonth,
    } = req.body;
    
    if (interestEnabled !== undefined) {
      settings.interestEnabled = Boolean(interestEnabled);
    }
    
    if (interestRatePctPerMonth !== undefined) {
      const rate = Number(interestRatePctPerMonth);
      if (isNaN(rate) || rate < 0 || rate > 10) {
        const error = new Error('Rate must be between 0 and 10% per month');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
      }
      settings.interestRatePctPerMonth = rate;
    }
    
    if (interestGraceDays !== undefined) {
      const grace = Number(interestGraceDays);
      if (isNaN(grace) || grace < 0 || grace > 365) {
        const error = new Error('Grace days must be between 0 and 365');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
      }
      settings.interestGraceDays = grace;
    }
    
    if (interestCapPctOfPrincipal !== undefined) {
      const cap = Number(interestCapPctOfPrincipal);
      if (isNaN(cap) || cap < 0 || cap > 500) {
        const error = new Error('Cap must be between 0 and 500% of principal');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
      }
      settings.interestCapPctOfPrincipal = cap;
    }
    
    if (financialYearStartMonth !== undefined) {
      const month = Number(financialYearStartMonth);
      if (isNaN(month) || month < 1 || month > 12) {
        const error = new Error('FY start month must be between 1 and 12');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
      }
      settings.financialYearStartMonth = month;
    }
    
    settings.updatedBy = userId;
    await settings.save();
    
    logger.info('[Settings] Interest policy updated', {userId, settings: settings.toObject()});
    
    res.success({
      interestEnabled: settings.interestEnabled,
      interestRatePctPerMonth: settings.interestRatePctPerMonth,
      interestGraceDays: settings.interestGraceDays,
      interestBasis: settings.interestBasis,
      interestRounding: settings.interestRounding,
      interestCapPctOfPrincipal: settings.interestCapPctOfPrincipal,
      interestApplyOn: settings.interestApplyOn,
      financialYearStartMonth: settings.financialYearStartMonth,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    logger.error('[Settings] Update interest policy failed', error);
    throw error;
  }
});

module.exports = {
  getSettings: exports.getSettings,
  updateSettings: exports.updateSettings,
  getInterestPolicy,
  updateInterestPolicy,
};
