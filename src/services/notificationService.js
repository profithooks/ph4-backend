/**
 * Notification Service
 * 
 * Creates notifications and attempts
 * Boundary layer between engines and notification infrastructure
 */
const Notification = require('../models/Notification');
const NotificationAttempt = require('../models/NotificationAttempt');
const logger = require('../utils/logger');

/**
 * Create a notification with delivery attempts
 * 
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.businessId - Business ID (optional)
 * @param {string} params.customerId - Customer ID (optional)
 * @param {string} params.kind - Notification kind
 * @param {string} params.title - Title
 * @param {string} params.body - Body text
 * @param {Array<string>} params.channels - Target channels
 * @param {Object} params.metadata - Additional data
 * @param {string} params.idempotencyKey - Idempotency key
 * @returns {Promise<Object>} - { notification, attempts }
 */
async function createNotification({
  userId,
  businessId,
  customerId,
  kind,
  title,
  body,
  channels = ['IN_APP'],
  metadata = {},
  idempotencyKey,
}) {
  try {
    // Create notification (with idempotency)
    let notification;
    
    if (idempotencyKey) {
      // Try to find existing
      notification = await Notification.findOne({
        userId,
        idempotencyKey,
      });
      
      if (notification) {
        logger.info('[NotificationService] Idempotent duplicate detected', {
          notificationId: notification._id,
          idempotencyKey,
        });
        
        // Return existing with its attempts
        const attempts = await NotificationAttempt.find({
          notificationId: notification._id,
        });
        
        return {notification, attempts};
      }
    }
    
    // Create new notification
    notification = await Notification.create({
      userId,
      businessId,
      customerId,
      kind,
      title,
      body,
      channels,
      metadata,
      idempotencyKey,
    });
    
    logger.info('[NotificationService] Notification created', {
      notificationId: notification._id,
      kind,
      channels,
    });
    
    // Create delivery attempts for each channel
    const attempts = [];
    
    for (const channel of channels) {
      const attempt = await NotificationAttempt.create({
        notificationId: notification._id,
        channel,
        status: 'QUEUED',
        attemptNo: 0,
        nextAttemptAt: new Date(), // Deliver immediately
      });
      
      attempts.push(attempt);
      
      logger.debug('[NotificationService] Attempt created', {
        attemptId: attempt._id,
        notificationId: notification._id,
        channel,
      });
    }
    
    return {notification, attempts};
  } catch (error) {
    logger.error('[NotificationService] Failed to create notification', error);
    throw error;
  }
}

/**
 * Create notification from followup task
 * 
 * @param {Object} params
 * @param {Object} params.followupTask - FollowUpTask object
 * @param {Object} params.customer - Customer object
 * @param {Object} params.user - User object
 * @param {Array<string>} params.channels - Target channels
 * @returns {Promise<Object>}
 */
async function createFollowupNotification({
  followupTask,
  customer,
  user,
  channels = ['IN_APP'],
}) {
  const dueDate = followupTask.dueAt
    ? new Date(followupTask.dueAt).toLocaleDateString()
    : 'today';
  
  return createNotification({
    userId: user._id,
    businessId: user.businessId,
    customerId: customer._id,
    kind: 'FOLLOWUP',
    title: `Follow-up: ${customer.name}`,
    body: `Follow-up reminder for ${customer.name} due ${dueDate}. Amount due: ₹${customer.totalDue || 0}`,
    channels,
    metadata: {
      followupId: followupTask._id,
      customerId: customer._id,
      customerName: customer.name,
      dueAt: followupTask.dueAt,
      amount: customer.totalDue,
    },
    idempotencyKey: `followup_${followupTask._id}_${channels.join('_')}`,
  });
}

/**
 * Create notification from recovery case
 * 
 * @param {Object} params
 * @param {Object} params.recoveryCase - RecoveryCase object
 * @param {Object} params.customer - Customer object
 * @param {Object} params.user - User object
 * @param {Array<string>} params.channels - Target channels
 * @returns {Promise<Object>}
 */
async function createRecoveryNotification({
  recoveryCase,
  customer,
  user,
  channels = ['IN_APP'],
}) {
  const promiseDate = recoveryCase.promiseAt
    ? new Date(recoveryCase.promiseAt).toLocaleDateString()
    : 'soon';
  
  let title, body;
  
  if (recoveryCase.promiseStatus === 'BROKEN') {
    title = `Broken Promise: ${customer.name}`;
    body = `${customer.name} broke their promise for ${promiseDate}. Amount: ₹${recoveryCase.amount || 0}`;
  } else if (recoveryCase.promiseStatus === 'DUE_TODAY') {
    title = `Promise Due Today: ${customer.name}`;
    body = `${customer.name}'s payment promise is due today (${promiseDate}). Amount: ₹${recoveryCase.amount || 0}`;
  } else {
    title = `Payment Reminder: ${customer.name}`;
    body = `Reminder for ${customer.name}. Amount due: ₹${recoveryCase.amount || 0}`;
  }
  
  return createNotification({
    userId: user._id,
    businessId: user.businessId,
    customerId: customer._id,
    kind: recoveryCase.promiseStatus === 'BROKEN' ? 'OVERDUE' : 'PROMISE_REMINDER',
    title,
    body,
    channels,
    metadata: {
      recoveryId: recoveryCase._id,
      customerId: customer._id,
      customerName: customer.name,
      promiseAt: recoveryCase.promiseAt,
      promiseStatus: recoveryCase.promiseStatus,
      amount: recoveryCase.amount,
    },
    idempotencyKey: `recovery_${recoveryCase._id}_${channels.join('_')}`,
  });
}

/**
 * Create notification for overdue bill
 * 
 * @param {Object} params
 * @param {Object} params.bill - Bill object
 * @param {Object} params.customer - Customer object
 * @param {Object} params.user - User object
 * @param {Array<string>} params.channels - Target channels
 * @returns {Promise<Object>}
 */
async function createOverdueNotification({
  bill,
  customer,
  user,
  channels = ['IN_APP'],
}) {
  return createNotification({
    userId: user._id,
    businessId: user.businessId,
    customerId: customer._id,
    kind: 'OVERDUE',
    title: `Overdue: ${customer.name}`,
    body: `Bill ${bill.billNo} is overdue. Amount: ₹${bill.grandTotal}`,
    channels,
    metadata: {
      billId: bill._id,
      billNo: bill.billNo,
      customerId: customer._id,
      customerName: customer.name,
      amount: bill.grandTotal,
    },
    idempotencyKey: `overdue_${bill._id}_${channels.join('_')}`,
  });
}

module.exports = {
  createNotification,
  createFollowupNotification,
  createRecoveryNotification,
  createOverdueNotification,
};
