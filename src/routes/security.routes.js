/**
 * Security Routes
 * 
 * Device management and security settings
 * Step 9: Trust & Survival
 * Step 22: One-Button Business Reset
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {requireOwner} = require('../middleware/permission.middleware');
const {
  getUserDevices,
  approveDeviceEndpoint,
  blockDeviceEndpoint,
  getRecoverySettings,
  enableRecovery,
  disableRecovery,
  registerPushToken,
} = require('../controllers/security.controller');
const {
  initBusinessReset,
  getResetJobStatus,
  getResetJobHistory,
} = require('../controllers/businessReset.controller');

// All routes require authentication
router.use(protect);

/**
 * @route   GET /api/v1/security/devices
 * @desc    Get user devices (optionally filter by status)
 * @query   status (optional: TRUSTED, PENDING, BLOCKED)
 * @access  Private
 */
router.get('/devices', getUserDevices);

/**
 * @route   POST /api/v1/security/devices/:id/approve
 * @desc    Approve a pending device (owner only)
 * @access  Private (Owner)
 */
router.post('/devices/:id/approve', approveDeviceEndpoint);

/**
 * @route   POST /api/v1/security/devices/:id/block
 * @desc    Block a device (owner only)
 * @access  Private (Owner)
 */
router.post('/devices/:id/block', blockDeviceEndpoint);

/**
 * @route   POST /api/v1/security/devices/push-token
 * @desc    Register/update FCM push token for current device
 * @body    { fcmToken: string }
 * @access  Private
 */
router.post('/devices/push-token', registerPushToken);

/**
 * @route   GET /api/v1/security/recovery
 * @desc    Get recovery settings
 * @access  Private
 */
router.get('/recovery', getRecoverySettings);

/**
 * @route   POST /api/v1/security/recovery/enable
 * @desc    Enable recovery (set recovery PIN)
 * @access  Private
 */
router.post('/recovery/enable', enableRecovery);

/**
 * @route   POST /api/v1/security/recovery/disable
 * @desc    Disable recovery
 * @access  Private
 */
router.post('/recovery/disable', disableRecovery);

/**
 * @route   POST /api/v1/security/business-reset/init
 * @desc    Initialize business reset with typed confirmation
 * @access  Private (Owner)
 */
router.post('/business-reset/init', requireOwner, initBusinessReset);

/**
 * @route   GET /api/v1/security/business-reset/:jobId
 * @desc    Get reset job status
 * @access  Private (Owner)
 */
router.get('/business-reset/:jobId', requireOwner, getResetJobStatus);

/**
 * @route   GET /api/v1/security/business-reset/history
 * @desc    Get reset job history
 * @access  Private (Owner)
 */
router.get('/business-reset/history', requireOwner, getResetJobHistory);

module.exports = router;
