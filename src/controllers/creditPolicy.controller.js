/**
 * Credit Policy Controller
 * 
 * Manages customer credit limits and policies
 */
const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const AuditEvent = require('../models/AuditEvent');
const AppError = require('../utils/AppError');
const {
  updateCreditPolicy,
  computeCustomerOutstanding,
} = require('../services/creditControl.service');

/**
 * Update customer credit policy
 * PATCH /api/v1/customers/:id/credit-policy
 * 
 * Only owners can update credit policy
 */
const updateCustomerCreditPolicy = asyncHandler(async (req, res) => {
  const {id: customerId} = req.params;
  const {enabled, limitAmount, graceAmount, allowOverride} = req.body;
  const userId = req.user._id;
  const requestId = req.requestId || req.headers['x-request-id'];
  
  // Verify customer exists and belongs to user
  const customer = await Customer.findOne({
    _id: customerId,
    userId,
  });
  
  if (!customer) {
    throw new AppError('Customer not found', 404, 'NOT_FOUND');
  }
  
  // Update policy using service
  const policy = {};
  if (enabled !== undefined) policy.enabled = enabled;
  if (limitAmount !== undefined) policy.limitAmount = limitAmount;
  if (graceAmount !== undefined) policy.graceAmount = graceAmount;
  if (allowOverride !== undefined) policy.allowOverride = allowOverride;
  
  const updatedCustomer = await updateCreditPolicy({
    customerId,
    userId,
    policy,
    requestId,
  });
  
  // Compute current outstanding for response
  const currentOutstanding = await computeCustomerOutstanding(userId, customerId);
  const threshold = (updatedCustomer.creditLimitAmount || 0) + (updatedCustomer.creditLimitGraceAmount || 0);
  const headroom = threshold - currentOutstanding;
  
  res.success({
    customer: {
      _id: updatedCustomer._id,
      name: updatedCustomer.name,
      creditLimitEnabled: updatedCustomer.creditLimitEnabled,
      creditLimitAmount: updatedCustomer.creditLimitAmount,
      creditLimitGraceAmount: updatedCustomer.creditLimitGraceAmount,
      creditLimitAllowOverride: updatedCustomer.creditLimitAllowOverride,
      creditLimitUpdatedAt: updatedCustomer.creditLimitUpdatedAt,
    },
    currentOutstanding,
    headroom,
    threshold,
  });
});

/**
 * Get customer credit policy with current exposure
 * GET /api/v1/customers/:id/credit-policy
 */
const getCustomerCreditPolicy = asyncHandler(async (req, res) => {
  const {id: customerId} = req.params;
  const userId = req.user._id;
  
  // Verify customer exists and belongs to user
  const customer = await Customer.findOne({
    _id: customerId,
    userId,
  }).lean();
  
  if (!customer) {
    throw new AppError('Customer not found', 404, 'NOT_FOUND');
  }
  
  // Compute current outstanding
  const currentOutstanding = await computeCustomerOutstanding(userId, customerId);
  const threshold = (customer.creditLimitAmount || 0) + (customer.creditLimitGraceAmount || 0);
  const headroom = threshold - currentOutstanding;
  
  res.success({
    customerId: customer._id,
    customerName: customer.name,
    policy: {
      enabled: customer.creditLimitEnabled || false,
      limitAmount: customer.creditLimitAmount || 0,
      graceAmount: customer.creditLimitGraceAmount || 0,
      allowOverride: customer.creditLimitAllowOverride !== false, // Default true
      updatedAt: customer.creditLimitUpdatedAt,
    },
    currentOutstanding,
    headroom,
    threshold,
    status: currentOutstanding > threshold ? 'OVER_LIMIT' : 'WITHIN_LIMIT',
  });
});

/**
 * Get audit trail for customer
 * GET /api/v1/customers/:id/audit?limit=50
 */
const getCustomerAudit = asyncHandler(async (req, res) => {
  const {id: customerId} = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const userId = req.user._id;
  
  // Verify customer exists and belongs to user
  const customer = await Customer.findOne({
    _id: customerId,
    userId,
  });
  
  if (!customer) {
    throw new AppError('Customer not found', 404, 'NOT_FOUND');
  }
  
  // Get audit events for this customer
  const auditEvents = await AuditEvent.find({
    $or: [
      {entityType: 'CUSTOMER', entityId: customerId},
      {'metadata.billId': {$exists: true}, actorUserId: userId}, // Bills for this user
    ],
  })
    .sort({createdAt: -1})
    .limit(limit)
    .populate('actorUserId', 'name email')
    .lean();
  
  // Filter to only this customer's bills
  const filteredEvents = auditEvents.filter(event => {
    if (event.entityType === 'CUSTOMER' && event.entityId.toString() === customerId) {
      return true;
    }
    // For BILL events, check if it's related to this customer (would need bill lookup)
    // For now, just include all BILL events with this customer as context
    return event.entityType === 'CUSTOMER';
  });
  
  res.success({
    customerId,
    customerName: customer.name,
    auditEvents: filteredEvents,
    count: filteredEvents.length,
  });
});

module.exports = {
  updateCustomerCreditPolicy,
  getCustomerCreditPolicy,
  getCustomerAudit,
};
