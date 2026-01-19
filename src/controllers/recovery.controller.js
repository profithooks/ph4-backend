/**
 * Recovery controllers
 */
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryEvent = require('../models/RecoveryEvent');
const FollowUpTask = require('../models/FollowUpTask');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');
const { getPromiseState, autoEscalateOverduePromise } = require('../utils/promiseEngine');
const { maybeKeepPromiseForCustomer } = require('../services/promiseAutoKeep.service');

/**
 * Get idempotency key from request
 */
const getIdempotencyKey = req => {
  return req.header('Idempotency-Key') || req.body.idempotencyKey || null;
};

/**
 * @route   GET /api/recovery
 * @desc    List all recovery cases (optional filter by customerId)
 * @access  Private
 */
exports.listRecoveryCases = async (req, res, next) => {
  try {
    const {customerId} = req.query;

    const filter = {userId: req.user._id};
    if (customerId) {
      filter.customerId = customerId;
    }

    const cases = await RecoveryCase.find(filter).sort({createdAt: -1});

    // Compute promise status for each case
    const now = new Date();
    const casesWithStatus = cases.map(c => {
      const caseObj = c.toObject();
      if (caseObj.promiseAt) {
        caseObj.promiseStatus = getPromiseState(caseObj.promiseAt, now);
      }
      return caseObj;
    });

    res.status(200).json({
      success: true,
      data: casesWithStatus,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/recovery/:customerId
 * @desc    Get recovery case for customer
 * @access  Private
 */
exports.getRecoveryCase = async (req, res, next) => {
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

    const recoveryCase = await RecoveryCase.findOne({
      userId: req.user._id,
      customerId,
      status: {$nin: ['paid', 'dropped']},
    }).sort({createdAt: -1});

    res.status(200).json({
      success: true,
      data: recoveryCase,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/recovery/open
 * @desc    Open recovery case
 * @access  Private
 */
exports.openCase = async (req, res, next) => {
  try {
    const {customerId, outstandingSnapshot, notes} = req.body;
    const idempotencyKey = getIdempotencyKey(req);

    // Validate
    if (!customerId || outstandingSnapshot == null) {
      return next(
        new AppError(
          'customerId and outstandingSnapshot are required',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    if (!idempotencyKey) {
      console.warn('Recovery open without idempotency key - allowing but logging');
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await RecoveryCase.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existing) {
        console.log(
          `Idempotent recovery open request: ${idempotencyKey} - returning existing`,
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

    // Create recovery case
    const recoveryCase = await RecoveryCase.create({
      userId: req.user._id,
      customerId,
      customerSnapshot,
      status: 'open',
      outstandingSnapshot,
      notes: notes || '',
      idempotencyKey: idempotencyKey || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    res.status(201).json({
      success: true,
      data: recoveryCase,
    });
  } catch (error) {
    // Handle duplicate key error from unique index
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      const idempotencyKey = getIdempotencyKey(req);
      const existing = await RecoveryCase.findOne({
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
 * @route   POST /api/recovery/promise
 * @desc    Set promise date (idempotent via RecoveryEvent)
 * @access  Private
 */
exports.setPromise = async (req, res, next) => {
  try {
    const {caseId, promiseAt, promiseAmount, notes} = req.body;
    const idempotencyKey = getIdempotencyKey(req);

    // Validate
    if (!caseId || !promiseAt) {
      return next(
        new AppError(
          'caseId and promiseAt are required',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    // Validate promiseAt is a valid date
    const promiseDate = new Date(promiseAt);
    if (isNaN(promiseDate.getTime())) {
      return next(
        new AppError(
          'promiseAt must be a valid ISO date string',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    if (!idempotencyKey) {
      console.warn('Recovery promise without idempotency key - allowing but logging');
    }

    // Check idempotency via RecoveryEvent
    if (idempotencyKey) {
      const existingEvent = await RecoveryEvent.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existingEvent) {
        // Return current case state
        const currentCase = await RecoveryCase.findById(existingEvent.resultCaseId);
        console.log(
          `Idempotent recovery promise request: ${idempotencyKey} - returning existing`,
        );
        return res.status(200).json({
          success: true,
          data: currentCase,
        });
      }
    }

    // Find and update case
    let recoveryCase = await RecoveryCase.findById(caseId);

    if (!recoveryCase) {
      return next(new AppError('Recovery case not found', 404, 'NOT_FOUND'));
    }

    if (recoveryCase.userId.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized', 403, 'FORBIDDEN'));
    }

    // Compute promise state
    const promiseState = getPromiseState(promiseDate);

    recoveryCase.status = 'promised';
    recoveryCase.promiseAt = promiseDate;
    recoveryCase.promiseAmount = promiseAmount || recoveryCase.outstandingSnapshot;
    recoveryCase.promiseStatus = promiseState;
    recoveryCase.promiseUpdatedAt = new Date();
    if (notes) {
      recoveryCase.notes = notes;
    }

    await recoveryCase.save();

    // Check if promise is already overdue and auto-escalate
    const escalation = autoEscalateOverduePromise(recoveryCase);
    let autoFollowup = null;

    if (escalation.shouldEscalate) {
      // Mark promise as broken
      recoveryCase.promiseStatus = escalation.newStatus;
      recoveryCase.priority = escalation.newPriority;
      await recoveryCase.save();

      // Create auto-escalation followup
      try {
        const followupIdempotencyKey = `auto_escalate_promise:${caseId}:${promiseDate.toISOString()}`;
        const existingFollowup = await FollowUpTask.findOne({
          userId: req.user._id,
          idempotencyKey: followupIdempotencyKey,
        });

        if (!existingFollowup) {
          autoFollowup = await FollowUpTask.create({
            userId: req.user._id,
            customerId: recoveryCase.customerId,
            title: 'ESCALATION: Promise broken',
            note: `Promise missed by ${escalation.daysOverdue}d. Follow up immediately.`,
            dueAt: new Date(escalation.followupDueAt),
            status: 'pending',
            priority: 'high',
            metadata: {
              source: 'AUTO_PROMISE_ESCALATION',
              recoveryCaseId: caseId,
              originalPromiseAt: promiseDate.toISOString(),
            },
            idempotencyKey: followupIdempotencyKey,
          });
        }
      } catch (followupError) {
        console.error('Failed to create auto-escalation followup:', followupError.message);
      }
    }

    // Record event for idempotency
    if (idempotencyKey) {
      try {
        await RecoveryEvent.create({
          userId: req.user._id,
          caseId: recoveryCase._id,
          type: 'PROMISE',
          idempotencyKey,
          payload: {promiseAt, promiseAmount, notes},
          resultCaseId: recoveryCase._id,
        });
      } catch (eventError) {
        // Event creation failed (possible race), but case was updated
        console.warn('RecoveryEvent creation failed:', eventError.message);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        recoveryCase,
        autoFollowup,
        escalation: escalation.shouldEscalate ? escalation : null,
      },
    });
  } catch (error) {
    // Handle duplicate key error on event
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      const idempotencyKey = getIdempotencyKey(req);
      const existingEvent = await RecoveryEvent.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existingEvent) {
        const currentCase = await RecoveryCase.findById(existingEvent.resultCaseId);
        return res.status(200).json({
          success: true,
          data: currentCase,
        });
      }
    }

    next(error);
  }
};

/**
 * @route   POST /api/recovery/status
 * @desc    Update case status (idempotent via RecoveryEvent)
 * @access  Private
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const {caseId, status, notes} = req.body;
    const idempotencyKey = getIdempotencyKey(req);

    // Validate
    if (!caseId || !status) {
      return next(
        new AppError(
          'caseId and status are required',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    const validStatuses = ['open', 'promised', 'paid', 'disputed', 'dropped'];
    if (!validStatuses.includes(status)) {
      return next(new AppError('Invalid status', 400, 'VALIDATION_ERROR'));
    }

    if (!idempotencyKey) {
      console.warn('Recovery status update without idempotency key - allowing but logging');
    }

    // Check idempotency via RecoveryEvent
    if (idempotencyKey) {
      const existingEvent = await RecoveryEvent.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existingEvent) {
        const currentCase = await RecoveryCase.findById(existingEvent.resultCaseId);
        console.log(
          `Idempotent recovery status request: ${idempotencyKey} - returning existing`,
        );
        return res.status(200).json({
          success: true,
          data: currentCase,
        });
      }
    }

    // Find and update case
    let recoveryCase = await RecoveryCase.findById(caseId);

    if (!recoveryCase) {
      return next(new AppError('Recovery case not found', 404, 'NOT_FOUND'));
    }

    if (recoveryCase.userId.toString() !== req.user._id.toString()) {
      return next(new AppError('Not authorized', 403, 'FORBIDDEN'));
    }

    recoveryCase.status = status;
    if (notes) {
      recoveryCase.notes = notes;
    }

    await recoveryCase.save();

    // Record event for idempotency
    if (idempotencyKey) {
      try {
        await RecoveryEvent.create({
          userId: req.user._id,
          caseId: recoveryCase._id,
          type: 'STATUS',
          idempotencyKey,
          payload: {status, notes},
          resultCaseId: recoveryCase._id,
        });
      } catch (eventError) {
        console.warn('RecoveryEvent creation failed:', eventError.message);
      }
    }

    res.status(200).json({
      success: true,
      data: recoveryCase,
    });
  } catch (error) {
    // Handle duplicate key error on event
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      const idempotencyKey = getIdempotencyKey(req);
      const existingEvent = await RecoveryEvent.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existingEvent) {
        const currentCase = await RecoveryCase.findById(existingEvent.resultCaseId);
        return res.status(200).json({
          success: true,
          data: currentCase,
        });
      }
    }

    next(error);
  }
};

/**
 * @route   POST /api/recovery/auto-keep
 * @desc    Auto-keep promise after payment (idempotent)
 * @access  Private
 */
exports.autoKeepPromise = async (req, res, next) => {
  try {
    const { customerId, paymentRef, newDue } = req.body;
    const idempotencyKey = getIdempotencyKey(req);

    if (!customerId || !paymentRef) {
      return next(
        new AppError(
          'customerId and paymentRef are required',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    if (!idempotencyKey) {
      console.warn('[autoKeepPromise] No idempotency key provided');
    }

    const result = await maybeKeepPromiseForCustomer({
      userId: req.user._id,
      customerId,
      paymentRef,
      idempotencyKey: idempotencyKey || `AUTO_KEEP::${customerId}::${paymentRef}`,
      newDue: newDue !== undefined ? newDue : null,
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
  listRecoveryCases: exports.listRecoveryCases,
  getRecoveryCase: exports.getRecoveryCase,
  openCase: exports.openCase,
  setPromise: exports.setPromise,
  updateStatus: exports.updateStatus,
  autoKeepPromise: exports.autoKeepPromise,
};
