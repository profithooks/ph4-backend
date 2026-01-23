/**
 * DAILY_SUMMARY Notification Generator
 * 
 * Generates daily summary notifications at 09:00 IST
 */
const User = require('../../../models/User');
const Bill = require('../../../models/Bill');
const FollowUpTask = require('../../../models/FollowUpTask');
const RecoveryCase = require('../../../models/RecoveryCase');
const {getNowIST, getStartOfDayIST, getEndOfDayIST} = require('../../../utils/timezone.util');
const {buildNotificationPayload, computeTitleBody, ensureNotificationOnce} = require('../notificationGenerator');
const {selectChannels} = require('../channelSelector');
const logger = require('../../../utils/logger');

/**
 * Generate DAILY_SUMMARY notifications
 * 
 * @param {Object} params
 * @param {Object} params.settings - BusinessSettings object (optional, for future filtering)
 * @returns {Promise<Object>} { created: number, skipped: number }
 */
async function generateDailySummaryNotifications({settings}) {
  const now = getNowIST();
  const startOfToday = getStartOfDayIST(now);
  const endOfToday = getEndOfDayIST(now);

  try {
    // Get all active users (simplified - in production might filter by plan status)
    const users = await User.find({
      // Add any user filters if needed
    }).select('_id businessId').lean();

    if (users.length === 0) {
      return {created: 0, skipped: 0};
    }

    let created = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        const userId = String(user._id);
        const businessId = user.businessId || userId;

        // Aggregate counts for today
        const [
          overdueCustomers,
          dueTodayCustomers,
          promisesDueToday,
          followupsDue,
        ] = await Promise.all([
          // Overdue customers (bills with dueDate < today and pending)
          Bill.distinct('customerId', {
            userId,
            dueDate: {$lt: startOfToday},
            status: {$in: ['unpaid', 'partial']},
            isDeleted: {$ne: true},
          }).then(async customerIds => {
            // Filter to only those with actual pending
            const bills = await Bill.find({
              userId,
              customerId: {$in: customerIds},
              dueDate: {$lt: startOfToday},
              status: {$in: ['unpaid', 'partial']},
              isDeleted: {$ne: true},
            }).lean();
            
            const customersWithPending = new Set();
            for (const bill of bills) {
              const pending = bill.grandTotal - (bill.paidAmount || 0);
              if (pending > 0) {
                customersWithPending.add(String(bill.customerId));
              }
            }
            return customersWithPending.size;
          }),

          // Due today customers
          Bill.distinct('customerId', {
            userId,
            dueDate: {
              $gte: startOfToday,
              $lte: endOfToday,
            },
            status: {$in: ['unpaid', 'partial']},
            isDeleted: {$ne: true},
          }).then(async customerIds => {
            const bills = await Bill.find({
              userId,
              customerId: {$in: customerIds},
              dueDate: {
                $gte: startOfToday,
                $lte: endOfToday,
              },
              status: {$in: ['unpaid', 'partial']},
              isDeleted: {$ne: true},
            }).lean();
            
            const customersWithPending = new Set();
            for (const bill of bills) {
              const pending = bill.grandTotal - (bill.paidAmount || 0);
              if (pending > 0) {
                customersWithPending.add(String(bill.customerId));
              }
            }
            return customersWithPending.size;
          }),

          // Promises due today
          RecoveryCase.countDocuments({
            userId,
            promiseStatus: 'DUE_TODAY',
            promiseAt: {
              $gte: startOfToday,
              $lte: endOfToday,
            },
            status: {$in: ['open', 'promised']},
          }),

          // Followups due
          FollowUpTask.countDocuments({
            userId,
            status: 'pending',
            isDeleted: {$ne: true},
            dueAt: {
              $gte: startOfToday,
              $lte: endOfToday,
            },
          }),
        ]);

        // Only create notification if there are items to summarize
        if (overdueCustomers === 0 && dueTodayCustomers === 0 && promisesDueToday === 0 && followupsDue === 0) {
          skipped++;
          continue;
        }

        // Build idempotency key
        const dateStr = now.toISOString().substring(0, 10); // YYYY-MM-DD
        const idempotencyKey = `DAILY_SUMMARY:${userId}:${dateStr}`;

        // Build deeplink
        const deeplink = 'ph4://today';

        // Build payload
        const metadata = buildNotificationPayload({
          kind: 'DAILY_SUMMARY',
          entityType: 'system',
          entityId: 'system',
          customerId: null,
          billId: null,
          occurredAt: now.toISOString(),
          idempotencyKey,
          deeplink,
        });

        // Compute title/body
        const summary = `Overdue: ${overdueCustomers}, Due Today: ${dueTodayCustomers}, Promises: ${promisesDueToday}, Follow-ups: ${followupsDue}`;
        const {title, body} = computeTitleBody('DAILY_SUMMARY', {
          summary,
        });

        // Get channels
        const channels = await selectChannels(userId);

        // Ensure notification
        const result = await ensureNotificationOnce({
          userId,
          businessId,
          idempotencyKey,
          doc: {
            customerId: null,
            kind: 'DAILY_SUMMARY',
            title,
            body,
            channels,
            metadata: {
              ...metadata,
              overdueCustomers,
              dueTodayCustomers,
              promisesDueToday,
              followupsDue,
            },
          },
        });

        if (result.created) {
          created++;
        } else {
          skipped++;
        }
      } catch (error) {
        logger.error('[DailySummary] Failed to process user', {
          error: error.message,
          userId: user._id,
        });
        skipped++;
      }
    }

    return {created, skipped};
  } catch (error) {
    logger.error('[DailySummary] Generator failed', error);
    throw error;
  }
}

module.exports = {
  generateDailySummaryNotifications,
};
