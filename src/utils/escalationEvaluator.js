/**
 * Promise Escalation Evaluator (PURE FUNCTION)
 * Deterministic evaluation of escalation rules
 */

/**
 * Evaluate if a promise should be escalated
 * @param {Object} recoveryCase
 * @param {Date} now
 * @returns {{shouldEscalate: boolean, newLevel: number, reason: string}}
 */
function evaluatePromiseEscalation(recoveryCase, now) {
  // No escalation if no promise
  if (!recoveryCase.promiseAt) {
    return { shouldEscalate: false, newLevel: 0, reason: 'NO_PROMISE' };
  }

  // No escalation if case is closed/resolved
  if (recoveryCase.status === 'paid' || recoveryCase.status === 'resolved' || recoveryCase.status === 'dropped') {
    return { shouldEscalate: false, newLevel: 0, reason: 'CASE_CLOSED' };
  }

  // Calculate days overdue
  const promiseDate = new Date(recoveryCase.promiseAt);
  const diffMs = now - promiseDate;
  const daysOverdue = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  // Not overdue yet
  if (daysOverdue < 1) {
    return { shouldEscalate: false, newLevel: 0, reason: 'NOT_OVERDUE' };
  }

  const currentLevel = recoveryCase.escalationLevel || 0;

  // Level 1: 1+ days overdue
  if (daysOverdue >= 1 && daysOverdue < 3 && currentLevel < 1) {
    return {
      shouldEscalate: true,
      newLevel: 1,
      reason: `OVERDUE_${daysOverdue}D_TO_LEVEL_1`,
    };
  }

  // Level 2: 3+ days overdue
  if (daysOverdue >= 3 && daysOverdue < 7 && currentLevel < 2) {
    return {
      shouldEscalate: true,
      newLevel: 2,
      reason: `OVERDUE_${daysOverdue}D_TO_LEVEL_2`,
    };
  }

  // Level 3: 7+ days overdue (critical)
  if (daysOverdue >= 7 && currentLevel < 3) {
    return {
      shouldEscalate: true,
      newLevel: 3,
      reason: `OVERDUE_${daysOverdue}D_TO_LEVEL_3_CRITICAL`,
    };
  }

  return {
    shouldEscalate: false,
    newLevel: currentLevel,
    reason: `ALREADY_AT_LEVEL_${currentLevel}`,
  };
}

module.exports = {
  evaluatePromiseEscalation,
};
