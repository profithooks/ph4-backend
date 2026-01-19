/**
 * Promise Auto-Keep Service
 * Automatically marks promises as KEPT when payment is received
 */

const RecoveryCase = require('../models/RecoveryCase');
const RecoveryEvent = require('../models/RecoveryEvent');
const Customer = require('../models/Customer');

/**
 * Maybe keep promise for customer after payment
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.customerId - Customer ID
 * @param {string} params.paymentRef - Payment reference (billId or txnId)
 * @param {string} params.idempotencyKey - Idempotency key
 * @param {number} params.newDue - New outstanding amount after payment
 * @returns {Promise<Object>} - Result { promiseKept, caseClosed }
 */
async function maybeKeepPromiseForCustomer({
  userId,
  customerId,
  paymentRef,
  idempotencyKey,
  newDue = null,
}) {
  // Find active recovery case with active promise
  const recoveryCase = await RecoveryCase.findOne({
    userId,
    customerId,
    promiseStatus: { $in: ['ACTIVE', 'DUE_TODAY'] },
  }).sort({ createdAt: -1 });

  if (!recoveryCase) {
    // No active promise to keep
    return { promiseKept: false, caseClosed: false };
  }

  // Check idempotency for promise kept
  const keptIdempotencyKey = `PROMISE_KEPT::${recoveryCase._id}::${paymentRef}`;
  const existingKeptEvent = await RecoveryEvent.findOne({
    userId,
    idempotencyKey: keptIdempotencyKey,
  });

  if (existingKeptEvent) {
    console.log('[PromiseAutoKeep] Promise already marked kept (idempotent):', keptIdempotencyKey);
    return {
      promiseKept: true,
      caseClosed: recoveryCase.status === 'resolved' || recoveryCase.status === 'paid',
      recoveryCase,
    };
  }

  // Mark promise as KEPT
  recoveryCase.promiseStatus = 'KEPT';
  recoveryCase.keptAt = new Date();
  recoveryCase.keptByRef = paymentRef;
  await recoveryCase.save();

  // Create event
  await RecoveryEvent.create({
    userId,
    caseId: recoveryCase._id,
    type: 'PROMISE_KEPT',
    idempotencyKey: keptIdempotencyKey,
    payload: { paymentRef, keptAt: new Date().toISOString() },
    resultCaseId: recoveryCase._id,
  });

  console.log('[PromiseAutoKeep] Promise marked KEPT:', recoveryCase._id);

  // Check if should auto-close case
  let caseClosed = false;
  const tolerance = 1; // Rounding safety

  if (newDue !== null && newDue <= tolerance) {
    // Auto-close case
    const closedIdempotencyKey = `CASE_AUTO_CLOSED::${recoveryCase._id}::${paymentRef}`;
    const existingClosedEvent = await RecoveryEvent.findOne({
      userId,
      idempotencyKey: closedIdempotencyKey,
    });

    if (!existingClosedEvent) {
      recoveryCase.status = 'resolved';
      recoveryCase.resolvedAt = new Date();
      await recoveryCase.save();

      await RecoveryEvent.create({
        userId,
        caseId: recoveryCase._id,
        type: 'CASE_AUTO_CLOSED',
        idempotencyKey: closedIdempotencyKey,
        payload: { paymentRef, resolvedAt: new Date().toISOString(), newDue },
        resultCaseId: recoveryCase._id,
      });

      caseClosed = true;
      console.log('[PromiseAutoKeep] Case auto-closed:', recoveryCase._id);
    }
  }

  return {
    promiseKept: true,
    caseClosed,
    recoveryCase,
  };
}

module.exports = {
  maybeKeepPromiseForCustomer,
};
