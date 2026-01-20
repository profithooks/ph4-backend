/**
 * Security Controller
 * 
 * Device management and security settings
 * Step 9: Trust & Survival
 */
const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');
const {getDevices, approveDevice, blockDevice} = require('../services/device.service');
const {getUserRole, isOwner} = require('../middleware/permission.middleware');
const logger = require('../utils/logger');

/**
 * Get devices
 * GET /api/v1/security/devices?status=PENDING
 */
const getUserDevices = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const {status} = req.query;
  
  try {
    const devices = await getDevices({
      businessId,
      status,
    });
    
    res.success({
      devices,
      total: devices.length,
    });
  } catch (error) {
    logger.error('[Security] Get devices failed', error);
    throw error;
  }
});

/**
 * Approve device
 * POST /api/v1/security/devices/:id/approve
 */
const approveDeviceEndpoint = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const deviceObjId = req.params.id;
  const role = getUserRole(req);
  
  // Owner only
  if (!isOwner(role)) {
    const error = new Error('Owner only');
    error.statusCode = 403;
    error.code = 'OWNER_ONLY';
    throw error;
  }
  
  try {
    const device = await approveDevice(deviceObjId, userId, businessId);
    
    res.success({
      device,
      message: 'Device approved successfully',
    });
  } catch (error) {
    logger.error('[Security] Approve device failed', error);
    throw error;
  }
});

/**
 * Block device
 * POST /api/v1/security/devices/:id/block
 */
const blockDeviceEndpoint = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const deviceObjId = req.params.id;
  const {reason} = req.body;
  const role = getUserRole(req);
  
  // Owner only
  if (!isOwner(role)) {
    const error = new Error('Owner only');
    error.statusCode = 403;
    error.code = 'OWNER_ONLY';
    throw error;
  }
  
  try {
    const device = await blockDevice(deviceObjId, userId, businessId, reason);
    
    res.success({
      device,
      message: 'Device blocked successfully',
    });
  } catch (error) {
    logger.error('[Security] Block device failed', error);
    throw error;
  }
});

/**
 * Get recovery settings
 * GET /api/v1/security/recovery
 */
const getRecoverySettings = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  
  try {
    const user = await User.findById(userId).select('recoveryEnabled recoveryEmail recoveryUpdatedAt');
    
    res.success({
      recoveryEnabled: user.recoveryEnabled || false,
      recoveryEmail: user.recoveryEmail || null,
      recoveryUpdatedAt: user.recoveryUpdatedAt || null,
      hasPinSet: !!user.recoveryPinHash,
    });
  } catch (error) {
    logger.error('[Security] Get recovery settings failed', error);
    throw error;
  }
});

/**
 * Enable recovery
 * POST /api/v1/security/recovery/enable
 */
const enableRecovery = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const {recoveryPin, recoveryEmail} = req.body;
  
  // Validate PIN
  if (!recoveryPin || recoveryPin.length < 4 || recoveryPin.length > 6) {
    const error = new Error('Recovery PIN must be 4-6 digits');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  
  if (!/^\d+$/.test(recoveryPin)) {
    const error = new Error('Recovery PIN must contain only digits');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  
  try {
    const user = await User.findById(userId).select('+recoveryPinHash');
    
    // Hash PIN
    const salt = await bcrypt.genSalt(10);
    user.recoveryPinHash = await bcrypt.hash(recoveryPin, salt);
    user.recoveryEnabled = true;
    user.recoveryEmail = recoveryEmail || null;
    user.recoveryUpdatedAt = new Date();
    
    await user.save();
    
    // Create audit event
    await AuditEvent.create({
      at: new Date(),
      businessId,
      actorUserId: userId,
      actorRole: 'USER',
      action: 'RECOVERY_ENABLED',
      entityType: 'USER',
      entityId: userId,
      metadata: {
        hasEmail: !!recoveryEmail,
      },
    }).catch(err => logger.warn('[Security] Audit event creation failed', err));
    
    logger.info('[Security] Recovery enabled', {userId});
    
    res.success({
      recoveryEnabled: true,
      message: 'Recovery enabled successfully',
    });
  } catch (error) {
    logger.error('[Security] Enable recovery failed', error);
    throw error;
  }
});

/**
 * Disable recovery
 * POST /api/v1/security/recovery/disable
 */
const disableRecovery = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  
  try {
    const user = await User.findById(userId);
    
    user.recoveryEnabled = false;
    user.recoveryPinHash = null;
    user.recoveryEmail = null;
    user.recoveryUpdatedAt = new Date();
    
    await user.save();
    
    logger.info('[Security] Recovery disabled', {userId});
    
    res.success({
      recoveryEnabled: false,
      message: 'Recovery disabled successfully',
    });
  } catch (error) {
    logger.error('[Security] Disable recovery failed', error);
    throw error;
  }
});

module.exports = {
  getUserDevices,
  approveDeviceEndpoint,
  blockDeviceEndpoint,
  getRecoverySettings,
  enableRecovery,
  disableRecovery,
};
