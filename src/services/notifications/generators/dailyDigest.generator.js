/**
 * Daily Digest Notification Generators
 * 
 * Generates two daily digests:
 * 1. Morning (09:00 IST): Today brief (overdue + due today + due tomorrow)
 * 2. EOD (20:30 IST): Day recap (completed today + still pending + tomorrow preview)
 */

const User = require('../../../models/User');
const FollowUpTask = require('../../../models/FollowUpTask');
const Notification = require('../../../models/Notification');
const {getIstDayWindow, getIstTomorrowWindow} = require('../../../utils/istWindow');
const {selectChannels} = require('../channelSelector');
const {createNotification} = require('../../notificationService');
const logger = require('../../../utils/logger');

/**
 * Compute followup counts and top items for a user
 * 
 * @param {string} userId - User ID
 * @param {Object} windows - Date windows {today, tomorrow}
 * @param {boolean} includeCompleted - Include completed tasks for EOD
 * @returns {Promise<Object>} { counts, top }
 */
async function computeFollowupData(userId, windows, includeCompleted = false) {
  const {today, tomorrow} = windows;
  
  // Query base filters
  const baseQuery = {
    userId,
    isDeleted: {$ne: true},
  };

  try {
    // Overdue count
    const overdueCount = await FollowUpTask.countDocuments({
      ...baseQuery,
      dueAt: {$lt: today.startUtc},
      status: {$ne: 'done'},
    });

    // Due today count (pending)
    const dueTodayCount = await FollowUpTask.countDocuments({
      ...baseQuery,
      dueAt: {
        $gte: today.startUtc,
        $lte: today.endUtc,
      },
      status: {$ne: 'done'},
    });

    // Due tomorrow count
    const dueTomorrowCount = await FollowUpTask.countDocuments({
      ...baseQuery,
      dueAt: {
        $gte: tomorrow.startUtc,
        $lte: tomorrow.endUtc,
      },
      status: {$ne: 'done'},
    });

    // Completed today count (for EOD)
    const doneTodayCount = includeCompleted
      ? await FollowUpTask.countDocuments({
          ...baseQuery,
          status: 'done',
          updatedAt: {
            $gte: today.startUtc,
            $lte: today.endUtc,
          },
        })
      : 0;

    // Fetch top items (max 3 each)
    const topOverdue = await FollowUpTask.find({
      ...baseQuery,
      dueAt: {$lt: today.startUtc},
      status: {$ne: 'done'},
    })
      .sort({dueAt: 1})
      .limit(3)
      .populate('customerId', 'name')
      .lean();

    const topToday = await FollowUpTask.find({
      ...baseQuery,
      dueAt: {
        $gte: today.startUtc,
        $lte: today.endUtc,
      },
      status: {$ne: 'done'},
    })
      .sort({dueAt: 1})
      .limit(3)
      .populate('customerId', 'name')
      .lean();

    const topTomorrow = await FollowUpTask.find({
      ...baseQuery,
      dueAt: {
        $gte: tomorrow.startUtc,
        $lte: tomorrow.endUtc,
      },
      status: {$ne: 'done'},
    })
      .sort({dueAt: 1})
      .limit(3)
      .populate('customerId', 'name')
      .lean();

    // Format top items
    const formatItem = (task) => ({
      id: String(task._id),
      title: task.customerSnapshot?.name || task.customerId?.name || 'Customer',
      note: task.note || task.title || '',
    });

    return {
      counts: {
        overdue: overdueCount,
        dueToday: dueTodayCount,
        dueTomorrow: dueTomorrowCount,
        doneToday: doneTodayCount,
      },
      top: {
        overdue: topOverdue.map(formatItem),
        today: topToday.map(formatItem),
        tomorrow: topTomorrow.map(formatItem),
      },
    };
  } catch (error) {
    logger.error('[DailyDigest] Failed to compute followup data', {
      error: error.message,
      userId,
    });
    throw error;
  }
}

/**
 * Build notification title and body for AM digest
 * 
 * @param {Object} counts - Counts object
 * @param {Object} top - Top items object
 * @returns {Object} { title, body }
 */
function buildAmContent(counts, top) {
  const {overdue, dueToday, dueTomorrow} = counts;
  
  // Title
  const totalPending = overdue + dueToday;
  let title = '☀️ Good morning!';
  
  if (totalPending > 0) {
    title = `☀️ ${totalPending} follow-up${totalPending > 1 ? 's' : ''} pending today`;
  }

  // Body
  const parts = [];
  
  if (overdue > 0) {
    parts.push(`⚠️ ${overdue} overdue`);
    if (top.overdue.length > 0) {
      const names = top.overdue.map(t => t.title).slice(0, 2);
      parts.push(`   (${names.join(', ')}${overdue > 2 ? ` +${overdue - 2} more` : ''})`);
    }
  }
  
  if (dueToday > 0) {
    parts.push(`📋 ${dueToday} due today`);
    if (top.today.length > 0) {
      const names = top.today.map(t => t.title).slice(0, 2);
      parts.push(`   (${names.join(', ')}${dueToday > 2 ? ` +${dueToday - 2} more` : ''})`);
    }
  }
  
  if (dueTomorrow > 0) {
    parts.push(`📅 ${dueTomorrow} scheduled tomorrow`);
  }

  if (parts.length === 0) {
    parts.push('✨ You\'re all caught up! No pending follow-ups.');
  }

  const body = parts.join('\n');

  return {title, body};
}

/**
 * Build notification title and body for EOD digest
 * 
 * @param {Object} counts - Counts object
 * @param {Object} top - Top items object
 * @returns {Object} { title, body }
 */
function buildEodContent(counts, top) {
  const {doneToday, dueToday, dueTomorrow} = counts;
  
  // Title
  let title = '🌙 Day recap';
  
  if (doneToday > 0) {
    title = `🌙 ${doneToday} completed today!`;
  }

  // Body
  const parts = [];
  
  if (doneToday > 0) {
    parts.push(`✅ ${doneToday} follow-up${doneToday > 1 ? 's' : ''} completed`);
  }
  
  if (dueToday > 0) {
    parts.push(`⏰ ${dueToday} still pending from today`);
    if (top.today.length > 0) {
      const names = top.today.map(t => t.title).slice(0, 2);
      parts.push(`   (${names.join(', ')}${dueToday > 2 ? ` +${dueToday - 2} more` : ''})`);
    }
  }
  
  if (dueTomorrow > 0) {
    parts.push(`\n📅 Tomorrow: ${dueTomorrow} follow-up${dueTomorrow > 1 ? 's' : ''}`);
    if (top.tomorrow.length > 0) {
      const names = top.tomorrow.map(t => t.title).slice(0, 2);
      parts.push(`   (${names.join(', ')}${dueTomorrow > 2 ? ` +${dueTomorrow - 2} more` : ''})`);
    }
  }

  if (parts.length === 0) {
    parts.push('✨ All quiet today. Ready for tomorrow!');
  }

  const body = parts.join('\n');

  return {title, body};
}

/**
 * Generate Daily Digest AM notifications (Morning - 09:00 IST)
 * 
 * @param {Object} options
 * @param {Date} [options.date=new Date()] - Date to generate for (defaults to today)
 * @returns {Promise<Object>} { created, skipped }
 */
async function generateDailyDigestAM({date = new Date()} = {}) {
  const startTime = Date.now();
  
  try {
    // Compute IST windows
    const today = getIstDayWindow(date);
    const tomorrow = getIstTomorrowWindow(date);
    
    logger.info('[DailyDigestAM] ▶️  Generator started', {
      dayKey: today.dayKey,
    });

    // Get all active users
    const users = await User.find({}).select('_id businessId').lean();

    if (users.length === 0) {
      logger.info('[DailyDigestAM] ⏭️  No users found');
      return {created: 0, skipped: 0};
    }

    let created = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        const userId = String(user._id);
        const businessId = user.businessId || userId;

        // Compute followup data
        const data = await computeFollowupData(userId, {today, tomorrow}, false);

        // Skip if no relevant counts
        if (
          data.counts.overdue === 0 &&
          data.counts.dueToday === 0 &&
          data.counts.dueTomorrow === 0
        ) {
          skipped++;
          continue;
        }

        // Build content
        const {title, body} = buildAmContent(data.counts, data.top);

        // Idempotency key
        const idempotencyKey = `daily_digest_am:${userId}:${today.dayKey}`;

        // Get channels
        const channels = await selectChannels(userId);

        // Create notification payload
        const metadata = {
          digestType: 'AM',
          dayKey: today.dayKey,
          counts: data.counts,
          top: data.top,
          route: {
            screen: 'Followups',
            filter: 'today',
          },
        };

        // Create notification with delivery attempts
        try {
          await createNotification({
            userId,
            businessId,
            customerId: null,
            kind: 'DAILY_DIGEST_AM',
            title,
            body,
            channels,
            metadata,
            idempotencyKey,
          });

          created++;
        } catch (error) {
          if (error.code === 11000) {
            // Duplicate key - already created today
            skipped++;
          } else {
            throw error;
          }
        }
      } catch (error) {
        logger.error('[DailyDigestAM] Failed to process user', {
          error: error.message,
          userId: user._id,
        });
        skipped++;
      }
    }

    const elapsed = Date.now() - startTime;

    logger.info('[DailyDigestAM] ✅ Generator completed', {
      created,
      skipped,
      total: users.length,
      elapsedMs: elapsed,
    });

    return {created, skipped};
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('[DailyDigestAM] ❌ Generator failed', {
      error: error.message,
      stack: error.stack,
      elapsedMs: elapsed,
    });
    throw error;
  }
}

/**
 * Generate Daily Digest EOD notifications (End of Day - 20:30 IST)
 * 
 * @param {Object} options
 * @param {Date} [options.date=new Date()] - Date to generate for (defaults to today)
 * @returns {Promise<Object>} { created, skipped }
 */
async function generateDailyDigestEOD({date = new Date()} = {}) {
  const startTime = Date.now();
  
  try {
    // Compute IST windows
    const today = getIstDayWindow(date);
    const tomorrow = getIstTomorrowWindow(date);
    
    logger.info('[DailyDigestEOD] ▶️  Generator started', {
      dayKey: today.dayKey,
    });

    // Get all active users
    const users = await User.find({}).select('_id businessId').lean();

    if (users.length === 0) {
      logger.info('[DailyDigestEOD] ⏭️  No users found');
      return {created: 0, skipped: 0};
    }

    let created = 0;
    let skipped = 0;

    for (const user of users) {
      try {
        const userId = String(user._id);
        const businessId = user.businessId || userId;

        // Compute followup data (include completed)
        const data = await computeFollowupData(userId, {today, tomorrow}, true);

        // Skip if no relevant counts
        if (
          data.counts.doneToday === 0 &&
          data.counts.dueToday === 0 &&
          data.counts.dueTomorrow === 0
        ) {
          skipped++;
          continue;
        }

        // Build content
        const {title, body} = buildEodContent(data.counts, data.top);

        // Idempotency key
        const idempotencyKey = `daily_digest_eod:${userId}:${today.dayKey}`;

        // Get channels
        const channels = await selectChannels(userId);

        // Create notification payload
        const metadata = {
          digestType: 'EOD',
          dayKey: today.dayKey,
          counts: data.counts,
          top: data.top,
          route: {
            screen: 'Followups',
            filter: 'tomorrow',
          },
        };

        // Create notification with delivery attempts
        try {
          await createNotification({
            userId,
            businessId,
            customerId: null,
            kind: 'DAILY_DIGEST_EOD',
            title,
            body,
            channels,
            metadata,
            idempotencyKey,
          });

          created++;
        } catch (error) {
          if (error.code === 11000) {
            // Duplicate key - already created today
            skipped++;
          } else {
            throw error;
          }
        }
      } catch (error) {
        logger.error('[DailyDigestEOD] Failed to process user', {
          error: error.message,
          userId: user._id,
        });
        skipped++;
      }
    }

    const elapsed = Date.now() - startTime;

    logger.info('[DailyDigestEOD] ✅ Generator completed', {
      created,
      skipped,
      total: users.length,
      elapsedMs: elapsed,
    });

    return {created, skipped};
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('[DailyDigestEOD] ❌ Generator failed', {
      error: error.message,
      stack: error.stack,
      elapsedMs: elapsed,
    });
    throw error;
  }
}

module.exports = {
  generateDailyDigestAM,
  generateDailyDigestEOD,
};
