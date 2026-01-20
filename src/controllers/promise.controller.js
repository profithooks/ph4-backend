/**
 * Promise Controller
 * 
 * Create/update/cancel promises (using RecoveryCase)
 * Step 6: Recovery Engine (Cash Return)
 * 
 * TIMEZONE: All date calculations use Asia/Kolkata (IST) as canonical timezone
 */
const asyncHandler = require('express-async-handler');
const RecoveryCase = require('../models/RecoveryCase');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');
const {auditCreate, auditUpdate} = require('../services/auditHelper.service');
const {getUserRole} = require('../middleware/permission.middleware');
const logger = require('../utils/logger');
const {
  getNowIST,
  getStartOfDayIST,
  getEndOfDayIST,
  bucketDateIST,
} = require('../utils/timezone.util');

/**
 * Create or update promise for customer
 * POST /api/v1/customers/:id/promise
 */
const createCustomerPromise = asyncHandler(async (req, res) => {
  const {id: customerId} = req.params;
  const {amount, dueAt, note} = req.body;
  const userId = req.user._id;
  
  // Validate inputs
  if (!amount || amount <= 0) {
    throw new AppError('Promise amount must be greater than 0', 400, 'VALIDATION_ERROR');
  }
  
  if (!dueAt) {
    throw new AppError('Promise due date is required', 400, 'VALIDATION_ERROR');
  }
  
  const promiseDate = new Date(dueAt);
  if (isNaN(promiseDate.getTime())) {
    throw new AppError('Invalid promise due date', 400, 'VALIDATION_ERROR');
  }
  
  // Verify customer exists
  const customer = await Customer.findOne({
    _id: customerId,
    userId,
    isDeleted: {$ne: true},
  });
  
  if (!customer) {
    throw new AppError('Customer not found', 404, 'NOT_FOUND');
  }
  
  // Find or create recovery case
  let recoveryCase = await RecoveryCase.findOne({
    userId,
    customerId,
    status: {$in: ['open', 'promised', 'active']},
  });
  
  const isNew = !recoveryCase;
  const beforeState = recoveryCase ? recoveryCase.toObject() : null;
  
  if (!recoveryCase) {
    // Create new recovery case
    const idempotencyKey = `recovery:${customerId}:${Date.now()}`;
    
    recoveryCase = await RecoveryCase.create({
      userId,
      customerId,
      customerSnapshot: {
        name: customer.name,
        phone: customer.phone,
      },
      status: 'promised',
      outstandingSnapshot: amount,
      promiseAt: promiseDate,
      promiseAmount: amount,
      promiseStatus: computePromiseStatus(promiseDate, getNowIST()),
      promiseUpdatedAt: getNowIST(),
      lastPromiseAt: promiseDate,
      notes: note || '',
      idempotencyKey,
    });
    
    logger.info('[Promise] Created recovery case with promise', {
      customerId,
      amount,
      dueAt,
    });
    
    // Audit event: PROMISE_CREATED
    await auditCreate({
      action: 'PROMISE_CREATED',
      actorUserId: userId,
      actorRole: getUserRole(req),
      entityType: 'RECOVERY_CASE',
      entity: recoveryCase,
      customerId,
      businessId: req.user.businessId,
      metadata: {
        promiseAmount: amount,
        promiseDueAt: dueAt,
        note: note || null,
      },
      requestId: req.requestId,
    });
  } else {
    // Update existing promise
    recoveryCase.promiseAt = promiseDate;
    recoveryCase.promiseAmount = amount;
    recoveryCase.promiseStatus = computePromiseStatus(promiseDate, getNowIST());
    recoveryCase.promiseUpdatedAt = getNowIST();
    recoveryCase.lastPromiseAt = promiseDate;
    recoveryCase.status = 'promised';
    
    if (note) {
      recoveryCase.notes = note;
    }
    
    await recoveryCase.save();
    
    logger.info('[Promise] Updated promise', {
      recoveryCaseId: recoveryCase._id,
      customerId,
      amount,
      dueAt,
    });
    
    // Audit event: PROMISE_UPDATED
    await auditUpdate({
      action: 'PROMISE_UPDATED',
      actorUserId: userId,
      actorRole: getUserRole(req),
      entityType: 'RECOVERY_CASE',
      beforeEntity: beforeState,
      afterEntity: recoveryCase,
      customerId,
      businessId: req.user.businessId,
      metadata: {
        promiseAmount: amount,
        promiseDueAt: dueAt,
        note: note || null,
      },
      requestId: req.requestId,
    });
  }
  
  res.success({
    recoveryCase: {
      id: recoveryCase._id,
      customerId: recoveryCase.customerId,
      status: recoveryCase.status,
      promiseAt: recoveryCase.promiseAt,
      promiseAmount: recoveryCase.promiseAmount,
      promiseStatus: recoveryCase.promiseStatus,
      notes: recoveryCase.notes,
    },
    isNew,
  }, isNew ? 201 : 200);
});

/**
 * Update promise
 * PATCH /api/v1/promises/:id
 */
const updatePromise = asyncHandler(async (req, res) => {
  const {id: recoveryCaseId} = req.params;
  const {amount, dueAt, note, status} = req.body;
  const userId = req.user._id;
  
  // Find recovery case
  const recoveryCase = await RecoveryCase.findOne({
    _id: recoveryCaseId,
    userId,
  });
  
  if (!recoveryCase) {
    throw new AppError('Recovery case not found', 404, 'NOT_FOUND');
  }
  
  const beforeState = recoveryCase.toObject();
  
  // Update fields if provided
  if (amount !== undefined) {
    if (amount <= 0) {
      throw new AppError('Promise amount must be greater than 0', 400, 'VALIDATION_ERROR');
    }
    recoveryCase.promiseAmount = amount;
  }
  
  if (dueAt !== undefined) {
    const promiseDate = new Date(dueAt);
    if (isNaN(promiseDate.getTime())) {
      throw new AppError('Invalid promise due date', 400, 'VALIDATION_ERROR');
    }
    recoveryCase.promiseAt = promiseDate;
    recoveryCase.lastPromiseAt = promiseDate;
    recoveryCase.promiseStatus = computePromiseStatus(promiseDate, getNowIST());
  }
  
  if (note !== undefined) {
    recoveryCase.notes = note;
  }
  
  if (status !== undefined) {
    if (!['ACTIVE', 'CANCELLED'].includes(status)) {
      throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
    }
    
    if (status === 'CANCELLED') {
      recoveryCase.status = 'dropped';
      recoveryCase.promiseStatus = 'NONE';
      recoveryCase.promiseAt = null;
      recoveryCase.promiseAmount = null;
    }
  }
  
  recoveryCase.promiseUpdatedAt = new Date();
  
  await recoveryCase.save();
  
  logger.info('[Promise] Updated', {
    recoveryCaseId: recoveryCase._id,
    updates: {amount, dueAt, note, status},
  });
  
  // Audit event
  const action = status === 'CANCELLED' ? 'PROMISE_CANCELLED' : 'PROMISE_UPDATED';
  
  await auditUpdate({
    action,
    actorUserId: userId,
    actorRole: getUserRole(req),
    entityType: 'RECOVERY_CASE',
    beforeEntity: beforeState,
    afterEntity: recoveryCase,
    customerId: recoveryCase.customerId,
    businessId: req.user.businessId,
    metadata: {
      updates: {amount, dueAt, note, status},
    },
    requestId: req.requestId,
  });
  
  res.success({
    recoveryCase: {
      id: recoveryCase._id,
      customerId: recoveryCase.customerId,
      status: recoveryCase.status,
      promiseAt: recoveryCase.promiseAt,
      promiseAmount: recoveryCase.promiseAmount,
      promiseStatus: recoveryCase.promiseStatus,
      notes: recoveryCase.notes,
    },
  });
});

/**
 * Get customer's active promise
 * GET /api/v1/customers/:id/promise
 */
const getCustomerPromise = asyncHandler(async (req, res) => {
  const {id: customerId} = req.params;
  const userId = req.user._id;
  
  const recoveryCase = await RecoveryCase.findOne({
    userId,
    customerId,
    status: {$in: ['open', 'promised', 'active']},
    promiseAt: {$exists: true, $ne: null},
  });
  
  if (!recoveryCase) {
    return res.success({
      hasPromise: false,
      recoveryCase: null,
    });
  }
  
  // Update promise status if needed
  const now = new Date();
  const newStatus = computePromiseStatus(recoveryCase.promiseAt, now);
  
  if (newStatus !== recoveryCase.promiseStatus) {
    recoveryCase.promiseStatus = newStatus;
    await recoveryCase.save();
  }
  
  res.success({
    hasPromise: true,
    recoveryCase: {
      id: recoveryCase._id,
      customerId: recoveryCase.customerId,
      status: recoveryCase.status,
      promiseAt: recoveryCase.promiseAt,
      promiseAmount: recoveryCase.promiseAmount,
      promiseStatus: recoveryCase.promiseStatus,
      brokenPromisesCount: recoveryCase.brokenPromisesCount,
      notes: recoveryCase.notes,
    },
  });
});

// ===== HELPER FUNCTIONS =====

/**
 * Compute promise status based on due date
 */
/**
 * Compute promise status based on IST timezone
 * CRITICAL: Uses Asia/Kolkata timezone for day boundaries
 */
function computePromiseStatus(promiseAt, nowIST = null) {
  if (!promiseAt) return 'NONE';
  
  // Use IST-aware bucketing
  const bucket = bucketDateIST(promiseAt);
  
  if (bucket === 'OVERDUE') {
    return 'OVERDUE';
  } else if (bucket === 'TODAY') {
    return 'DUE_TODAY';
  } else {
    return 'UPCOMING';
  }
}

module.exports = {
  createCustomerPromise,
  updatePromise,
  getCustomerPromise,
};
