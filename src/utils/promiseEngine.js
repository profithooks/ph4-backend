/**
 * Promise State Engine
 * Shared utility for computing promise state (backend + frontend compatible)
 */

/**
 * Get start of day in local time (milliseconds)
 * @param {Date} now - Current time
 * @returns {number} - Milliseconds
 */
function startOfDayMs(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get end of day in local time (milliseconds)
 * @param {Date} now - Current time
 * @returns {number} - Milliseconds
 */
function endOfDayMs(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Compute promise state based on promiseAt and current time
 * @param {Date|string|null} promiseAt - Promise date
 * @param {Date} now - Current time
 * @returns {string} - NONE | DUE_TODAY | UPCOMING | OVERDUE
 */
function getPromiseState(promiseAt, now = new Date()) {
  if (!promiseAt) return 'NONE';

  const promiseMs = new Date(promiseAt).getTime();
  if (isNaN(promiseMs)) return 'NONE';

  const nowMs = now.getTime();
  const todayStartMs = startOfDayMs(now);
  const todayEndMs = endOfDayMs(now);

  if (promiseMs < todayStartMs) {
    return 'OVERDUE';
  } else if (promiseMs >= todayStartMs && promiseMs <= todayEndMs) {
    return 'DUE_TODAY';
  } else {
    return 'UPCOMING';
  }
}

/**
 * Calculate days overdue
 * @param {Date|string} promiseAt - Promise date
 * @param {Date} now - Current time
 * @returns {number} - Days overdue (0 if not overdue)
 */
function getDaysOverdue(promiseAt, now = new Date()) {
  if (!promiseAt) return 0;

  const promiseMs = new Date(promiseAt).getTime();
  if (isNaN(promiseMs)) return 0;

  const todayStartMs = startOfDayMs(now);
  if (promiseMs >= todayStartMs) return 0;

  const diffMs = todayStartMs - promiseMs;
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return days;
}

/**
 * Auto-escalate overdue promise
 * Returns next actions to take
 * @param {Object} recoveryCase - Recovery case object
 * @param {Date} now - Current time
 * @returns {Object} - { shouldEscalate, followupDueAt, newPriority, newStatus }
 */
function autoEscalateOverduePromise(recoveryCase, now = new Date()) {
  const state = getPromiseState(recoveryCase.promiseAt, now);
  
  if (state !== 'OVERDUE') {
    return { shouldEscalate: false };
  }

  // Already marked broken, don't re-escalate
  if (recoveryCase.promiseStatus === 'BROKEN') {
    return { shouldEscalate: false };
  }

  const daysOverdue = getDaysOverdue(recoveryCase.promiseAt, now);

  // Determine followup due time
  let followupDueAt = new Date(now);
  const currentHour = now.getHours();

  if (currentHour < 18) {
    // Before 6 PM: schedule today 6 PM
    followupDueAt.setHours(18, 0, 0, 0);
  } else {
    // After 6 PM: schedule tomorrow 10 AM
    followupDueAt.setDate(followupDueAt.getDate() + 1);
    followupDueAt.setHours(10, 0, 0, 0);
  }

  // Increase priority (capped at 5)
  const currentPriority = recoveryCase.priority || 0;
  const newPriority = Math.min(currentPriority + 1, 5);

  return {
    shouldEscalate: true,
    followupDueAt: followupDueAt.toISOString(),
    newPriority,
    newStatus: 'BROKEN',
    daysOverdue,
  };
}

// CommonJS export for backend
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getPromiseState,
    getDaysOverdue,
    autoEscalateOverduePromise,
    startOfDayMs,
    endOfDayMs,
  };
}

// ES6 export for frontend
if (typeof exports !== 'undefined') {
  exports.getPromiseState = getPromiseState;
  exports.getDaysOverdue = getDaysOverdue;
  exports.autoEscalateOverduePromise = autoEscalateOverduePromise;
  exports.startOfDayMs = startOfDayMs;
  exports.endOfDayMs = endOfDayMs;
}
