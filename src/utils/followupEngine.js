/**
 * Follow-Up Automation Engine
 * Handles auto-rescheduling and escalation for missed follow-ups
 */

/**
 * Get start of day in local time (milliseconds)
 */
function startOfDayMs(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get end of day in local time (milliseconds)
 */
function endOfDayMs(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Compute follow-up status based on dueAt and current time
 * @param {Date|string} dueAt - Due date
 * @param {Date} now - Current time
 * @param {string} status - Task status (pending/done/skipped)
 * @param {number} escalationLevel - Escalation level
 * @returns {string} - OPEN | DUE_TODAY | OVERDUE | COMPLETED | ESCALATED
 */
function getFollowUpStatus(dueAt, now = new Date(), status = 'pending', escalationLevel = 0) {
  if (status === 'done') {
    return 'COMPLETED';
  }

  if (!dueAt) return 'OPEN';

  const dueMs = new Date(dueAt).getTime();
  if (isNaN(dueMs)) return 'OPEN';

  const nowMs = now.getTime();
  const todayStartMs = startOfDayMs(now);
  const todayEndMs = endOfDayMs(now);

  // Escalated takes precedence
  if (escalationLevel >= 3) {
    return 'ESCALATED';
  }

  if (dueMs < todayStartMs) {
    return 'OVERDUE';
  } else if (dueMs >= todayStartMs && dueMs <= todayEndMs) {
    return 'DUE_TODAY';
  } else {
    return 'OPEN';
  }
}

/**
 * Calculate days overdue
 */
function getDaysOverdue(dueAt, now = new Date()) {
  if (!dueAt) return 0;

  const dueMs = new Date(dueAt).getTime();
  if (isNaN(dueMs)) return 0;

  const todayStartMs = startOfDayMs(now);
  if (dueMs >= todayStartMs) return 0;

  const diffMs = todayStartMs - dueMs;
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return days;
}

/**
 * Compute auto-reschedule action for overdue follow-up
 * @param {Object} followup - Follow-up task object
 * @param {Date} now - Current time
 * @returns {Object} - { shouldReschedule, newDueAt, escalationLevel, followupStatus }
 */
function autoRescheduleOverdueFollowup(followup, now = new Date()) {
  const status = getFollowUpStatus(followup.dueAt, now, followup.status, followup.escalationLevel);

  // Only reschedule if OVERDUE and status is still pending
  if (status !== 'OVERDUE' || followup.status !== 'pending') {
    return { shouldReschedule: false };
  }

  const currentLevel = followup.escalationLevel || 0;
  const nextLevel = currentLevel + 1;
  const daysOverdue = getDaysOverdue(followup.dueAt, now);

  let newDueAt = new Date(now);
  let newStatus = 'OVERDUE';

  if (nextLevel === 1) {
    // First miss: Today 6PM
    const currentHour = now.getHours();
    if (currentHour < 18) {
      newDueAt.setHours(18, 0, 0, 0);
    } else {
      // After 6PM: Tomorrow 6PM
      newDueAt.setDate(newDueAt.getDate() + 1);
      newDueAt.setHours(18, 0, 0, 0);
    }
  } else if (nextLevel === 2) {
    // Second miss: Tomorrow 10AM
    newDueAt.setDate(newDueAt.getDate() + 1);
    newDueAt.setHours(10, 0, 0, 0);
  } else {
    // Third+ miss: +3 days, mark ESCALATED
    newDueAt.setDate(newDueAt.getDate() + 3);
    newDueAt.setHours(10, 0, 0, 0);
    newStatus = 'ESCALATED';
  }

  return {
    shouldReschedule: true,
    newDueAt: newDueAt.toISOString(),
    escalationLevel: nextLevel,
    followupStatus: newStatus,
    daysOverdue,
    oldFollowupId: followup.id || followup._id,
  };
}

// CommonJS export for backend
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getFollowUpStatus,
    getDaysOverdue,
    autoRescheduleOverdueFollowup,
    startOfDayMs,
    endOfDayMs,
  };
}

// ES6 export for frontend
if (typeof exports !== 'undefined') {
  exports.getFollowUpStatus = getFollowUpStatus;
  exports.getDaysOverdue = getDaysOverdue;
  exports.autoRescheduleOverdueFollowup = autoRescheduleOverdueFollowup;
  exports.startOfDayMs = startOfDayMs;
  exports.endOfDayMs = endOfDayMs;
}
