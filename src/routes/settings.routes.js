/**
 * Settings Routes
 * 
 * Business settings including general settings and interest policy
 * Step 8: Interest Calculation (added interest-policy routes)
 * Step 23: Go-Live & Rollout Control (added kill-switch routes)
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {requireOwner} = require('../middleware/permission.middleware');
const {validate} = require('../middleware/validation.middleware');
const {updateSettingsSchema} = require('../validators/settings.validator');
const {
  getSettings,
  updateSettings,
  getInterestPolicy,
  updateInterestPolicy,
} = require('../controllers/settings.controller');
const {
  updateKillSwitches,
  getKillSwitchStatus,
} = require('../controllers/killSwitch.controller');

// All routes require authentication
router.use(protect);

/**
 * LEGACY ROUTES (kept for backward compatibility)
 */

/**
 * @route   GET /api/settings
 * @desc    Get settings (auto-create if missing)
 * @access  Private
 */
router.get('/', getSettings);

/**
 * @route   PUT /api/settings
 * @desc    Update settings (partial)
 * @access  Private
 */
router.put('/', validate(updateSettingsSchema), updateSettings);

/**
 * STEP 8: INTEREST POLICY ROUTES
 */

/**
 * @route   GET /api/settings/interest-policy
 * @desc    Get interest policy settings
 * @access  Private
 */
router.get('/interest-policy', getInterestPolicy);

/**
 * @route   PATCH /api/settings/interest-policy
 * @desc    Update interest policy (owner only)
 * @access  Private (Owner)
 */
router.patch('/interest-policy', updateInterestPolicy);

/**
 * STEP 23: KILL-SWITCH ROUTES
 */

/**
 * @route   GET /api/settings/kill-switch
 * @desc    Get kill-switch status
 * @access  Private (Owner)
 */
router.get('/kill-switch', requireOwner, getKillSwitchStatus);

/**
 * @route   PATCH /api/settings/kill-switch
 * @desc    Update kill-switches
 * @access  Private (Owner)
 */
router.patch('/kill-switch', requireOwner, updateKillSwitches);

module.exports = router;
