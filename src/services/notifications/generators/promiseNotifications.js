/**
 * Promise Notification Generators
 * 
 * Generates notifications for:
 * - PROMISE_DUE_TODAY
 * - PROMISE_BROKEN
 */
const RecoveryCase = require('../../../models/RecoveryCase');
const Customer = require('../../../models/Customer');
const User = require('../../../models/User');
const {getNowIST, getStartOfDayIST, getEndOfDayIST} = require('../../../utils/timezone.util');
const {buildNotificationPayload, computeTitleBody, ensureNotificationOnce} = require('../notificationGenerator');
const {selectChannels} = require('../channelSelector');
const logger = require('../../../utils/logger');

/**
 * Generate PROMISE_DUE_TODAY notifications
 * 
 * @param {Object} params
 * @param {Object} params.settings - BusinessSettings object
 * @returns {Promise<Object>} { created: number, skipped: number }
 */
async function generatePromiseDueTodayNotifications({settings}) {
  if (!settings.recoveryEnabled) {
    logger.debug('[PromiseDueToday] Recovery disabled, skipping');
    return {created: 0, skipped: 0};
  }

  const now = getNowIST();
  const startOfToday = getStartOfDayIST(now);
  const endOfToday = getEndOfDayIST(now);

  try {
    // Find recovery cases with promises due today
    const cases = await RecoveryCase.find({
      promiseStatus: 'DUE_TODAY',
      promiseAt: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
      status: {$in: ['open', 'promised']},
    }).populate('userId', 'businessId').lean();

    if (cases.length === 0) {
      return {created: 0, skipped: 0};
    }

    let created = 0;
    let skipped = 0;

    // Group by userId
    const userGroups = {};
    for (const recoveryCase of cases) {
      const userId = String(recoveryCase.userId._id || recoveryCase.userId);
      if (!userGroups[userId]) {
        userGroups[userId] = [];
      }
      userGroups[userId].push(recoveryCase);
    }

    for (const [userId, userCases] of Object.entries(userGroups)) {
      try {
        const user = await User.findById(userId).lean();
        if (!user) continue;

        const businessId = user.businessId || userId;
        const channels = await selectChannels(userId);

        for (const recoveryCase of userCases) {
          try {
            const customer = await Customer.findById(recoveryCase.customerId).lean();
            if (!customer || customer.isDeleted) {
              skipped++;
              continue;
            }

            // Build idempotency key
            const promiseDate = new Date(recoveryCase.promiseAt);
            const dateStr = promiseDate.toISOString().substring(0, 10); // YYYY-MM-DD
            const idempotencyKey = `PROMISE_DUE_TODAY:${String(recoveryCase.customerId)}:${String(recoveryCase._id)}:${dateStr}`;

            // Build deeplink
            const deeplink = `ph4://customer/${String(recoveryCase.customerId)}?tab=promises`;

            // Build payload
            const metadata = buildNotificationPayload({
              kind: 'PROMISE_DUE_TODAY',
              entityType: 'customer',
              entityId: String(recoveryCase.customerId),
              customerId: String(recoveryCase.customerId),
              billId: null,
              occurredAt: now.toISOString(),
              idempotencyKey,
              deeplink,
            });

            // Compute title/body
            const {title, body} = computeTitleBody('PROMISE_DUE_TODAY', {
              customerName: customer.name,
              amount: recoveryCase.promiseAmount || recoveryCase.outstandingSnapshot,
            });

            // Ensure notification
            const result = await ensureNotificationOnce({
              userId,
              businessId,
              idempotencyKey,
              doc: {
                customerId: recoveryCase.customerId,
                kind: 'PROMISE_DUE_TODAY',
                title,
                body,
                channels,
                metadata: {
                  ...metadata,
                  recoveryId: String(recoveryCase._id),
                  promiseAt: recoveryCase.promiseAt,
                  promiseAmount: recoveryCase.promiseAmount,
                },
              },
            });

            if (result.created) {
              created++;
            } else {
              skipped++;
            }
          } catch (error) {
            logger.error('[PromiseDueToday] Failed to process case', {
              error: error.message,
              caseId: recoveryCase._id,
            });
            skipped++;
          }
        }
      } catch (error) {
        logger.error('[PromiseDueToday] Failed to process user cases', {
          error: error.message,
          userId,
        });
        skipped += userCases.length;
      }
    }

    return {created, skipped};
  } catch (error) {
    logger.error('[PromiseDueToday] Generator failed', error);
    throw error;
  }
}

/**
 * Generate PROMISE_BROKEN notifications
 * 
 * @param {Object} params
 * @param {Object} params.settings - BusinessSettings object
 * @returns {Promise<Object>} { created: number, skipped: number }
 */
async function generatePromiseBrokenNotifications({settings}) {
  if (!settings.recoveryEnabled) {
    logger.debug('[PromiseBroken] Recovery disabled, skipping');
    return {created: 0, skipped: 0};
  }

  const now = getNowIST();
  const startOfToday = getStartOfDayIST(now);

  try {
    // Find recovery cases with broken promises (promise date < today, status still open/promised)
    const cases = await RecoveryCase.find({
      promiseStatus: 'BROKEN',
      promiseAt: {$lt: startOfToday},
      status: {$in: ['open', 'promised']},
    }).populate('userId', 'businessId').lean();

    if (cases.length === 0) {
      return {created: 0, skipped: 0};
    }

    let created = 0;
    let skipped = 0;

    // Group by userId
    const userGroups = {};
    for (const recoveryCase of cases) {
      const userId = String(recoveryCase.userId._id || recoveryCase.userId);
      if (!userGroups[userId]) {
        userGroups[userId] = [];
      }
      userGroups[userId].push(recoveryCase);
    }

    for (const [userId, userCases] of Object.entries(userGroups)) {
      try {
        const user = await User.findById(userId).lean();
        if (!user) continue;

        const businessId = user.businessId || userId;
        const channels = await selectChannels(userId);

        for (const recoveryCase of userCases) {
          try {
            const customer = await Customer.findById(recoveryCase.customerId).lean();
            if (!customer || customer.isDeleted) {
              skipped++;
              continue;
            }

            // Build idempotency key (per day)
            const promiseDate = new Date(recoveryCase.promiseAt);
            const dateStr = promiseDate.toISOString().substring(0, 10); // YYYY-MM-DD
            const idempotencyKey = `PROMISE_BROKEN:${String(recoveryCase.customerId)}:${String(recoveryCase._id)}:${dateStr}`;

            // Build deeplink
            const deeplink = `ph4://customer/${String(recoveryCase.customerId)}?tab=promises`;

            // Build payload
            const metadata = buildNotificationPayload({
              kind: 'PROMISE_BROKEN',
              entityType: 'customer',
              entityId: String(recoveryCase.customerId),
              customerId: String(recoveryCase.customerId),
              billId: null,
              occurredAt: now.toISOString(),
              idempotencyKey,
              deeplink,
            });

            // Compute title/body
            const {title, body} = computeTitleBody('PROMISE_BROKEN', {
              customerName: customer.name,
              amount: recoveryCase.promiseAmount || recoveryCase.outstandingSnapshot,
            });

            // Ensure notification
            const result = await ensureNotificationOnce({
              userId,
              businessId,
              idempotencyKey,
              doc: {
                customerId: recoveryCase.customerId,
                kind: 'PROMISE_BROKEN',
                title,
                body,
                channels,
                metadata: {
                  ...metadata,
                  recoveryId: String(recoveryCase._id),
                  promiseAt: recoveryCase.promiseAt,
                  promiseAmount: recoveryCase.promiseAmount,
                },
              },
            });

            if (result.created) {
              created++;
            } else {
              skipped++;
            }
          } catch (error) {
            logger.error('[PromiseBroken] Failed to process case', {
              error: error.message,
              caseId: recoveryCase._id,
            });
            skipped++;
          }
        }
      } catch (error) {
        logger.error('[PromiseBroken] Failed to process user cases', {
          error: error.message,
          userId,
        });
        skipped += userCases.length;
      }
    }

    return {created, skipped};
  } catch (error) {
    logger.error('[PromiseBroken] Generator failed', error);
    throw error;
  }
}

module.exports = {
  generatePromiseDueTodayNotifications,
  generatePromiseBrokenNotifications,
};
