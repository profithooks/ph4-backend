/**
 * FOLLOWUP_DUE Notification Generator
 * 
 * Generates notifications for follow-up tasks that are due
 */
const FollowUpTask = require('../../../models/FollowUpTask');
const Customer = require('../../../models/Customer');
const User = require('../../../models/User');
const {getNowIST, getStartOfDayIST, getEndOfDayIST} = require('../../../utils/timezone.util');
const {buildNotificationPayload, computeTitleBody, ensureNotificationOnce} = require('../notificationGenerator');
const {selectChannels} = require('../channelSelector');
const logger = require('../../../utils/logger');

/**
 * Generate FOLLOWUP_DUE notifications
 * 
 * @param {Object} params
 * @param {Object} params.settings - BusinessSettings object
 * @returns {Promise<Object>} { created: number, skipped: number }
 */
async function generateFollowupDueNotifications({settings}) {
  // Check if followups are enabled
  if (!settings.autoFollowupEnabled) {
    logger.debug('[FollowupDue] Auto followup disabled, skipping');
    return {created: 0, skipped: 0};
  }

  const now = getNowIST();
  const windowStart = new Date(now.getTime() - 30 * 60 * 1000); // Last 30 minutes
  const windowEnd = new Date(now.getTime() + 15 * 60 * 1000); // Next 15 minutes

  try {
    // Find pending followups due in window
    const followups = await FollowUpTask.find({
      status: 'pending',
      isDeleted: {$ne: true},
      dueAt: {
        $gte: windowStart,
        $lte: windowEnd,
      },
    }).populate('userId', 'businessId').lean();

    if (followups.length === 0) {
      return {created: 0, skipped: 0};
    }

    let created = 0;
    let skipped = 0;

    // Group by userId to batch channel selection
    const userGroups = {};
    for (const followup of followups) {
      const userId = String(followup.userId._id || followup.userId);
      if (!userGroups[userId]) {
        userGroups[userId] = [];
      }
      userGroups[userId].push(followup);
    }

    // Process each user's followups
    for (const [userId, userFollowups] of Object.entries(userGroups)) {
      try {
        const user = await User.findById(userId).lean();
        if (!user) continue;

        const businessId = user.businessId || userId;

        // Get channels once per user
        const channels = await selectChannels(userId);

        // Process each followup
        for (const followup of userFollowups) {
          try {
            const customer = await Customer.findById(followup.customerId).lean();
            if (!customer || customer.isDeleted) {
              skipped++;
              continue;
            }

            // Build idempotency key (hour bucket)
            const dueDate = new Date(followup.dueAt);
            const hourBucket = dueDate.toISOString().substring(0, 13); // YYYY-MM-DDTHH
            const idempotencyKey = `FOLLOWUP_DUE:${String(followup.customerId)}:${String(followup._id)}:${hourBucket}`;

            // Build deeplink
            const deeplink = `ph4://customer/${String(followup.customerId)}?tab=followups`;

            // Build payload
            const metadata = buildNotificationPayload({
              kind: 'FOLLOWUP_DUE',
              entityType: 'customer',
              entityId: String(followup.customerId),
              customerId: String(followup.customerId),
              billId: null,
              occurredAt: now.toISOString(),
              idempotencyKey,
              deeplink,
            });

            // Compute title/body
            const {title, body} = computeTitleBody('FOLLOWUP_DUE', {
              customerName: customer.name,
              amount: followup.balance,
            });

            // Ensure notification (idempotent)
            const result = await ensureNotificationOnce({
              userId,
              businessId,
              idempotencyKey,
              doc: {
                customerId: followup.customerId,
                kind: 'FOLLOWUP_DUE',
                title,
                body,
                channels,
                metadata: {
                  ...metadata,
                  followupId: String(followup._id),
                  dueAt: followup.dueAt,
                },
              },
            });

            if (result.created) {
              created++;
            } else {
              skipped++;
            }
          } catch (error) {
            logger.error('[FollowupDue] Failed to process followup', {
              error: error.message,
              followupId: followup._id,
            });
            skipped++;
          }
        }
      } catch (error) {
        logger.error('[FollowupDue] Failed to process user followups', {
          error: error.message,
          userId,
        });
        skipped += userFollowups.length;
      }
    }

    return {created, skipped};
  } catch (error) {
    logger.error('[FollowupDue] Generator failed', error);
    throw error;
  }
}

module.exports = {
  generateFollowupDueNotifications,
};
