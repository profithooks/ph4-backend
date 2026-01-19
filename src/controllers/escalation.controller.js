/**
 * Escalate Promise (IDEMPOTENT)
 * @route POST /api/recovery/:caseId/escalate
 */
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryEvent = require('../models/RecoveryEvent');
const FollowUpTask = require('../models/FollowUpTask');
const AppError = require('../utils/AppError');
const { evaluatePromiseEscalation } = require('../utils/escalationEvaluator');

// Helper to get idempotency key from request or generate one
const getIdempotencyKey = (req) => {
  return req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
};

exports.escalatePromise = async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const idempotencyKey = getIdempotencyKey(req);
    const now = new Date();

    // Find case
    const recoveryCase = await RecoveryCase.findOne({
      _id: caseId,
      userId: req.user._id,
    });

    if (!recoveryCase) {
      return next(new AppError('Recovery case not found', 404, 'NOT_FOUND'));
    }

    // Evaluate escalation
    const evaluation = evaluatePromiseEscalation(recoveryCase.toObject(), now);

    if (!evaluation.shouldEscalate) {
      return res.status(200).json({
        success: true,
        message: `No escalation needed: ${evaluation.reason}`,
        data: {
          escalated: false,
          reason: evaluation.reason,
          currentLevel: recoveryCase.escalationLevel,
        },
      });
    }

    // Generate idempotency key for this escalation level
    const escalationIdempotencyKey =
      idempotencyKey || `ESC_PROMISE_${caseId}_L${evaluation.newLevel}`;

    // Check if escalation already recorded
    const existingEvent = await RecoveryEvent.findOne({
      userId: req.user._id,
      caseId,
      type: 'ESCALATION',
      idempotencyKey: escalationIdempotencyKey,
    });

    if (existingEvent) {
      return res.status(200).json({
        success: true,
        message: 'Escalation already applied',
        data: {
          escalated: false,
          reason: 'ALREADY_ESCALATED',
          level: evaluation.newLevel,
          event: existingEvent,
        },
      });
    }

    // Update recovery case
    recoveryCase.escalationLevel = evaluation.newLevel;
    recoveryCase.brokenPromisesCount = (recoveryCase.brokenPromisesCount || 0) + 1;
    recoveryCase.lastPromiseAt = recoveryCase.promiseAt;
    recoveryCase.promiseStatus = 'BROKEN';
    await recoveryCase.save();

    // Create escalation event
    const event = await RecoveryEvent.create({
      userId: req.user._id,
      caseId,
      customerId: recoveryCase.customerId,
      type: 'ESCALATION',
      note: `Escalated to level ${evaluation.newLevel}: ${evaluation.reason}`,
      metadata: {
        oldLevel: evaluation.newLevel - 1,
        newLevel: evaluation.newLevel,
        reason: evaluation.reason,
        promiseAt: recoveryCase.promiseAt,
      },
      idempotencyKey: escalationIdempotencyKey,
    });

    // Auto-create follow-up task
    const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +1 day
    dueAt.setHours(10, 0, 0, 0);

    const taskIdempotencyKey = `AUTO_ESC_FOLLOWUP_${caseId}_L${evaluation.newLevel}`;

    // Check if followup already exists
    const existingTask = await FollowUpTask.findOne({
      userId: req.user._id,
      idempotencyKey: taskIdempotencyKey,
    });

    let followupTask = null;
    if (!existingTask) {
      followupTask = await FollowUpTask.create({
        userId: req.user._id,
        customerId: recoveryCase.customerId,
        channel: evaluation.newLevel >= 2 ? 'call' : 'whatsapp',
        dueAt,
        balance: recoveryCase.outstandingSnapshot,
        note: `Promise broken (level ${evaluation.newLevel}). Follow up required.`,
        title: `Escalation Follow-Up (Level ${evaluation.newLevel})`,
        source: 'AUTO_ESCALATION',
        priority: evaluation.newLevel >= 2 ? 'high' : 'medium',
        status: 'pending',
        reason: 'PROMISE_BROKEN',
        metadata: {
          escalationLevel: evaluation.newLevel,
          caseId,
          reason: evaluation.reason,
        },
        idempotencyKey: taskIdempotencyKey,
      });
    }

    res.status(200).json({
      success: true,
      message: `Escalated to level ${evaluation.newLevel}`,
      data: {
        escalated: true,
        level: evaluation.newLevel,
        reason: evaluation.reason,
        case: recoveryCase,
        event,
        followupTask: followupTask || existingTask,
      },
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      return res.status(200).json({
        success: true,
        message: 'Escalation already recorded',
        data: { escalated: false, reason: 'DUPLICATE_KEY' },
      });
    }
    next(error);
  }
};
