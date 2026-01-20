/**
 * Credit Control Service
 * 
 * Computes customer exposure and enforces credit limits
 */
const LedgerTransaction = require('../models/LedgerTransaction');
const Bill = require('../models/Bill');
const Customer = require('../models/Customer');
const AuditEvent = require('../models/AuditEvent');
const logger = require('../utils/logger');

/**
 * Compute customer outstanding (exposure)
 * 
 * Uses ledger-based calculation (source of truth):
 * Outstanding = Sum of credit transactions - Sum of debit transactions
 * 
 * @param {string} userId - User ID
 * @param {string} customerId - Customer ID
 * @returns {Promise<number>} Outstanding amount (customer owes business)
 */
async function computeCustomerOutstanding(userId, customerId) {
  try {
    // Get all ledger transactions for customer
    const transactions = await LedgerTransaction.find({
      userId,
      customerId,
    }).lean();
    
    // Calculate balance
    // credit = customer owes money (increases outstanding)
    // debit = payment received (decreases outstanding)
    let outstanding = 0;
    
    for (const txn of transactions) {
      if (txn.type === 'credit') {
        outstanding += txn.amount;
      } else if (txn.type === 'debit') {
        outstanding -= txn.amount;
      }
    }
    
    // Outstanding should never be negative (but clamp to 0 for safety)
    return Math.max(0, outstanding);
  } catch (error) {
    logger.error('[CreditControl] Failed to compute outstanding', error, {
      userId,
      customerId,
    });
    throw error;
  }
}

/**
 * Check if credit limit would be breached
 * 
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.customerId - Customer ID
 * @param {number} params.attemptedDelta - Amount to add to outstanding
 * @returns {Promise<Object>} { breached, exposure, details }
 */
async function checkCreditLimit({userId, customerId, attemptedDelta}) {
  try {
    // Get customer with credit policy
    const customer = await Customer.findOne({
      _id: customerId,
      userId,
    }).lean();
    
    if (!customer) {
      throw new Error('Customer not found');
    }
    
    // If credit limit not enabled, allow
    if (!customer.creditLimitEnabled) {
      return {
        breached: false,
        exposure: 0,
        details: {message: 'Credit limit not enabled'},
      };
    }
    
    // Compute current outstanding
    const currentOutstanding = await computeCustomerOutstanding(userId, customerId);
    
    // Compute exposure (current + new delta)
    const exposure = currentOutstanding + attemptedDelta;
    
    // Compute threshold (limit + grace)
    const limit = customer.creditLimitAmount || 0;
    const grace = customer.creditLimitGraceAmount || 0;
    const threshold = limit + grace;
    
    // Check breach
    const breached = exposure > threshold;
    
    const details = {
      currentOutstanding,
      attemptedDelta,
      exposure,
      limit,
      grace,
      threshold,
      headroom: threshold - currentOutstanding,
      allowOverride: customer.creditLimitAllowOverride,
    };
    
    logger.debug('[CreditControl] Credit limit check', {
      customerId,
      breached,
      ...details,
    });
    
    return {
      breached,
      exposure,
      details,
    };
  } catch (error) {
    logger.error('[CreditControl] Credit limit check failed', error, {
      userId,
      customerId,
      attemptedDelta,
    });
    throw error;
  }
}

/**
 * Create audit event for credit control action
 * 
 * @param {Object} params
 * @param {string} params.action - Action type
 * @param {string} params.userId - Actor user ID
 * @param {string} params.actorRole - Actor role
 * @param {string} params.entityType - Entity type
 * @param {string} params.entityId - Entity ID
 * @param {Object} params.metadata - Action metadata
 * @param {string} params.requestId - Request ID (for tracing)
 * @returns {Promise<Object>} Created audit event
 */
async function createAuditEvent({
  action,
  userId,
  actorRole,
  entityType,
  entityId,
  metadata = {},
  requestId,
}) {
  try {
    const auditEvent = await AuditEvent.create({
      at: new Date(),
      actorUserId: userId,
      actorRole,
      action,
      entityType,
      entityId,
      metadata: {
        ...metadata,
        requestId,
      },
    });
    
    logger.info('[CreditControl] Audit event created', {
      auditEventId: auditEvent._id,
      action,
      entityType,
      entityId,
    });
    
    return auditEvent;
  } catch (error) {
    logger.error('[CreditControl] Failed to create audit event', error, {
      action,
      entityType,
      entityId,
    });
    // Don't throw - audit failure shouldn't break main flow
    return null;
  }
}

/**
 * Update customer credit policy
 * 
 * @param {Object} params
 * @param {string} params.customerId - Customer ID
 * @param {string} params.userId - User ID (owner)
 * @param {Object} params.policy - New policy settings
 * @param {string} params.requestId - Request ID
 * @returns {Promise<Object>} Updated customer
 */
async function updateCreditPolicy({customerId, userId, policy, requestId}) {
  try {
    // Get current customer
    const customer = await Customer.findOne({
      _id: customerId,
      userId,
    });
    
    if (!customer) {
      throw new Error('Customer not found');
    }
    
    // Store before state
    const before = {
      enabled: customer.creditLimitEnabled,
      amount: customer.creditLimitAmount,
      grace: customer.creditLimitGraceAmount,
      allowOverride: customer.creditLimitAllowOverride,
    };
    
    // Update policy
    if (policy.enabled !== undefined) {
      customer.creditLimitEnabled = policy.enabled;
    }
    if (policy.limitAmount !== undefined) {
      customer.creditLimitAmount = Math.max(0, policy.limitAmount);
    }
    if (policy.graceAmount !== undefined) {
      customer.creditLimitGraceAmount = Math.max(0, policy.graceAmount);
    }
    if (policy.allowOverride !== undefined) {
      customer.creditLimitAllowOverride = policy.allowOverride;
    }
    
    customer.creditLimitUpdatedAt = new Date();
    customer.creditLimitUpdatedBy = userId;
    
    await customer.save();
    
    // Store after state
    const after = {
      enabled: customer.creditLimitEnabled,
      amount: customer.creditLimitAmount,
      grace: customer.creditLimitGraceAmount,
      allowOverride: customer.creditLimitAllowOverride,
    };
    
    // Create audit event
    await createAuditEvent({
      action: 'CREDIT_LIMIT_SET',
      userId,
      actorRole: 'OWNER', // Only owners can update policy
      entityType: 'CUSTOMER',
      entityId: customerId,
      metadata: {
        before,
        after,
      },
      requestId,
    });
    
    logger.info('[CreditControl] Credit policy updated', {
      customerId,
      before,
      after,
    });
    
    return customer;
  } catch (error) {
    logger.error('[CreditControl] Failed to update credit policy', error, {
      customerId,
      userId,
    });
    throw error;
  }
}

module.exports = {
  computeCustomerOutstanding,
  checkCreditLimit,
  createAuditEvent,
  updateCreditPolicy,
};
