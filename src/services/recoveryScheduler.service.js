/**
 * Recovery Scheduler Service
 * 
 * RESPONSIBILITY: Ensure recovery follow-up tasks exist according to plan
 * 
 * UPSERT SEMANTICS:
 * - Uses FollowUpTask.idempotencyKey for duplicate prevention
 * - Key format: {userId}_{customerId}_{source}
 * - If task already exists (pending/done), skip creation
 * - If task doesn't exist and due, create it
 * 
 * TASK LIFECYCLE:
 * 1. Created: status=pending, dueAt=computed
 * 2. Due: Cron picks up (dueAt <= now)
 * 3. Delivery attempted: NotificationAttempt created
 * 4. Sent: status updated, delivery logged
 * 5. Done/Skipped: Manually marked or auto-completed
 * 
 * IDEMPOTENCY GUARANTEE:
 * - FollowUpTask has unique index on {userId, idempotencyKey}
 * - MongoDB will reject duplicate inserts
 * - Find-or-create pattern ensures exactly-once task creation
 */

const FollowUpTask = require('../models/FollowUpTask');
const Customer = require('../models/Customer');
const Bill = require('../models/Bill');
const {computeRecoveryPlan, shouldCreateStep} = require('./recoveryPlan.service');
const {getNowIST} = require('../utils/timezone.util');
const logger = require('../utils/logger');

/**
 * Ensure recovery tasks exist for a customer
 * 
 * ALGORITHM:
 * 1. Fetch customer + overdue bills
 * 2. Compute recovery plan
 * 3. For each step in plan:
 *    a. Check if step is due (dueAt <= now + grace)
 *    b. Check if task already exists (by idempotencyKey)
 *    c. If not exists and due, create task
 * 4. Return summary (created, skipped, existing)
 * 
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.customerId - Customer ID
 * @param {Object} params.settings - Business settings
 * @param {Date} params.nowIST - Current time (for testing)
 * @returns {Promise<Object>} { created, skipped, existing, tasks }
 */
async function ensureRecoveryTasks({userId, customerId, settings = {}, nowIST = null}) {
  try {
    const now = nowIST || getNowIST();
    
    // Fetch customer
    const customer = await Customer.findOne({_id: customerId, userId}).lean();
    if (!customer) {
      throw new Error('Customer not found');
    }
    
    // Fetch overdue bills
    const overdueBills = await Bill.find({
      userId,
      customerId,
      status: {$ne: 'cancelled'},
      isDeleted: {$ne: true},
      dueDate: {$lt: now}, // Overdue
    })
      .select('_id billNo grandTotal paidAmount dueDate')
      .lean();
    
    // Compute total outstanding
    let outstandingAmount = 0;
    for (const bill of overdueBills) {
      const unpaid = Math.max(0, bill.grandTotal - (bill.paidAmount || 0));
      outstandingAmount += unpaid;
    }
    
    // If no outstanding, skip recovery
    if (outstandingAmount === 0 || overdueBills.length === 0) {
      logger.debug('[RecoveryScheduler] No outstanding, skipping recovery', {
        customerId,
        outstandingAmount,
      });
      
      return {
        created: 0,
        skipped: 0,
        existing: 0,
        tasks: [],
        reason: 'no_outstanding',
      };
    }
    
    // Compute recovery plan
    const plan = computeRecoveryPlan({
      customerId,
      customerName: customer.name,
      customerPhone: customer.phone,
      outstandingAmount,
      overdueBills,
      settings,
      nowIST: now,
    });
    
    if (!plan.enabled || plan.steps.length === 0) {
      logger.debug('[RecoveryScheduler] Recovery not enabled or no steps', {
        customerId,
      });
      
      return {
        created: 0,
        skipped: 0,
        existing: 0,
        tasks: [],
        reason: 'recovery_disabled',
      };
    }
    
    // Ensure tasks for due steps
    const results = {
      created: 0,
      skipped: 0,
      existing: 0,
      tasks: [],
    };
    
    for (const step of plan.steps) {
      // Check if step is due
      if (!shouldCreateStep(step, now, 0)) {
        logger.debug('[RecoveryScheduler] Step not due yet', {
          customerId,
          stepKey: step.stepKey,
          dueAt: step.dueAt,
        });
        results.skipped++;
        continue;
      }
      
      // Idempotency key
      const idempotencyKey = `${userId}_${customerId}_${step.source}`;
      
      // Check if task already exists
      const existingTask = await FollowUpTask.findOne({
        userId,
        idempotencyKey,
      }).lean();
      
      if (existingTask) {
        logger.debug('[RecoveryScheduler] Task already exists', {
          customerId,
          stepKey: step.stepKey,
          taskId: existingTask._id,
          status: existingTask.status,
        });
        results.existing++;
        results.tasks.push({
          taskId: existingTask._id,
          stepKey: step.stepKey,
          status: existingTask.status,
          created: false,
        });
        continue;
      }
      
      // Create task
      try {
        const task = await FollowUpTask.create({
          userId,
          customerId,
          customerSnapshot: {
            name: customer.name,
            phone: customer.phone,
          },
          channel: 'whatsapp', // Default channel (can be configured)
          dueAt: step.dueAt,
          status: 'pending',
          followupStatus: 'OPEN',
          balance: outstandingAmount,
          title: step.title,
          note: step.body,
          source: step.source,
          reason: 'recovery',
          escalationLevel: step.escalationLevel,
          priority: step.priority,
          metadata: step.metadata,
          idempotencyKey,
        });
        
        logger.info('[RecoveryScheduler] Task created', {
          customerId,
          stepKey: step.stepKey,
          taskId: task._id,
          dueAt: step.dueAt,
        });
        
        results.created++;
        results.tasks.push({
          taskId: task._id,
          stepKey: step.stepKey,
          status: 'pending',
          created: true,
        });
      } catch (createError) {
        // Handle duplicate key error (idempotency violation)
        if (createError.code === 11000) {
          logger.warn('[RecoveryScheduler] Duplicate task detected (race condition)', {
            customerId,
            stepKey: step.stepKey,
            idempotencyKey,
          });
          results.existing++;
        } else {
          throw createError;
        }
      }
    }
    
    logger.info('[RecoveryScheduler] Recovery tasks ensured', {
      customerId,
      ...results,
    });
    
    return results;
  } catch (error) {
    logger.error('[RecoveryScheduler] Failed to ensure recovery tasks', error, {
      userId,
      customerId,
    });
    throw error;
  }
}

/**
 * Batch ensure recovery tasks for multiple customers
 * 
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {Array} params.customerIds - Array of customer IDs
 * @param {Object} params.settings - Business settings
 * @returns {Promise<Object>} { totalCreated, totalSkipped, totalExisting, results }
 */
async function batchEnsureRecoveryTasks({userId, customerIds, settings = {}}) {
  const summary = {
    totalCreated: 0,
    totalSkipped: 0,
    totalExisting: 0,
    results: [],
  };
  
  for (const customerId of customerIds) {
    try {
      const result = await ensureRecoveryTasks({userId, customerId, settings});
      
      summary.totalCreated += result.created;
      summary.totalSkipped += result.skipped;
      summary.totalExisting += result.existing;
      summary.results.push({
        customerId,
        ...result,
      });
    } catch (error) {
      logger.error('[RecoveryScheduler] Batch task creation failed for customer', error, {
        customerId,
      });
      
      summary.results.push({
        customerId,
        error: error.message,
      });
    }
  }
  
  logger.info('[RecoveryScheduler] Batch recovery tasks ensured', {
    userId,
    customersProcessed: customerIds.length,
    ...summary,
  });
  
  return summary;
}

module.exports = {
  ensureRecoveryTasks,
  batchEnsureRecoveryTasks,
};
