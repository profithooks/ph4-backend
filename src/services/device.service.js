/**
 * Device Service
 * 
 * Device binding and trusted device management
 * Step 9: Trust & Survival
 */
const Device = require('../models/Device');
const AuditEvent = require('../models/AuditEvent');
const logger = require('../utils/logger');

/**
 * Get or create device record
 * 
 * @param {Object} params - { userId, businessId, deviceId, deviceMeta }
 * @returns {Promise<Device>}
 */
const getOrCreateDevice = async (params) => {
  const {userId, businessId, deviceId, deviceMeta = {}} = params;
  
  try {
    let device = await Device.findOne({userId, deviceId});
    
    if (!device) {
      // Create new device with PENDING status
      device = await Device.create({
        userId,
        businessId,
        deviceId,
        deviceName: deviceMeta.deviceName || 'Unknown Device',
        platform: deviceMeta.platform || 'unknown',
        osVersion: deviceMeta.osVersion,
        appVersion: deviceMeta.appVersion,
        modelName: deviceMeta.modelName,
        status: 'PENDING',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      });
      
      // Create audit event
      await AuditEvent.create({
        at: new Date(),
        businessId,
        actorUserId: userId,
        actorRole: 'USER',
        action: 'DEVICE_BOUND',
        entityType: 'DEVICE',
        entityId: device._id,
        metadata: {
          deviceId,
          deviceName: device.deviceName,
          platform: device.platform,
          status: 'PENDING',
        },
      }).catch(err => logger.warn('[Device] Audit event creation failed', err));
      
      logger.info('[Device] New device created (PENDING)', {userId, deviceId, deviceName: device.deviceName});
    } else {
      // Update last seen
      device.lastSeenAt = new Date();
      
      // Update metadata if changed
      if (deviceMeta.appVersion && deviceMeta.appVersion !== device.appVersion) {
        device.appVersion = deviceMeta.appVersion;
      }
      if (deviceMeta.osVersion && deviceMeta.osVersion !== device.osVersion) {
        device.osVersion = deviceMeta.osVersion;
      }
      
      await device.save();
    }
    
    return device;
  } catch (error) {
    logger.error('[Device] Get or create failed', error);
    throw error;
  }
};

/**
 * Verify device is trusted
 * 
 * @param {String} userId - User ID
 * @param {String} deviceId - Device ID
 * @returns {Promise<Boolean>}
 */
const verifyDeviceTrusted = async (userId, deviceId) => {
  try {
    const device = await Device.findOne({userId, deviceId});
    
    if (!device) {
      return false;
    }
    
    if (device.status === 'BLOCKED') {
      return false;
    }
    
    if (device.status === 'TRUSTED') {
      // Update last seen
      await device.updateLastSeen();
      return true;
    }
    
    // PENDING
    return false;
  } catch (error) {
    logger.error('[Device] Verify failed', error);
    return false;
  }
};

/**
 * Approve device (owner only)
 * 
 * @param {String} deviceObjId - Device ObjectId
 * @param {String} approvedByUserId - Approver user ID
 * @param {String} businessId - Business ID
 * @returns {Promise<Device>}
 */
const approveDevice = async (deviceObjId, approvedByUserId, businessId) => {
  try {
    const device = await Device.findById(deviceObjId);
    
    if (!device) {
      throw new Error('Device not found');
    }
    
    if (device.status === 'TRUSTED') {
      return device; // Already approved
    }
    
    device.status = 'TRUSTED';
    device.approvedBy = approvedByUserId;
    device.approvedAt = new Date();
    await device.save();
    
    // Create audit event
    await AuditEvent.create({
      at: new Date(),
      businessId,
      actorUserId: approvedByUserId,
      actorRole: 'OWNER',
      action: 'DEVICE_APPROVED',
      entityType: 'DEVICE',
      entityId: device._id,
      metadata: {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        userId: device.userId,
      },
    }).catch(err => logger.warn('[Device] Audit event creation failed', err));
    
    logger.info('[Device] Device approved', {deviceId: device.deviceId, approvedBy: approvedByUserId});
    
    return device;
  } catch (error) {
    logger.error('[Device] Approve failed', error);
    throw error;
  }
};

/**
 * Block device (owner only)
 * 
 * @param {String} deviceObjId - Device ObjectId
 * @param {String} blockedByUserId - Blocker user ID
 * @param {String} businessId - Business ID
 * @param {String} reason - Block reason
 * @returns {Promise<Device>}
 */
const blockDevice = async (deviceObjId, blockedByUserId, businessId, reason = '') => {
  try {
    const device = await Device.findById(deviceObjId);
    
    if (!device) {
      throw new Error('Device not found');
    }
    
    device.status = 'BLOCKED';
    device.blockedBy = blockedByUserId;
    device.blockedAt = new Date();
    device.blockedReason = reason;
    await device.save();
    
    // Create audit event
    await AuditEvent.create({
      at: new Date(),
      businessId,
      actorUserId: blockedByUserId,
      actorRole: 'OWNER',
      action: 'DEVICE_BLOCKED',
      entityType: 'DEVICE',
      entityId: device._id,
      reason,
      metadata: {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        userId: device.userId,
      },
    }).catch(err => logger.warn('[Device] Audit event creation failed', err));
    
    logger.info('[Device] Device blocked', {deviceId: device.deviceId, blockedBy: blockedByUserId, reason});
    
    return device;
  } catch (error) {
    logger.error('[Device] Block failed', error);
    throw error;
  }
};

/**
 * Get devices for user/business
 * 
 * @param {Object} params - { userId?, businessId?, status? }
 * @returns {Promise<Array>}
 */
const getDevices = async (params) => {
  const {userId, businessId, status} = params;
  
  try {
    const filter = {};
    
    if (userId) filter.userId = userId;
    if (businessId) filter.businessId = businessId;
    if (status) filter.status = status;
    
    const devices = await Device.find(filter)
      .populate('userId', 'name phone')
      .sort({lastSeenAt: -1})
      .lean();
    
    return devices;
  } catch (error) {
    logger.error('[Device] Get devices failed', error);
    throw error;
  }
};

module.exports = {
  getOrCreateDevice,
  verifyDeviceTrusted,
  approveDevice,
  blockDevice,
  getDevices,
};
