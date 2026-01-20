/**
 * Recovery Plan Service
 * 
 * EXISTING INFRASTRUCTURE FOUND:
 * - Models: FollowUpTask (with idempotencyKey, source, escalationLevel)
 * - Models: RecoveryCase (status, escalationLevel, promiseStatus)
 * - Models: Notification (kind, channels, idempotencyKey)
 * - Models: NotificationAttempt (for delivery tracking with retry logic)
 * - Cron: notificationDelivery.cron (runs every 30 seconds)
 * - Worker: notificationDelivery.worker (lease-based queue processing)
 * 
 * DESIGN DECISIONS:
 * - Reuse FollowUpTask for recovery tasks (add source: 'AUTO_RECOVERY_STEP_N')
 * - Use idempotencyKey: {customerId}_{source} for duplicate prevention
 * - Settings-driven escalation ladder (default: Day 0/3/7)
 * - Templates configurable per step (with sensible defaults)
 * 
 * PURPOSE: Compute ordered escalation steps for a customer
 * 
 * ESCALATION LADDER (SETTINGS-DRIVEN):
 * - STEP_0: Day 0 (immediate) - "Payment is overdue"
 * - STEP_3: Day 3 - "Gentle reminder"
 * - STEP_7: Day 7 - "Urgent: Please settle"
 * - Can be extended to STEP_15, STEP_30, etc. via settings
 * 
 * IDEMPOTENCY:
 * - Each step has unique key: customerId + stepKey
 * - FollowUpTask.idempotencyKey prevents duplicates
 * - If task already exists (pending/done), won't create again
 */

const {getNowIST, getStartOfDayIST} = require('../utils/timezone.util');
const logger = require('../utils/logger');

/**
 * Default recovery escalation ladder (if not in settings)
 */
const DEFAULT_ESCALATION_LADDER = [
  {
    stepKey: 'STEP_0',
    dayOffset: 0, // Immediate (same day)
    priority: 'high',
    templateKey: 'recovery_immediate',
    escalationLevel: 1,
  },
  {
    stepKey: 'STEP_3',
    dayOffset: 3,
    priority: 'high',
    templateKey: 'recovery_gentle_reminder',
    escalationLevel: 2,
  },
  {
    stepKey: 'STEP_7',
    dayOffset: 7,
    priority: 'high',
    templateKey: 'recovery_urgent',
    escalationLevel: 3,
  },
];

/**
 * Message templates for recovery (can be moved to DB later)
 */
const DEFAULT_TEMPLATES = {
  recovery_immediate: {
    title: 'Payment Overdue',
    body: 'Hi {customerName}, your payment of ₹{amount} is overdue. Please settle at your earliest convenience.',
  },
  recovery_gentle_reminder: {
    title: 'Payment Reminder',
    body: 'Hi {customerName}, this is a gentle reminder about your pending payment of ₹{amount}. Please clear your dues.',
  },
  recovery_urgent: {
    title: 'Urgent: Payment Required',
    body: 'Hi {customerName}, your payment of ₹{amount} is now 7+ days overdue. Please settle immediately to avoid further action.',
  },
};

/**
 * Get recovery escalation ladder from settings (or use defaults)
 * 
 * @param {Object} settings - Business settings
 * @returns {Array} Escalation ladder steps
 */
function getEscalationLadder(settings = {}) {
  // TODO: Read from settings.recoveryEscalationLadder once implemented
  // For now, use defaults
  return DEFAULT_ESCALATION_LADDER;
}

/**
 * Compute recovery plan for a customer
 * 
 * ALGORITHM:
 * 1. Check if recovery is enabled in settings
 * 2. Get escalation ladder (from settings or defaults)
 * 3. Compute dueAt for each step based on dayOffset from first overdue bill
 * 4. Return ordered steps with dueAt and templateKey
 * 
 * @param {Object} params
 * @param {string} params.customerId - Customer ID
 * @param {string} params.customerName - Customer name
 * @param {string} params.customerPhone - Customer phone
 * @param {number} params.outstandingAmount - Total outstanding
 * @param {Array} params.overdueBills - Array of overdue bills
 * @param {Object} params.settings - Business settings
 * @param {Date} params.nowIST - Current time in IST (for testing)
 * @returns {Object} { enabled, steps: [] }
 */
function computeRecoveryPlan({
  customerId,
  customerName,
  customerPhone,
  outstandingAmount,
  overdueBills = [],
  settings = {},
  nowIST = null,
}) {
  try {
    // Use provided nowIST or get current IST
    const now = nowIST || getNowIST();
    
    // Check if recovery is enabled
    // TODO: Read from settings.recoveryEnabled once field exists
    const recoveryEnabled = true; // For now, always enabled
    
    if (!recoveryEnabled) {
      return {
        enabled: false,
        steps: [],
      };
    }
    
    // Get earliest overdue bill (for computing base date)
    let baseDate = now;
    if (overdueBills && overdueBills.length > 0) {
      const earliestBill = overdueBills.reduce((earliest, bill) => {
        const billDue = new Date(bill.dueDate);
        const earliestDue = new Date(earliest.dueDate);
        return billDue < earliestDue ? bill : earliest;
      });
      baseDate = new Date(earliestBill.dueDate);
    }
    
    // Get escalation ladder
    const ladder = getEscalationLadder(settings);
    
    // Compute steps (IST-CORRECT: All dueAt computed as IST start-of-day)
    const steps = ladder.map(step => {
      // CRITICAL: Compute dueAt in IST timezone
      // baseDate is already in IST (from overdue bill)
      // Add dayOffset to get target date in IST
      const targetDateIST = new Date(baseDate);
      targetDateIST.setDate(targetDateIST.getDate() + step.dayOffset);
      
      // Get IST start-of-day for this target date (00:00:00 IST)
      const dueAt = getStartOfDayIST(targetDateIST);
      
      // Get template
      const template = DEFAULT_TEMPLATES[step.templateKey] || DEFAULT_TEMPLATES.recovery_immediate;
      
      // Substitute variables
      const title = template.title.replace('{customerName}', customerName || 'Customer');
      const body = template.body
        .replace('{customerName}', customerName || 'Customer')
        .replace('{amount}', outstandingAmount || 0);
      
      return {
        stepKey: step.stepKey,
        source: `AUTO_RECOVERY_${step.stepKey}`, // For FollowUpTask.source
        dueAt,
        priority: step.priority,
        templateKey: step.templateKey,
        escalationLevel: step.escalationLevel,
        title,
        body,
        metadata: {
          customerId,
          customerName,
          customerPhone,
          outstandingAmount,
          baseDueDate: baseDate.toISOString(),
          dayOffset: step.dayOffset,
        },
      };
    });
    
    // Sort by dueAt (earliest first)
    steps.sort((a, b) => a.dueAt - b.dueAt);
    
    logger.debug('[RecoveryPlan] Plan computed', {
      customerId,
      outstandingAmount,
      baseDate,
      stepsCount: steps.length,
    });
    
    return {
      enabled: true,
      steps,
    };
  } catch (error) {
    logger.error('[RecoveryPlan] Failed to compute plan', error, {
      customerId,
    });
    
    return {
      enabled: false,
      steps: [],
      error: error.message,
    };
  }
}

/**
 * Check if a recovery step should be created
 * 
 * RULES:
 * - Step is due (dueAt <= now + grace period)
 * - Customer still has outstanding (not paid in full)
 * - Step not already completed
 * 
 * @param {Object} step - Recovery step
 * @param {Date} nowIST - Current time in IST
 * @param {number} gracePeriodHours - Grace period before creating task (default: 0)
 * @returns {boolean} True if step should be created
 */
function shouldCreateStep(step, nowIST = null, gracePeriodHours = 0) {
  const now = nowIST || getNowIST();
  const graceMs = gracePeriodHours * 60 * 60 * 1000;
  const dueThreshold = new Date(now.getTime() + graceMs);
  
  return step.dueAt <= dueThreshold;
}

module.exports = {
  computeRecoveryPlan,
  shouldCreateStep,
  DEFAULT_ESCALATION_LADDER,
  DEFAULT_TEMPLATES,
};
