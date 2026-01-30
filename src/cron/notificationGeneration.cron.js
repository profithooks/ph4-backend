/**
 * Notification Generation Cron
 * 
 * Generates notifications for various events:
 * - Follow-ups due
 * - Promises due today / broken
 * - Bills due today / overdue
 * - Daily summary
 */
const cron = require('node-cron');
const BusinessSettings = require('../models/BusinessSettings');
const {generateFollowupDueNotifications} = require('../services/notifications/generators/followupDue');
const {
  generatePromiseDueTodayNotifications,
  generatePromiseBrokenNotifications,
} = require('../services/notifications/generators/promiseNotifications');
const {
  generateDueTodayNotifications,
  generateOverdueAlertNotifications,
} = require('../services/notifications/generators/billNotifications');
const {generateDailySummaryNotifications} = require('../services/notifications/generators/dailySummary');
const {generateDailyDigestAM, generateDailyDigestEOD} = require('../services/notifications/generators/dailyDigest.generator');
const {clearCache} = require('../services/notifications/channelSelector');
const logger = require('../utils/logger');
const {nodeEnv} = require('../config/env');

let cronJob15min = null;
let cronJobDaily = null;
let cronJobEOD = null;

/**
 * Check if notifications are enabled
 * Respects settings and env flag
 * 
 * @param {Object} settings - BusinessSettings object
 * @returns {boolean}
 */
function isNotificationsEnabled(settings) {
  // Check env flag (conservative fallback)
  if (process.env.NOTIFICATIONS_ENABLED === 'false') {
    return false;
  }

  // Check feature kill switch
  if (settings?.featureKillSwitches?.notifications === true) {
    return false;
  }

  // Default: enabled (unless explicitly disabled)
  return true;
}

/**
 * Run notification generators (15-minute interval)
 * Generates: FOLLOWUP_DUE, PROMISE_DUE_TODAY, PROMISE_BROKEN, DUE_TODAY, OVERDUE_ALERT
 */
async function runNotificationGenerators() {
  try {
    logger.debug('[NotificationGenCron] Running 15-minute generators');

    // Get all users with their settings
    const settingsDocs = await BusinessSettings.find({}).lean();
    
    if (settingsDocs.length === 0) {
      return;
    }

    // Clear channel cache at start of run
    clearCache();

    let totalCreated = 0;
    let totalSkipped = 0;

    // Process each user's settings
    for (const settingsDoc of settingsDocs) {
      try {
        // Check if notifications enabled for this user
        if (!isNotificationsEnabled(settingsDoc)) {
          continue;
        }

        const settings = settingsDoc;

        // Run generators in parallel (they're independent)
        const [
          followupResult,
          promiseDueResult,
          promiseBrokenResult,
          dueTodayResult,
          overdueResult,
        ] = await Promise.all([
          generateFollowupDueNotifications({settings}),
          generatePromiseDueTodayNotifications({settings}),
          generatePromiseBrokenNotifications({settings}),
          generateDueTodayNotifications({settings}),
          generateOverdueAlertNotifications({settings}),
        ]);

        totalCreated +=
          followupResult.created +
          promiseDueResult.created +
          promiseBrokenResult.created +
          dueTodayResult.created +
          overdueResult.created;
        totalSkipped +=
          followupResult.skipped +
          promiseDueResult.skipped +
          promiseBrokenResult.skipped +
          dueTodayResult.skipped +
          overdueResult.skipped;
      } catch (error) {
        logger.error('[NotificationGenCron] Failed to process user settings', {
          error: error.message,
          userId: settingsDoc.userId,
        });
      }
    }

    if (totalCreated > 0 || totalSkipped > 0) {
      logger.info('[NotificationGenCron] 15-minute run completed', {
        created: totalCreated,
        skipped: totalSkipped,
      });
    }
  } catch (error) {
    logger.error('[NotificationGenCron] 15-minute generator failed', error);
  }
}

/**
 * Run daily summary generator (09:00 IST)
 * IST is UTC+5:30, so 09:00 IST = 03:30 UTC
 * Cron: '30 3 * * *' (03:30 UTC daily)
 * 
 * Runs ONCE per day, not per BusinessSettings row.
 * Fetches enabled userIds first, then passes to generator for filtering.
 */
async function runDailySummaryGenerator() {
  const startTime = Date.now();
  
  try {
    logger.info('[NotificationGenCron] ▶️  Daily summary generator started');

    // Fetch all business settings to determine which users have notifications enabled
    const settingsDocs = await BusinessSettings.find({}).lean();

    // Extract userIds where notifications are enabled
    const enabledUserIds = settingsDocs
      .filter(settings => isNotificationsEnabled(settings))
      .map(settings => String(settings.userId))
      .filter(Boolean);

    logger.debug('[NotificationGenCron] Daily summary: found enabled users', {
      totalSettings: settingsDocs.length,
      enabledUsers: enabledUserIds.length,
    });

    if (enabledUserIds.length === 0) {
      logger.info('[NotificationGenCron] ⏭️  Daily summary skipped: no enabled users');
      return;
    }

    clearCache();

    // Call generator ONCE with all enabled userIds
    const result = await generateDailySummaryNotifications({
      enabledUserIds,
    });

    const elapsed = Date.now() - startTime;

    logger.info('[NotificationGenCron] ✅ Daily summary generator completed', {
      created: result.created,
      skipped: result.skipped,
      enabledUsers: enabledUserIds.length,
      elapsedMs: elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('[NotificationGenCron] ❌ Daily summary generator failed', {
      error: error.message,
      stack: error.stack,
      elapsedMs: elapsed,
    });
  }
}

/**
 * Run Daily Digest AM generator (09:00 IST)
 * Morning brief: overdue + due today + due tomorrow
 * IST is UTC+5:30, so 09:00 IST = 03:30 UTC
 * Cron: '30 3 * * *' (03:30 UTC daily)
 */
async function runDailyDigestAM() {
  const startTime = Date.now();
  
  try {
    logger.info('[NotificationGenCron] ▶️  Daily Digest AM started');

    const result = await generateDailyDigestAM();

    const elapsed = Date.now() - startTime;

    logger.info('[NotificationGenCron] ✅ Daily Digest AM completed', {
      created: result.created,
      skipped: result.skipped,
      elapsedMs: elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('[NotificationGenCron] ❌ Daily Digest AM failed', {
      error: error.message,
      stack: error.stack,
      elapsedMs: elapsed,
    });
  }
}

/**
 * Run Daily Digest EOD generator (20:30 IST)
 * Day recap: completed today + still pending + tomorrow preview
 * IST is UTC+5:30, so 20:30 IST = 15:00 UTC
 * Cron: '0 15 * * *' (15:00 UTC daily)
 */
async function runDailyDigestEOD() {
  const startTime = Date.now();
  
  try {
    logger.info('[NotificationGenCron] ▶️  Daily Digest EOD started');

    const result = await generateDailyDigestEOD();

    const elapsed = Date.now() - startTime;

    logger.info('[NotificationGenCron] ✅ Daily Digest EOD completed', {
      created: result.created,
      skipped: result.skipped,
      elapsedMs: elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('[NotificationGenCron] ❌ Daily Digest EOD failed', {
      error: error.message,
      stack: error.stack,
      elapsedMs: elapsed,
    });
  }
}

/**
 * Start notification generation cron jobs
 */
function startNotificationGenerationCron() {
  // Prevent multiple instances
  if (cronJob15min || cronJobDaily || cronJobEOD) {
    logger.warn('[NotificationGenCron] Cron already running');
    return;
  }

  // Run every 15 minutes: '*/15 * * * *'
  cronJob15min = cron.schedule('*/15 * * * *', async () => {
    await runNotificationGenerators();
  });

  // Run Daily Digest AM at 09:00 IST (03:30 UTC): '30 3 * * *'
  cronJobDaily = cron.schedule('30 3 * * *', async () => {
    await runDailyDigestAM();
  });

  // Run Daily Digest EOD at 20:30 IST (15:00 UTC): '0 15 * * *'
  cronJobEOD = cron.schedule('0 15 * * *', async () => {
    await runDailyDigestEOD();
  });

  logger.info('[NotificationGenCron] Started', {
    interval15min: '*/15 * * * *',
    digestAM: '30 3 * * * (09:00 IST)',
    digestEOD: '0 15 * * * (20:30 IST)',
  });
}

/**
 * Stop notification generation cron jobs
 */
function stopNotificationGenerationCron() {
  if (cronJob15min) {
    cronJob15min.stop();
    cronJob15min = null;
  }
  if (cronJobDaily) {
    cronJobDaily.stop();
    cronJobDaily = null;
  }
  if (cronJobEOD) {
    cronJobEOD.stop();
    cronJobEOD = null;
  }
  logger.info('[NotificationGenCron] Stopped');
}

module.exports = {
  startNotificationGenerationCron,
  stopNotificationGenerationCron,
  runNotificationGenerators, // Exported for testing/dry-run
  runDailySummaryGenerator, // Exported for testing/dry-run (legacy)
  runDailyDigestAM, // Exported for testing/dry-run
  runDailyDigestEOD, // Exported for testing/dry-run
};
