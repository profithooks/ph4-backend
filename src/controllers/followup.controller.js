/**
 * Follow-up controllers
 */
const FollowUpTask = require('../models/FollowUpTask');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');
const { getFollowUpStatus, autoRescheduleOverdueFollowup } = require('../utils/followupEngine');
const { generateAutoFollowupsForUser } = require('../services/autoFollowup.service');

/**
 * Get idempotency key from request
 */
const getIdempotencyKey = req => {
  return req.header('Idempotency-Key') || req.body.idempotencyKey || null;
};

/**
 * @route   GET /api/followups/:customerId
 * @desc    Get all follow-up tasks for a customer
 * @access  Private
 */
exports.getCustomerTasks = async (req, res, next) => {
  try {
    const {customerId} = req.params;

    // Verify customer exists and belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      userId: req.user._id,
    });

    if (!customer) {
      return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    }

    const tasks = await FollowUpTask.find({
      userId: req.user._id,
      customerId,
    }).sort({createdAt: -1});

    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/followups
 * @desc    List all follow-up tasks (optional filter by customerId)
 * @access  Private
 */
exports.listAllTasks = async (req, res, next) => {
  try {
    const {customerId} = req.query;

    const filter = {userId: req.user._id};
    if (customerId) {
      filter.customerId = customerId;
    }

    const tasks = await FollowUpTask.find(filter).sort({createdAt: -1});
    const now = new Date();

    // Auto-reschedule overdue tasks and compute status
    const processedTasks = [];
    const autoRescheduled = [];

    for (const task of tasks) {
      const taskObj = task.toObject();
      
      // Compute follow-up status
      taskObj.followupStatus = getFollowUpStatus(
        taskObj.dueAt,
        now,
        taskObj.status,
        taskObj.escalationLevel
      );

      // Check if should auto-reschedule
      const reschedule = autoRescheduleOverdueFollowup(taskObj, now);
      
      if (reschedule.shouldReschedule) {
        // Mark old task as skipped
        task.status = 'skipped';
        task.followupStatus = 'OVERDUE';
        await task.save();

        // Create new follow-up
        const idempotencyKey = `auto_reschedule:${taskObj._id}:${reschedule.escalationLevel}`;
        const existingReschedule = await FollowUpTask.findOne({
          userId: req.user._id,
          idempotencyKey,
        });

        if (!existingReschedule) {
          const newTask = await FollowUpTask.create({
            userId: req.user._id,
            customerId: taskObj.customerId,
            channel: taskObj.channel,
            dueAt: new Date(reschedule.newDueAt),
            balance: taskObj.balance,
            note: `Auto-rescheduled (${reschedule.daysOverdue}d overdue)${taskObj.note ? ': ' + taskObj.note : ''}`,
            reason: taskObj.reason,
            parentFollowupId: taskObj._id,
            escalationLevel: reschedule.escalationLevel,
            followupStatus: reschedule.followupStatus,
            metadata: {
              source: 'AUTO_RESCHEDULE',
              originalDueAt: taskObj.dueAt,
              daysOverdue: reschedule.daysOverdue,
            },
            idempotencyKey,
          });

          autoRescheduled.push(newTask);
          processedTasks.push(newTask.toObject());
        }

        // Don't include old task in response
        continue;
      }

      processedTasks.push(taskObj);
    }

    res.status(200).json({
      success: true,
      data: processedTasks,
      meta: {
        autoRescheduled: autoRescheduled.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/followups
 * @desc    Create follow-up task
 * @access  Private
 */
exports.createTask = async (req, res, next) => {
  try {
    const {customerId, channel, dueAt, balance, note, title, source, metadata, priority} = req.body;
    const idempotencyKey = getIdempotencyKey(req);

    // Validate
    if (!customerId || !channel || !dueAt || balance == null) {
      return next(
        new AppError(
          'customerId, channel, dueAt, and balance are required',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    // Validate dueAt is a valid date
    const dueDate = new Date(dueAt);
    if (isNaN(dueDate.getTime())) {
      return next(
        new AppError(
          'dueAt must be a valid ISO date string',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    if (!idempotencyKey) {
      console.warn(
        'Follow-up task without idempotency key - allowing but logging',
      );
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await FollowUpTask.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existing) {
        console.log(
          `Idempotent followup request: ${idempotencyKey} - returning existing`,
        );
        return res.status(200).json({
          success: true,
          data: existing,
        });
      }
    }

    // Verify customer exists and belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      userId: req.user._id,
    });

    if (!customer) {
      return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    }

    // Store customer snapshot
    const customerSnapshot = {
      name: customer.name,
      phone: customer.phone,
    };

    // Create task
    const task = await FollowUpTask.create({
      userId: req.user._id,
      customerId,
      customerSnapshot,
      channel,
      dueAt: dueDate, // Use validated Date object
      balance,
      note: note || '',
      title: title || '',
      source: source || 'MANUAL',
      priority: priority || 'medium',
      status: 'pending',
      reason: 'outstanding_balance',
      metadata: metadata || {},
      idempotencyKey: idempotencyKey || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    res.status(201).json({
      success: true,
      data: task,
    });
  } catch (error) {
    // Handle duplicate key error from unique index
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      const idempotencyKey = getIdempotencyKey(req);
      const existing = await FollowUpTask.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existing) {
        return res.status(200).json({
          success: true,
          data: existing,
        });
      }
    }

    next(error);
  }
};

/**
 * @route   POST /api/followups/auto-generate
 * @desc    Auto-generate follow-ups for all eligible customers
 * @access  Private
 */
exports.autoGenerateFollowups = async (req, res, next) => {
  try {
    const { today } = req.body;
    const idempotencyKey = req.header('Idempotency-Key') || req.body.idempotencyKey;

    if (!idempotencyKey) {
      console.warn('[autoGenerateFollowups] No idempotency key provided');
    }

    // Get user settings (for now, use defaults; later fetch from user settings)
    const settings = {
      autoFollowupEnabled: true,
      autoFollowupCadence: 'daily',
      autoFollowupTimeLocal: '10:00',
      minDueToTrigger: 1,
      graceDaysAfterPromise: 1,
      maxAutoTasksPerDay: 50,
    };

    const result = await generateAutoFollowupsForUser({
      userId: req.user._id,
      todayISO: today || new Date().toISOString(),
      idempotencyKey: idempotencyKey || `AUTO_GEN::${req.user._id}::${new Date().toISOString().split('T')[0]}`,
      settings,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listAllTasks: exports.listAllTasks,
  getCustomerTasks: exports.getCustomerTasks,
  createTask: exports.createTask,
  autoGenerateFollowups: exports.autoGenerateFollowups,
};
