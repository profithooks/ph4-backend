/**
 * Pilot Mode Controller
 * 
 * Enables fast onboarding with safe defaults
 * Step 17: Launch Readiness - Local Pilot Mode
 */
const asyncHandler = require('express-async-handler');
const BusinessSettings = require('../models/BusinessSettings');
const Customer = require('../models/Customer');
const Bill = require('../models/Bill');
const RecoveryCase = require('../models/RecoveryCase');
const AuditEvent = require('../models/AuditEvent');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Enable or disable pilot mode
 * PATCH /api/v1/settings/pilot-mode
 */
const togglePilotMode = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { enabled } = req.body;
  
  if (typeof enabled !== 'boolean') {
    throw new AppError('enabled must be a boolean', 400, 'VALIDATION_ERROR');
  }
  
  // Get or create settings
  let settings = await BusinessSettings.findOne({ userId });
  
  if (!settings) {
    settings = await BusinessSettings.create({
      userId,
      businessId: userId,
    });
  }
  
  const wasPreviouslyEnabled = settings.pilotModeEnabled;
  
  // Update pilot mode
  settings.pilotModeEnabled = enabled;
  
  if (enabled && !wasPreviouslyEnabled) {
    // Enabling for first time
    settings.pilotModeEnabledAt = new Date();
    settings.pilotModeEnabledBy = userId;
    
    // Apply safe defaults (idempotent - only set if undefined/null)
    await applyPilotDefaults(settings, userId);
    
    // Create audit event
    await AuditEvent.create({
      at: new Date(),
      businessId: userId,
      actorUserId: userId,
      actorRole: 'OWNER',
      action: 'PILOT_MODE_ENABLED',
      entityType: 'BUSINESS_SETTINGS',
      entityId: settings._id,
      requestId: req.requestId,
      metadata: {
        profile: settings.pilotModeProfile,
      },
    });
    
    logger.info(`[PilotMode] Enabled for business ${userId}`);
  } else if (!enabled && wasPreviouslyEnabled) {
    // Disabling
    await AuditEvent.create({
      at: new Date(),
      businessId: userId,
      actorUserId: userId,
      actorRole: 'OWNER',
      action: 'PILOT_MODE_DISABLED',
      entityType: 'BUSINESS_SETTINGS',
      entityId: settings._id,
      requestId: req.requestId,
    });
    
    logger.info(`[PilotMode] Disabled for business ${userId}`);
  }
  
  settings.updatedBy = userId;
  await settings.save();
  
  res.success({
    pilotModeEnabled: settings.pilotModeEnabled,
    pilotModeProfile: settings.pilotModeProfile,
    pilotModeEnabledAt: settings.pilotModeEnabledAt,
    defaultsApplied: enabled && !wasPreviouslyEnabled,
  });
});

/**
 * Apply pilot mode defaults
 * Only sets values if they are undefined/null (idempotent)
 */
async function applyPilotDefaults(settings, userId) {
  // P0 Reliability: Always enabled (nothing to set)
  // Offline sync is frontend-only
  
  // P1 Recovery Engine: Conservative defaults
  // (If you have recovery engine toggles, set them here)
  // For now, no specific fields to set as chase list is always computed
  
  // P2 Insights: Enabled (read-only, no writes)
  // Already available by default
  
  // Interest: Keep OFF
  if (settings.interestEnabled === undefined || settings.interestEnabled === null) {
    settings.interestEnabled = false;
  }
  
  // P1 Hard Control: Credit limits OFF by default
  // Per-customer setting, nothing to do here
  
  // P3 Trust: Device binding already enabled if built
  // App lock is frontend suggestion
  
  // P4 Support: Already enabled
  // No specific toggle needed
  
  // Keep existing settings untouched
  logger.info(`[PilotMode] Defaults applied (idempotent) for business ${userId}`);
}

/**
 * Get pilot mode checklist
 * GET /api/v1/pilot/checklist
 */
const getPilotChecklist = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  
  // Check if pilot mode is enabled
  const settings = await BusinessSettings.findOne({ userId });
  
  if (!settings || !settings.pilotModeEnabled) {
    throw new AppError('Pilot mode is not enabled', 403, 'PILOT_MODE_DISABLED');
  }
  
  // Compute checklist status
  const [customerCount, billCount, promiseCount] = await Promise.all([
    Customer.countDocuments({ userId, isDeleted: { $ne: true } }),
    Bill.countDocuments({ userId, isDeleted: { $ne: true } }),
    RecoveryCase.countDocuments({ 
      userId, 
      promiseAt: { $exists: true, $ne: null } 
    }),
  ]);
  
  const items = [
    {
      id: 'add_customer',
      title: 'Add your first customer',
      description: 'Add a customer to start tracking bills and payments',
      completed: customerCount >= 1,
      cta: 'Add Customer',
      screen: 'AddCustomer',
      order: 1,
    },
    {
      id: 'create_bill',
      title: 'Create your first bill',
      description: 'Record a credit sale or pending payment',
      completed: billCount >= 1,
      cta: 'Create Bill',
      screen: 'CreateBill',
      order: 2,
    },
    {
      id: 'set_promise',
      title: 'Set a payment promise',
      description: 'When a customer commits to pay, record it here',
      completed: promiseCount >= 1,
      cta: 'Set Promise',
      screen: 'Today', // Will open chase list
      order: 3,
    },
    {
      id: 'review_chase',
      title: 'Review your chase list',
      description: 'This is your daily control room - who to contact today',
      completed: false, // Can be tracked via analytics later
      cta: 'View Chase List',
      screen: 'Today',
      order: 4,
    },
    {
      id: 'enable_app_lock',
      title: 'Turn on App Lock (recommended)',
      description: 'Protect your business data with a PIN or biometric lock',
      completed: false, // Frontend local setting
      cta: 'Enable App Lock',
      screen: 'SecuritySettings',
      order: 5,
      optional: true,
    },
  ];
  
  // Determine next step
  const nextStep = items.find(item => !item.completed);
  const completedCount = items.filter(item => item.completed).length;
  const totalCount = items.filter(item => !item.optional).length;
  const progress = Math.round((completedCount / totalCount) * 100);
  
  res.success({
    pilotModeEnabled: true,
    profile: settings.pilotModeProfile,
    items,
    nextStep: nextStep || null,
    progress: {
      completed: completedCount,
      total: totalCount,
      percentage: progress,
    },
    meta: {
      computedAt: new Date().toISOString(),
      requestId: req.requestId,
    },
  });
});

module.exports = {
  togglePilotMode,
  getPilotChecklist,
};
