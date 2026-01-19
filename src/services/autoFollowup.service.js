/**
 * Auto Follow-Up Generation Service
 * Automatically creates follow-up tasks for customers with outstanding dues
 */

const FollowUpTask = require('../models/FollowUpTask');
const RecoveryCase = require('../models/RecoveryCase');
const Customer = require('../models/Customer');
const LedgerTransaction = require('../models/LedgerTransaction');

/**
 * Get customer due amount from ledger
 * @param {string} userId - User ID
 * @param {string} customerId - Customer ID
 * @returns {Promise<number>} - Outstanding amount (negative = customer owes)
 */
async function getCustomerDue(userId, customerId) {
  const transactions = await LedgerTransaction.find({ userId, customerId });
  
  const balance = transactions.reduce((sum, txn) => sum + txn.amount, 0);
  
  // Negative balance means customer owes money
  return Math.abs(Math.min(balance, 0));
}

/**
 * Check if customer has active promise in grace period
 * @param {string} userId - User ID
 * @param {string} customerId - Customer ID
 * @param {Date} now - Current time
 * @param {number} graceDays - Grace days after promise
 * @returns {Promise<boolean>}
 */
async function hasActivePromiseInGrace(userId, customerId, now, graceDays = 1) {
  const graceEndMs = now.getTime() + (graceDays * 24 * 60 * 60 * 1000);
  
  const activeCase = await RecoveryCase.findOne({
    userId,
    customerId,
    promiseStatus: { $in: ['ACTIVE', 'DUE_TODAY'] },
    promiseAt: { $lte: new Date(graceEndMs) },
  });
  
  return !!activeCase;
}

/**
 * Check if customer has active follow-up in cadence window
 * @param {string} userId - User ID
 * @param {string} customerId - Customer ID
 * @param {Date} windowStart - Window start
 * @param {Date} windowEnd - Window end
 * @returns {Promise<boolean>}
 */
async function hasActiveFollowupInWindow(userId, customerId, windowStart, windowEnd) {
  const existingTask = await FollowUpTask.findOne({
    userId,
    customerId,
    status: 'pending',
    dueAt: { $gte: windowStart, $lte: windowEnd },
  });
  
  return !!existingTask;
}

/**
 * Generate auto follow-ups for all eligible customers
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.todayISO - Today's date (ISO)
 * @param {string} params.idempotencyKey - Overall generation idempotency key
 * @param {Object} params.settings - Auto followup settings
 * @returns {Promise<Object>} - { createdCount, skippedCount, createdTaskIds }
 */
async function generateAutoFollowupsForUser({
  userId,
  todayISO,
  idempotencyKey,
  settings = {},
}) {
  const {
    autoFollowupEnabled = false,
    autoFollowupCadence = 'daily',
    autoFollowupTimeLocal = '10:00',
    minDueToTrigger = 1,
    graceDaysAfterPromise = 1,
    maxAutoTasksPerDay = 50,
  } = settings;

  if (!autoFollowupEnabled) {
    return { createdCount: 0, skippedCount: 0, createdTaskIds: [], reason: 'disabled' };
  }

  const now = new Date(todayISO || new Date().toISOString());
  const [hour, minute] = autoFollowupTimeLocal.split(':').map(Number);
  
  // Get all customers
  const customers = await Customer.find({ userId });
  
  const createdTaskIds = [];
  let skippedCount = 0;

  for (const customer of customers) {
    if (createdTaskIds.length >= maxAutoTasksPerDay) {
      console.log('[AutoFollowup] Max tasks per day reached:', maxAutoTasksPerDay);
      break;
    }

    try {
      // Get customer due
      const due = await getCustomerDue(userId, customer._id);
      
      if (due < minDueToTrigger) {
        skippedCount++;
        continue;
      }

      // Check if has active promise in grace period
      const hasPromise = await hasActivePromiseInGrace(
        userId,
        customer._id,
        now,
        graceDaysAfterPromise
      );
      
      if (hasPromise) {
        skippedCount++;
        continue;
      }

      // Determine cadence window
      let windowStart, windowEnd;
      
      if (autoFollowupCadence === 'daily') {
        // Daily: check if task exists for today
        windowStart = new Date(now);
        windowStart.setHours(0, 0, 0, 0);
        windowEnd = new Date(now);
        windowEnd.setHours(23, 59, 59, 999);
      } else {
        // Weekly: check if task exists this week
        const dayOfWeek = now.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday is week start
        windowStart = new Date(now);
        windowStart.setDate(windowStart.getDate() + diff);
        windowStart.setHours(0, 0, 0, 0);
        windowEnd = new Date(windowStart);
        windowEnd.setDate(windowEnd.getDate() + 6);
        windowEnd.setHours(23, 59, 59, 999);
      }

      // Check if active follow-up exists in window
      const hasFollowup = await hasActiveFollowupInWindow(
        userId,
        customer._id,
        windowStart,
        windowEnd
      );
      
      if (hasFollowup) {
        skippedCount++;
        continue;
      }

      // Generate task
      const dueAt = new Date(now);
      dueAt.setHours(hour, minute, 0, 0);
      
      const taskIdempotencyKey = `AUTO_FOLLOWUP::${userId}::${customer._id}::${autoFollowupCadence}::${now.toISOString().split('T')[0]}`;
      
      // Check if already exists
      const existing = await FollowUpTask.findOne({
        userId,
        idempotencyKey: taskIdempotencyKey,
      });
      
      if (existing) {
        skippedCount++;
        continue;
      }

      // Create task
      const task = await FollowUpTask.create({
        userId,
        customerId: customer._id,
        channel: 'whatsapp',
        dueAt,
        status: 'pending',
        balance: -due, // Negative = customer owes
        note: `Auto follow-up (${autoFollowupCadence})`,
        reason: 'auto_due_followup',
        metadata: {
          source: 'AUTO_DUE_FOLLOWUP',
          generatedBy: 'AUTO_ENGINE',
          dueSnapshot: due,
          cadence: autoFollowupCadence,
          generatedAt: now.toISOString(),
        },
        idempotencyKey: taskIdempotencyKey,
      });

      createdTaskIds.push(task._id);
    } catch (error) {
      console.error('[AutoFollowup] Error generating for customer:', customer._id, error);
      skippedCount++;
    }
  }

  return {
    createdCount: createdTaskIds.length,
    skippedCount,
    createdTaskIds,
  };
}

module.exports = {
  generateAutoFollowupsForUser,
  getCustomerDue,
  hasActivePromiseInGrace,
  hasActiveFollowupInWindow,
};
