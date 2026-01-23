/**
 * Notification Generator Utility
 * 
 * Shared utilities for building notification payloads and ensuring idempotent creation
 * Follows NOTIFICATIONS_SPEC.md contract
 */
const Notification = require('../../models/Notification');
const {createNotification} = require('../notificationService');
const logger = require('../../utils/logger');

/**
 * Build notification payload according to NOTIFICATIONS_SPEC.md
 * 
 * @param {Object} params
 * @param {string} params.kind - Notification kind
 * @param {string} params.entityType - customer|bill|device|system
 * @param {string} params.entityId - Primary entity ID
 * @param {string|null} params.customerId - Customer ID if applicable
 * @param {string|null} params.billId - Bill ID if applicable
 * @param {Date|string} params.occurredAt - When event occurred (ISO string)
 * @param {string} params.idempotencyKey - Idempotency key
 * @param {string} params.deeplink - Deep link URL
 * @returns {Object} Notification payload for metadata field
 */
function buildNotificationPayload({
  kind,
  entityType,
  entityId,
  customerId = null,
  billId = null,
  occurredAt,
  idempotencyKey,
  deeplink,
}) {
  return {
    kind,
    entityType,
    entityId: String(entityId),
    customerId: customerId ? String(customerId) : null,
    billId: billId ? String(billId) : null,
    occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
    idempotencyKey,
    deeplink,
  };
}

/**
 * Compute title and body from notification kind and context
 * 
 * @param {string} kind - Notification kind
 * @param {Object} context - Context object (customer, bill, etc.)
 * @returns {Object} { title, body }
 */
function computeTitleBody(kind, context = {}) {
  const customerName = context.customerName || context.customer?.name || 'Customer';
  const billNo = context.billNo || context.bill?.billNo || '';
  const amount = context.amount || context.bill?.grandTotal || 0;
  
  // Format amount as currency
  const formatAmount = (amt) => {
    if (typeof amt !== 'number' || isNaN(amt)) return '₹0';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amt);
  };

  const titleMap = {
    OVERDUE_ALERT: `Overdue: ${customerName}`,
    DUE_TODAY: `Due Today: ${customerName}`,
    PROMISE_DUE_TODAY: `Promise Due Today: ${customerName}`,
    PROMISE_BROKEN: `Broken Promise: ${customerName}`,
    FOLLOWUP_DUE: `Follow-up Due: ${customerName}`,
    PAYMENT_RECEIVED: `Payment Received: ${billNo}`,
    DEVICE_APPROVAL_REQUIRED: 'Device Approval Required',
    DAILY_SUMMARY: 'Daily Summary',
    CREDIT_LIMIT_WARN: `Credit Limit Warning: ${customerName}`,
    // Legacy support
    OVERDUE: `Overdue: ${customerName}`,
    PROMISE_REMINDER: `Promise Reminder: ${customerName}`,
    FOLLOWUP: `Follow-up: ${customerName}`,
  };

  const bodyMap = {
    OVERDUE_ALERT: `${customerName} has overdue payments. Total: ${formatAmount(amount)}`,
    DUE_TODAY: `${customerName} has payments due today. Amount: ${formatAmount(amount)}`,
    PROMISE_DUE_TODAY: `${customerName}'s payment promise is due today. Amount: ${formatAmount(amount)}`,
    PROMISE_BROKEN: `${customerName} broke their payment promise. Amount: ${formatAmount(amount)}`,
    FOLLOWUP_DUE: `Follow-up reminder for ${customerName}. Amount due: ${formatAmount(amount)}`,
    PAYMENT_RECEIVED: `Payment of ${formatAmount(amount)} received for bill ${billNo}`,
    DEVICE_APPROVAL_REQUIRED: 'A new device is requesting access to your account',
    DAILY_SUMMARY: context.summary || 'Your daily business summary is ready',
    CREDIT_LIMIT_WARN: `${customerName} is approaching credit limit. Outstanding: ${formatAmount(amount)}`,
    // Legacy support
    OVERDUE: `${customerName} has overdue payments. Amount: ${formatAmount(amount)}`,
    PROMISE_REMINDER: `${customerName}'s payment promise is due. Amount: ${formatAmount(amount)}`,
    FOLLOWUP: `Follow-up reminder for ${customerName}. Amount: ${formatAmount(amount)}`,
  };

  return {
    title: titleMap[kind] || 'Notification',
    body: bodyMap[kind] || 'You have a new notification',
  };
}

/**
 * Ensure notification is created only once (idempotent)
 * Uses notificationService.createNotification which handles idempotency and attempts
 * 
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.businessId - Business ID
 * @param {string} params.idempotencyKey - Idempotency key
 * @param {Object} params.doc - Notification document fields
 * @returns {Promise<Object>} { notification, created: boolean }
 */
async function ensureNotificationOnce({userId, businessId, idempotencyKey, doc}) {
  try {
    const {createNotification} = require('../notificationService');
    
    // Check if notification already exists (idempotency)
    const existing = await Notification.findOne({
      userId,
      idempotencyKey,
    });

    if (existing) {
      logger.debug('[NotificationGenerator] Idempotent skip', {
        notificationId: existing._id,
        kind: existing.kind,
        idempotencyKey,
      });
      return {notification: existing, created: false};
    }

    // createNotification handles idempotency internally, but we already checked
    const result = await createNotification({
      userId,
      businessId: businessId || userId,
      customerId: doc.customerId,
      kind: doc.kind,
      title: doc.title,
      body: doc.body,
      channels: doc.channels || ['IN_APP'],
      metadata: doc.metadata,
      idempotencyKey,
    });
    
    return {
      notification: result.notification,
      created: true,
    };
  } catch (error) {
    // If duplicate key error (race condition), find existing
    if (error.code === 11000 || error.message?.includes('duplicate')) {
      const existing = await Notification.findOne({
        userId,
        idempotencyKey,
      });
      if (existing) {
        logger.debug('[NotificationGenerator] Race condition - notification already exists', {
          notificationId: existing._id,
          idempotencyKey,
        });
        return {notification: existing, created: false};
      }
    }
    
    logger.error('[NotificationGenerator] Failed to ensure notification', {
      error: error.message,
      idempotencyKey,
      userId,
    });
    throw error;
  }
}

module.exports = {
  buildNotificationPayload,
  computeTitleBody,
  ensureNotificationOnce,
};
