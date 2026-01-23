/**
 * Bill Notification Generators
 * 
 * Generates notifications for:
 * - DUE_TODAY
 * - OVERDUE_ALERT
 */
const Bill = require('../../../models/Bill');
const Customer = require('../../../models/Customer');
const User = require('../../../models/User');
const {getNowIST, getStartOfDayIST, getEndOfDayIST} = require('../../../utils/timezone.util');
const {buildNotificationPayload, computeTitleBody, ensureNotificationOnce} = require('../notificationGenerator');
const {selectChannels} = require('../channelSelector');
const logger = require('../../../utils/logger');

/**
 * Generate DUE_TODAY notifications
 * 
 * @param {Object} params
 * @param {Object} params.settings - BusinessSettings object
 * @returns {Promise<Object>} { created: number, skipped: number }
 */
async function generateDueTodayNotifications({settings}) {
  if (!settings.recoveryEnabled) {
    logger.debug('[DueToday] Recovery disabled, skipping');
    return {created: 0, skipped: 0};
  }

  const now = getNowIST();
  const startOfToday = getStartOfDayIST(now);
  const endOfToday = getEndOfDayIST(now);

  try {
    // Find bills due today with pending amount
    // Note: pendingAmount is a virtual field, so we filter in code
    const bills = await Bill.find({
      dueDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
      status: {$in: ['unpaid', 'partial']},
      isDeleted: {$ne: true},
    })
      .populate('userId', 'businessId')
      .lean();

    // Filter bills with actual pending amount (virtual field doesn't work in query)
    const billsWithPending = bills.filter(bill => {
      const pending = bill.grandTotal - (bill.paidAmount || 0);
      return pending > 0;
    });

    if (billsWithPending.length === 0) {
      return {created: 0, skipped: 0};
    }

    let created = 0;
    let skipped = 0;

    // Group by customer (one notification per customer per day)
    const customerMap = {};
    for (const bill of billsWithPending) {
      const customerId = String(bill.customerId);
      if (!customerMap[customerId]) {
        customerMap[customerId] = {
          customerId,
          userId: String(bill.userId._id || bill.userId),
          bills: [],
          totalPending: 0,
        };
      }
      const pending = bill.grandTotal - (bill.paidAmount || 0);
      customerMap[customerId].bills.push(bill);
      customerMap[customerId].totalPending += pending;
    }

    // Group by userId for channel selection
    const userGroups = {};
    for (const entry of Object.values(customerMap)) {
      const userId = entry.userId;
      if (!userGroups[userId]) {
        userGroups[userId] = [];
      }
      userGroups[userId].push(entry);
    }

    for (const [userId, userCustomers] of Object.entries(userGroups)) {
      try {
        const user = await User.findById(userId).lean();
        if (!user) continue;

        const businessId = user.businessId || userId;
        const channels = await selectChannels(userId);

        for (const customerEntry of userCustomers) {
          try {
            const customer = await Customer.findById(customerEntry.customerId).lean();
            if (!customer || customer.isDeleted) {
              skipped++;
              continue;
            }

            // Build idempotency key (per customer per day)
            const dateStr = now.toISOString().substring(0, 10); // YYYY-MM-DD
            const idempotencyKey = `DUE_TODAY:${customerEntry.customerId}:${dateStr}`;

            // Build deeplink (Today screen with filter)
            const deeplink = 'ph4://today?filter=dueToday';

            // Build payload
            const metadata = buildNotificationPayload({
              kind: 'DUE_TODAY',
              entityType: 'customer',
              entityId: String(customerEntry.customerId),
              customerId: String(customerEntry.customerId),
              billId: null,
              occurredAt: now.toISOString(),
              idempotencyKey,
              deeplink,
            });

            // Compute title/body
            const {title, body} = computeTitleBody('DUE_TODAY', {
              customerName: customer.name,
              amount: customerEntry.totalPending,
            });

            // Ensure notification
            const result = await ensureNotificationOnce({
              userId,
              businessId,
              idempotencyKey,
              doc: {
                customerId: customerEntry.customerId,
                kind: 'DUE_TODAY',
                title,
                body,
                channels,
                metadata: {
                  ...metadata,
                  billCount: customerEntry.bills.length,
                  totalPending: customerEntry.totalPending,
                },
              },
            });

            if (result.created) {
              created++;
            } else {
              skipped++;
            }
          } catch (error) {
            logger.error('[DueToday] Failed to process customer', {
              error: error.message,
              customerId: customerEntry.customerId,
            });
            skipped++;
          }
        }
      } catch (error) {
        logger.error('[DueToday] Failed to process user customers', {
          error: error.message,
          userId,
        });
        skipped += userCustomers.length;
      }
    }

    return {created, skipped};
  } catch (error) {
    logger.error('[DueToday] Generator failed', error);
    throw error;
  }
}

/**
 * Generate OVERDUE_ALERT notifications
 * 
 * @param {Object} params
 * @param {Object} params.settings - BusinessSettings object
 * @returns {Promise<Object>} { created: number, skipped: number }
 */
async function generateOverdueAlertNotifications({settings}) {
  if (!settings.recoveryEnabled) {
    logger.debug('[OverdueAlert] Recovery disabled, skipping');
    return {created: 0, skipped: 0};
  }

  const now = getNowIST();
  const startOfToday = getStartOfDayIST(now);

  try {
    // Find bills overdue (dueDate < today) with pending amount
    const bills = await Bill.find({
      dueDate: {$lt: startOfToday},
      status: {$in: ['unpaid', 'partial']},
      isDeleted: {$ne: true},
    })
      .populate('userId', 'businessId')
      .lean();

    // Filter bills with actual pending amount
    const billsWithPending = bills.filter(bill => {
      const pending = bill.grandTotal - (bill.paidAmount || 0);
      return pending > 0;
    });

    if (billsWithPending.length === 0) {
      return {created: 0, skipped: 0};
    }

    let created = 0;
    let skipped = 0;

    // Group by customer (one notification per customer per day)
    const customerMap = {};
    for (const bill of billsWithPending) {
      const customerId = String(bill.customerId);
      if (!customerMap[customerId]) {
        customerMap[customerId] = {
          customerId,
          userId: String(bill.userId._id || bill.userId),
          bills: [],
          totalOverdue: 0,
        };
      }
      const pending = bill.grandTotal - (bill.paidAmount || 0);
      customerMap[customerId].bills.push(bill);
      customerMap[customerId].totalOverdue += pending;
    }

    // Group by userId
    const userGroups = {};
    for (const entry of Object.values(customerMap)) {
      const userId = entry.userId;
      if (!userGroups[userId]) {
        userGroups[userId] = [];
      }
      userGroups[userId].push(entry);
    }

    for (const [userId, userCustomers] of Object.entries(userGroups)) {
      try {
        const user = await User.findById(userId).lean();
        if (!user) continue;

        const businessId = user.businessId || userId;
        const channels = await selectChannels(userId);

        for (const customerEntry of userCustomers) {
          try {
            const customer = await Customer.findById(customerEntry.customerId).lean();
            if (!customer || customer.isDeleted) {
              skipped++;
              continue;
            }

            // Build idempotency key (per customer per day)
            const dateStr = now.toISOString().substring(0, 10); // YYYY-MM-DD
            const idempotencyKey = `OVERDUE_ALERT:${customerEntry.customerId}:${dateStr}`;

            // Build deeplink
            const deeplink = `ph4://customer/${customerEntry.customerId}?tab=recovery`;

            // Build payload
            const metadata = buildNotificationPayload({
              kind: 'OVERDUE_ALERT',
              entityType: 'customer',
              entityId: String(customerEntry.customerId),
              customerId: String(customerEntry.customerId),
              billId: null,
              occurredAt: now.toISOString(),
              idempotencyKey,
              deeplink,
            });

            // Compute title/body
            const {title, body} = computeTitleBody('OVERDUE_ALERT', {
              customerName: customer.name,
              amount: customerEntry.totalOverdue,
            });

            // Ensure notification
            const result = await ensureNotificationOnce({
              userId,
              businessId,
              idempotencyKey,
              doc: {
                customerId: customerEntry.customerId,
                kind: 'OVERDUE_ALERT',
                title,
                body,
                channels,
                metadata: {
                  ...metadata,
                  billCount: customerEntry.bills.length,
                  totalOverdue: customerEntry.totalOverdue,
                },
              },
            });

            if (result.created) {
              created++;
            } else {
              skipped++;
            }
          } catch (error) {
            logger.error('[OverdueAlert] Failed to process customer', {
              error: error.message,
              customerId: customerEntry.customerId,
            });
            skipped++;
          }
        }
      } catch (error) {
        logger.error('[OverdueAlert] Failed to process user customers', {
          error: error.message,
          userId,
        });
        skipped += userCustomers.length;
      }
    }

    return {created, skipped};
  } catch (error) {
    logger.error('[OverdueAlert] Generator failed', error);
    throw error;
  }
}

module.exports = {
  generateDueTodayNotifications,
  generateOverdueAlertNotifications,
};
