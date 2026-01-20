/**
 * Security Service
 * 
 * Handles abuse protection, rate limiting, and suspicious activity detection
 * Step 20: Security & Abuse Hardening
 */
const UserSecurityState = require('../models/UserSecurityState');
const AuditEvent = require('../models/AuditEvent');
const Notification = require('../models/Notification');
const NotificationAttempt = require('../models/NotificationAttempt');
const ReliabilityEvent = require('../models/ReliabilityEvent');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// Rate limit thresholds
const RATE_LIMITS = {
  OTP_SEND_HOUR: 5,
  OTP_SEND_DAY: 10,
  OTP_VERIFY_HOUR: 10,
  OTP_FAIL_LOCKOUT: 5,
  OTP_LOCKOUT_MINUTES: 15,
  
  RECOVERY_PIN_HOUR: 5,
  RECOVERY_PIN_FAIL_LOCKOUT: 3,
  RECOVERY_PIN_LOCKOUT_MINUTES: 30,
  
  SUPPORT_TICKETS_DAY: 5,
  SUPPORT_MESSAGES_DAY: 20,
};

/**
 * Get or create security state for phone
 */
async function getSecurityState(phone) {
  let state = await UserSecurityState.findOne({ phone });
  
  if (!state) {
    state = await UserSecurityState.create({ phone });
  }
  
  return state;
}

/**
 * Check if OTP can be sent
 * Throws AppError if rate limited or locked
 */
async function checkOtpSendLimit(phone, requestId) {
  const state = await getSecurityState(phone);
  const now = new Date();
  
  // Check if locked
  if (state.otpLockedUntil && state.otpLockedUntil > now) {
    const retryAfter = Math.ceil((state.otpLockedUntil - now) / 1000);
    
    logger.warn('[Security] OTP send blocked (locked)', { phone, lockedUntil: state.otpLockedUntil });
    
    throw new AppError(
      `Account locked. Try again in ${Math.ceil(retryAfter / 60)} minutes`,
      429,
      'ACCOUNT_LOCKED',
      {
        lockedUntil: state.otpLockedUntil.toISOString(),
        retryAfter,
      }
    );
  }
  
  // Reset daily counter if needed
  if (!state.otpSentCountDayResetAt || state.otpSentCountDayResetAt < new Date(now.getTime() - 24 * 60 * 60 * 1000)) {
    state.otpSentCountDay = 0;
    state.otpSentCountDayResetAt = now;
  }
  
  // Check daily limit
  if (state.otpSentCountDay >= RATE_LIMITS.OTP_SEND_DAY) {
    logger.warn('[Security] OTP send blocked (daily limit)', { phone, count: state.otpSentCountDay });
    
    throw new AppError(
      `Daily OTP limit reached. Try again tomorrow`,
      429,
      'RATE_LIMIT',
      {
        limit: RATE_LIMITS.OTP_SEND_DAY,
        retryAfter: 86400, // 24 hours
      }
    );
  }
  
  // Check hourly limit
  if (state.lastOtpSentAt && state.lastOtpSentAt > new Date(now.getTime() - 60 * 60 * 1000)) {
    // Within last hour - would need to count, but for simplicity we'll use a 1-minute cooldown
    const timeSinceLastOtp = now - state.lastOtpSentAt;
    if (timeSinceLastOtp < 30 * 1000) { // 30 second cooldown
      const retryAfter = Math.ceil((30 * 1000 - timeSinceLastOtp) / 1000);
      
      throw new AppError(
        `Please wait ${retryAfter} seconds before requesting another OTP`,
        429,
        'RATE_LIMIT',
        { retryAfter }
      );
    }
  }
  
  // Update state
  state.lastOtpSentAt = now;
  state.otpSentCountDay += 1;
  await state.save();
  
  return state;
}

/**
 * Record OTP verification failure
 * Locks account after too many failures
 */
async function recordOtpFailure(phone, requestId) {
  const state = await getSecurityState(phone);
  const now = new Date();
  
  state.otpFailCount += 1;
  
  // Lock account if too many failures
  if (state.otpFailCount >= RATE_LIMITS.OTP_FAIL_LOCKOUT) {
    state.otpLockedUntil = new Date(now.getTime() + RATE_LIMITS.OTP_LOCKOUT_MINUTES * 60 * 1000);
    state.otpFailCount = 0; // Reset counter
    
    logger.warn('[Security] Account locked due to OTP failures', { 
      phone, 
      lockedUntil: state.otpLockedUntil 
    });
    
    // Create suspicious activity event
    await createSuspiciousActivityEvent(phone, 'REPEATED_OTP_FAILURES', requestId);
  }
  
  await state.save();
  return state;
}

/**
 * Record successful OTP verification
 */
async function recordOtpSuccess(phone) {
  const state = await getSecurityState(phone);
  
  state.otpFailCount = 0;
  state.lastSuccessfulLogin = new Date();
  await state.save();
  
  return state;
}

/**
 * Check if recovery PIN can be attempted
 */
async function checkRecoveryPinLimit(phone, requestId) {
  const state = await getSecurityState(phone);
  const now = new Date();
  
  // Check if locked
  if (state.pinLockedUntil && state.pinLockedUntil > now) {
    const retryAfter = Math.ceil((state.pinLockedUntil - now) / 1000);
    
    throw new AppError(
      `Recovery locked. Try again in ${Math.ceil(retryAfter / 60)} minutes`,
      429,
      'ACCOUNT_LOCKED',
      {
        lockedUntil: state.pinLockedUntil.toISOString(),
        retryAfter,
      }
    );
  }
  
  return state;
}

/**
 * Record recovery PIN failure
 */
async function recordRecoveryPinFailure(phone, requestId) {
  const state = await getSecurityState(phone);
  const now = new Date();
  
  state.pinFailCount += 1;
  
  // Lock account if too many failures
  if (state.pinFailCount >= RATE_LIMITS.RECOVERY_PIN_FAIL_LOCKOUT) {
    state.pinLockedUntil = new Date(now.getTime() + RATE_LIMITS.RECOVERY_PIN_LOCKOUT_MINUTES * 60 * 1000);
    state.pinFailCount = 0;
    
    logger.warn('[Security] Recovery locked due to PIN failures', { 
      phone, 
      lockedUntil: state.pinLockedUntil 
    });
    
    // Create suspicious activity event
    await createSuspiciousActivityEvent(phone, 'REPEATED_RECOVERY_FAILURES', requestId);
  }
  
  await state.save();
  return state;
}

/**
 * Record successful recovery
 */
async function recordRecoveryPinSuccess(phone) {
  const state = await getSecurityState(phone);
  
  state.pinFailCount = 0;
  await state.save();
  
  return state;
}

/**
 * Check support ticket creation limit
 */
async function checkSupportTicketLimit(phone, requestId) {
  const state = await getSecurityState(phone);
  const now = new Date();
  
  // Reset daily counter if needed
  if (!state.ticketsResetAt || state.ticketsResetAt < new Date(now.getTime() - 24 * 60 * 60 * 1000)) {
    state.ticketsCreatedToday = 0;
    state.ticketsResetAt = now;
  }
  
  // Check limit
  if (state.ticketsCreatedToday >= RATE_LIMITS.SUPPORT_TICKETS_DAY) {
    throw new AppError(
      'Daily ticket limit reached. Try again tomorrow',
      429,
      'RATE_LIMIT',
      {
        limit: RATE_LIMITS.SUPPORT_TICKETS_DAY,
        retryAfter: 86400,
      }
    );
  }
  
  state.ticketsCreatedToday += 1;
  await state.save();
  
  return state;
}

/**
 * Check support message creation limit
 */
async function checkSupportMessageLimit(phone, requestId) {
  const state = await getSecurityState(phone);
  const now = new Date();
  
  // Reset daily counter if needed
  if (!state.messagesResetAt || state.messagesResetAt < new Date(now.getTime() - 24 * 60 * 60 * 1000)) {
    state.messagesCreatedToday = 0;
    state.messagesResetAt = now;
  }
  
  // Check limit
  if (state.messagesCreatedToday >= RATE_LIMITS.SUPPORT_MESSAGES_DAY) {
    throw new AppError(
      'Daily message limit reached. Try again tomorrow',
      429,
      'RATE_LIMIT',
      {
        limit: RATE_LIMITS.SUPPORT_MESSAGES_DAY,
        retryAfter: 86400,
      }
    );
  }
  
  state.messagesCreatedToday += 1;
  await state.save();
  
  return state;
}

/**
 * Create suspicious activity event
 */
async function createSuspiciousActivityEvent(phone, reason, requestId) {
  try {
    // Create audit event
    await AuditEvent.create({
      at: new Date(),
      action: 'SECURITY_SUSPICIOUS',
      entityType: 'USER_SECURITY',
      metadata: {
        phone,
        reason,
        requestId,
      },
    });
    
    // TODO: Create in-app notification to owner
    // Would need to find user by phone first
    
    logger.warn('[Security] Suspicious activity detected', { phone, reason });
  } catch (error) {
    logger.error('[Security] Failed to create suspicious activity event', error);
  }
}

/**
 * Update session tracking
 */
async function updateSessionTracking(phone, ip, userAgent) {
  const state = await getSecurityState(phone);
  
  state.lastIp = ip;
  state.lastUserAgent = userAgent;
  await state.save();
  
  return state;
}

module.exports = {
  getSecurityState,
  checkOtpSendLimit,
  recordOtpFailure,
  recordOtpSuccess,
  checkRecoveryPinLimit,
  recordRecoveryPinFailure,
  recordRecoveryPinSuccess,
  checkSupportTicketLimit,
  checkSupportMessageLimit,
  createSuspiciousActivityEvent,
  updateSessionTracking,
  RATE_LIMITS,
};
