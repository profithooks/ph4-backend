/**
 * Audit Helper Service
 * 
 * Utilities for creating audit events with change tracking
 * Step 5: Staff Accountability
 */
const AuditEvent = require('../models/AuditEvent');
const logger = require('../utils/logger');

/**
 * Field whitelist per entity type
 * Only these fields are included in diffs to avoid huge payloads
 */
const FIELD_WHITELISTS = {
  BILL: [
    'billNo', 'grandTotal', 'paidAmount', 'status', 'dueDate',
    'discount', 'tax', 'subTotal', 'notes', 'items',
  ],
  CUSTOMER: [
    'name', 'phone',
    'creditLimitEnabled', 'creditLimitAmount', 'creditLimitGraceAmount', 'creditLimitAllowOverride',
  ],
  FOLLOWUP: [
    'status', 'followupStatus', 'dueAt', 'channel', 'note', 'title',
    'priority', 'escalationLevel',
  ],
  RECOVERY: [
    'promiseAt', 'promiseStatus', 'amount', 'status',
  ],
};

/**
 * Cap string length to prevent huge audit payloads
 */
const MAX_STRING_LENGTH = 500;

/**
 * Sanitize value for audit log
 */
function sanitizeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? value.substring(0, MAX_STRING_LENGTH) + '...[truncated]'
      : value;
  }
  
  if (Array.isArray(value)) {
    // For arrays (like items in Bill), limit to first 10 items
    return value.slice(0, 10).map(sanitizeValue);
  }
  
  if (typeof value === 'object') {
    // Recursively sanitize objects
    const sanitized = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = sanitizeValue(val);
    }
    return sanitized;
  }
  
  return value;
}

/**
 * Extract whitelisted fields from object
 */
function extractWhitelistedFields(obj, entityType) {
  const whitelist = FIELD_WHITELISTS[entityType] || [];
  const extracted = {};
  
  for (const field of whitelist) {
    if (obj && obj[field] !== undefined) {
      extracted[field] = sanitizeValue(obj[field]);
    }
  }
  
  return extracted;
}

/**
 * Compute diff between before and after states
 */
function computeDiff(before, after, entityType) {
  const beforeFiltered = extractWhitelistedFields(before, entityType);
  const afterFiltered = extractWhitelistedFields(after, entityType);
  
  const changedKeys = [];
  
  // Find changed keys
  const allKeys = new Set([
    ...Object.keys(beforeFiltered),
    ...Object.keys(afterFiltered),
  ]);
  
  for (const key of allKeys) {
    const beforeVal = JSON.stringify(beforeFiltered[key]);
    const afterVal = JSON.stringify(afterFiltered[key]);
    
    if (beforeVal !== afterVal) {
      changedKeys.push(key);
    }
  }
  
  return {
    before: beforeFiltered,
    after: afterFiltered,
    changedKeys,
  };
}

/**
 * Create audit event
 * 
 * @param {Object} params
 * @param {string} params.action - Action type (e.g., BILL_UPDATED)
 * @param {string} params.actorUserId - User who performed action
 * @param {string} params.actorRole - User role (OWNER, STAFF, etc.)
 * @param {string} params.entityType - Entity type (BILL, CUSTOMER, etc.)
 * @param {string} params.entityId - Entity ID
 * @param {string} params.customerId - Customer ID (for filtering)
 * @param {string} params.businessId - Business ID
 * @param {string} params.reason - Reason (required for deletes/overrides)
 * @param {Object} params.before - State before change
 * @param {Object} params.after - State after change
 * @param {Object} params.metadata - Additional metadata
 * @param {string} params.requestId - Request ID for tracing
 * @returns {Promise<Object>} Created audit event
 */
async function createAuditEvent({
  action,
  actorUserId,
  actorRole = 'STAFF',
  entityType,
  entityId,
  customerId,
  businessId,
  reason,
  before,
  after,
  metadata = {},
  requestId,
}) {
  try {
    // Compute diff if before/after provided
    let diff = null;
    if (before || after) {
      diff = computeDiff(before || {}, after || {}, entityType);
    }
    
    // Create audit event
    const auditEvent = await AuditEvent.create({
      at: new Date(),
      businessId,
      actorUserId,
      actorRole,
      action,
      entityType,
      entityId,
      customerId,
      reason,
      diff,
      metadata: {
        ...metadata,
        requestId,
      },
    });
    
    logger.info('[AuditHelper] Audit event created', {
      auditEventId: auditEvent._id,
      action,
      entityType,
      entityId,
      changedKeys: diff?.changedKeys,
    });
    
    return auditEvent;
  } catch (error) {
    logger.error('[AuditHelper] Failed to create audit event', error, {
      action,
      entityType,
      entityId,
    });
    
    // Don't throw - audit failure shouldn't break main flow
    // But log prominently
    console.error('[AUDIT FAILURE]', error);
    
    return null;
  }
}

/**
 * Helper: Create audit for entity creation
 */
async function auditCreate({
  action,
  actorUserId,
  actorRole,
  entityType,
  entity,
  customerId,
  businessId,
  metadata,
  requestId,
}) {
  return createAuditEvent({
    action,
    actorUserId,
    actorRole,
    entityType,
    entityId: entity._id,
    customerId: customerId || entity.customerId,
    businessId,
    after: entity.toObject ? entity.toObject() : entity,
    metadata,
    requestId,
  });
}

/**
 * Helper: Create audit for entity update
 */
async function auditUpdate({
  action,
  actorUserId,
  actorRole,
  entityType,
  beforeEntity,
  afterEntity,
  customerId,
  businessId,
  metadata,
  requestId,
}) {
  return createAuditEvent({
    action,
    actorUserId,
    actorRole,
    entityType,
    entityId: afterEntity._id,
    customerId: customerId || afterEntity.customerId,
    businessId,
    before: beforeEntity.toObject ? beforeEntity.toObject() : beforeEntity,
    after: afterEntity.toObject ? afterEntity.toObject() : afterEntity,
    metadata,
    requestId,
  });
}

/**
 * Helper: Create audit for entity deletion
 */
async function auditDelete({
  action,
  actorUserId,
  actorRole,
  entityType,
  entity,
  customerId,
  businessId,
  reason,
  metadata,
  requestId,
}) {
  if (!reason) {
    logger.warn('[AuditHelper] Delete audit without reason', {
      action,
      entityType,
      entityId: entity._id,
    });
  }
  
  return createAuditEvent({
    action,
    actorUserId,
    actorRole,
    entityType,
    entityId: entity._id,
    customerId: customerId || entity.customerId,
    businessId,
    reason,
    before: entity.toObject ? entity.toObject() : entity,
    metadata,
    requestId,
  });
}

module.exports = {
  createAuditEvent,
  auditCreate,
  auditUpdate,
  auditDelete,
  computeDiff,
};
