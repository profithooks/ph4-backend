/**
 * PAYMENT_RECEIVED Notification Generator
 * 
 * Event-driven notification when payment is received
 * Called from bill payment controller
 */
const Bill = require('../../../models/Bill');
const Customer = require('../../../models/Customer');
const User = require('../../../models/User');
const {getNowIST} = require('../../../utils/timezone.util');
const {buildNotificationPayload, computeTitleBody, ensureNotificationOnce} = require('../notificationGenerator');
const {selectChannels} = require('../channelSelector');
const logger = require('../../../utils/logger');

/**
 * Generate PAYMENT_RECEIVED notification
 * 
 * @param {Object} params
 * @param {string} params.billId - Bill ID
 * @param {string} params.userId - User ID
 * @returns {Promise<Object>} { notification, created: boolean }
 */
async function generatePaymentReceivedNotification({billId, userId}) {
  try {
    // Load bill and related data
    const bill = await Bill.findById(billId).populate('userId', 'businessId').lean();
    if (!bill) {
      logger.warn('[PaymentReceived] Bill not found', {billId});
      return {notification: null, created: false};
    }

    // Verify bill is now paid (or was just paid)
    const pendingAmount = bill.grandTotal - (bill.paidAmount || 0);
    if (pendingAmount > 0 && bill.status !== 'paid') {
      // Bill not fully paid yet - don't notify
      return {notification: null, created: false};
    }

    const user = bill.userId;
    const businessId = user.businessId || userId;

    const customer = await Customer.findById(bill.customerId).lean();
    if (!customer || customer.isDeleted) {
      logger.warn('[PaymentReceived] Customer not found or deleted', {
        customerId: bill.customerId,
      });
      return {notification: null, created: false};
    }

    // Build idempotency key (per bill per day)
    const now = getNowIST();
    const dateStr = now.toISOString().substring(0, 10); // YYYY-MM-DD
    const idempotencyKey = `PAYMENT_RECEIVED:${String(billId)}:${dateStr}`;

    // Build deeplink
    const deeplink = `ph4://bill/${String(billId)}`;

    // Build payload
    const metadata = buildNotificationPayload({
      kind: 'PAYMENT_RECEIVED',
      entityType: 'bill',
      entityId: String(billId),
      customerId: String(bill.customerId),
      billId: String(billId),
      occurredAt: now.toISOString(),
      idempotencyKey,
      deeplink,
    });

    // Compute title/body
    const {title, body} = computeTitleBody('PAYMENT_RECEIVED', {
      billNo: bill.billNo,
      amount: bill.paidAmount || bill.grandTotal,
    });

    // Get channels
    const channels = await selectChannels(userId);

    // Ensure notification
    const result = await ensureNotificationOnce({
      userId,
      businessId,
      idempotencyKey,
      doc: {
        customerId: bill.customerId,
        kind: 'PAYMENT_RECEIVED',
        title,
        body,
        channels,
        metadata: {
          ...metadata,
          billNo: bill.billNo,
          paidAmount: bill.paidAmount,
          grandTotal: bill.grandTotal,
        },
      },
    });

    return result;
  } catch (error) {
    // Swallow errors - must not break payment flow
    logger.error('[PaymentReceived] Failed to generate notification', {
      error: error.message,
      billId,
      userId,
    });
    return {notification: null, created: false};
  }
}

module.exports = {
  generatePaymentReceivedNotification,
};
