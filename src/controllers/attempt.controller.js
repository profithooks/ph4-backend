/**
 * Attempt Log Controller
 * Handles contact attempt logging and auto next-action updates
 */

const asyncHandler = require('express-async-handler');
const AttemptLog = require('../models/AttemptLog');
const FollowUpTask = require('../models/FollowUpTask');
const RecoveryCase = require('../models/RecoveryCase');
const AppError = require('../utils/AppError');

/**
 * Create attempt log and trigger next-action rules
 * POST /api/attempts
 */
exports.createAttempt = asyncHandler(async (req, res) => {
  const { customerId, entityType, entityId, channel, outcome, note, promiseAt, idempotencyKey } = req.body;
  const userId = req.user._id;

  // Validation
  if (!customerId || !entityType || !entityId || !channel || !outcome) {
    throw new AppError('Missing required fields', 400, 'VALIDATION_ERROR');
  }

  if (!idempotencyKey) {
    throw new AppError('idempotencyKey is required', 400, 'VALIDATION_ERROR');
  }

  // Check idempotency
  const existing = await AttemptLog.findOne({ idempotencyKey, userId });
  if (existing) {
    return res.status(200).json({
      success: true,
      data: { attempt: existing },
      message: 'Attempt already logged (idempotent)',
    });
  }

  // Validate entity exists
  if (entityType === 'FOLLOWUP_TASK') {
    const task = await FollowUpTask.findOne({ _id: entityId, userId });
    if (!task) throw new AppError('Follow-up task not found', 404, 'NOT_FOUND');
  } else if (entityType === 'RECOVERY_CASE') {
    const recoveryCase = await RecoveryCase.findOne({ _id: entityId, userId });
    if (!recoveryCase) throw new AppError('Recovery case not found', 404, 'NOT_FOUND');
  }

  // Create attempt log
  const attempt = await AttemptLog.create({
    userId,
    customerId,
    entityType,
    entityId,
    channel,
    outcome,
    note: note || '',
    promiseAt: promiseAt || null,
    idempotencyKey,
  });

  // Apply next-action rules
  const nextActions = await applyNextActionRules({
    userId,
    customerId,
    entityType,
    entityId,
    outcome,
    promiseAt,
    attempt,
  });

  res.status(201).json({
    success: true,
    data: { attempt, nextActions },
  });
});

/**
 * List attempts
 * GET /api/attempts
 */
exports.listAttempts = asyncHandler(async (req, res) => {
  const { customerId, entityType, entityId, limit = 50 } = req.query;
  const userId = req.user._id;

  const filter = { userId };
  if (customerId) filter.customerId = customerId;
  if (entityType) filter.entityType = entityType;
  if (entityId) filter.entityId = entityId;

  const attempts = await AttemptLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit, 10));

  res.json({
    success: true,
    data: { attempts },
  });
});

/**
 * Apply next-action rules based on attempt outcome
 */
async function applyNextActionRules({ userId, customerId, entityType, entityId, outcome, promiseAt, attempt }) {
  const actions = [];

  if (entityType === 'FOLLOWUP_TASK') {
    const task = await FollowUpTask.findOne({ _id: entityId, userId });
    if (!task) return actions;

    if (outcome === 'PAID') {
      // Mark task as done
      task.status = 'done';
      task.completedAt = new Date();
      await task.save();
      actions.push({ type: 'TASK_COMPLETED', taskId: entityId });

      // Close recovery case if open
      const recoveryCase = await RecoveryCase.findOne({ customerId, userId, status: { $in: ['open', 'promised', 'active'] } });
      if (recoveryCase) {
        recoveryCase.status = 'resolved';
        recoveryCase.resolvedAt = new Date();
        await recoveryCase.save();
        actions.push({ type: 'RECOVERY_RESOLVED', caseId: recoveryCase._id });
      }
    } else if (outcome === 'PROMISED' || outcome === 'RESCHEDULED') {
      // Update promise date
      if (promiseAt) {
        const promiseDueAt = new Date(promiseAt);
        
        // Update or create recovery case with promise
        let recoveryCase = await RecoveryCase.findOne({ customerId, userId, status: { $in: ['open', 'promised', 'active'] } });
        if (!recoveryCase) {
          recoveryCase = await RecoveryCase.create({
            userId,
            customerId,
            status: 'promised',
            promiseAt: promiseDueAt,
            openedAt: new Date(),
          });
          actions.push({ type: 'RECOVERY_CASE_CREATED', caseId: recoveryCase._id });
        } else {
          recoveryCase.promiseAt = promiseDueAt;
          recoveryCase.status = 'promised';
          await recoveryCase.save();
          actions.push({ type: 'PROMISE_UPDATED', caseId: recoveryCase._id, promiseAt: promiseDueAt });
        }

        // Reschedule current followup to day after promise at 10 AM
        const followupDueAt = new Date(promiseDueAt);
        followupDueAt.setDate(followupDueAt.getDate() + 1);
        followupDueAt.setHours(10, 0, 0, 0);
        
        task.dueAt = followupDueAt;
        await task.save();
        actions.push({ type: 'TASK_RESCHEDULED', taskId: entityId, newDueAt: followupDueAt });
      }
    } else if (outcome === 'NO_ANSWER') {
      // Reschedule task to tomorrow 10 AM (max 3 attempts/week check done client-side for now)
      const nextDueAt = new Date();
      nextDueAt.setDate(nextDueAt.getDate() + 1);
      nextDueAt.setHours(10, 0, 0, 0);
      
      task.dueAt = nextDueAt;
      await task.save();
      actions.push({ type: 'TASK_RESCHEDULED', taskId: entityId, newDueAt: nextDueAt });
    } else if (outcome === 'DENIED') {
      // Escalate: reschedule to 48h at 6 PM and update recovery priority
      const nextDueAt = new Date();
      nextDueAt.setDate(nextDueAt.getDate() + 2);
      nextDueAt.setHours(18, 0, 0, 0);
      
      task.dueAt = nextDueAt;
      await task.save();
      actions.push({ type: 'TASK_RESCHEDULED', taskId: entityId, newDueAt: nextDueAt });

      // Escalate recovery case priority
      const recoveryCase = await RecoveryCase.findOne({ customerId, userId, status: { $in: ['open', 'promised', 'active'] } });
      if (recoveryCase) {
        recoveryCase.priority = 'high';
        await recoveryCase.save();
        actions.push({ type: 'RECOVERY_ESCALATED', caseId: recoveryCase._id });
      }
    }
  } else if (entityType === 'RECOVERY_CASE') {
    const recoveryCase = await RecoveryCase.findOne({ _id: entityId, userId });
    if (!recoveryCase) return actions;

    if (outcome === 'PAID') {
      // Close recovery case
      recoveryCase.status = 'resolved';
      recoveryCase.resolvedAt = new Date();
      await recoveryCase.save();
      actions.push({ type: 'RECOVERY_RESOLVED', caseId: entityId });

      // Close related followup tasks
      await FollowUpTask.updateMany(
        { customerId, userId, status: 'pending' },
        { status: 'done', completedAt: new Date() }
      );
      actions.push({ type: 'RELATED_TASKS_COMPLETED', customerId });
    } else if (outcome === 'PROMISED' || outcome === 'RESCHEDULED') {
      if (promiseAt) {
        recoveryCase.promiseAt = new Date(promiseAt);
        recoveryCase.status = 'promised';
        await recoveryCase.save();
        actions.push({ type: 'PROMISE_UPDATED', caseId: entityId, promiseAt: new Date(promiseAt) });
      }
    }
  }

  return actions;
}

module.exports = exports;
