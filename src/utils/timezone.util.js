/**
 * Timezone Utility - Asia/Kolkata (IST) Canonical Functions
 * 
 * CRITICAL: All date/day calculations MUST use these functions.
 * IST is UTC+5:30 - Business timezone for all day boundaries.
 * 
 * DO NOT use:
 * - new Date() for "now" - use getNowIST()
 * - setHours(0,0,0,0) for day start - use getStartOfDayIST()
 * - Manual date math - use diff functions
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30 in milliseconds

/**
 * Get current time in IST
 * @returns {Date} - Current time adjusted to IST
 */
function getNowIST() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + IST_OFFSET_MS);
}

/**
 * Get start of day (00:00:00.000) in IST
 * @param {Date|string|number} [date] - Date to get start of day for (defaults to now)
 * @returns {Date} - Start of day in IST
 */
function getStartOfDayIST(date) {
  const targetDate = date ? new Date(date) : getNowIST();
  
  // Convert to IST if not already
  const utc = targetDate.getTime() + (targetDate.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + IST_OFFSET_MS);
  
  // Set to start of day
  istDate.setHours(0, 0, 0, 0);
  
  // Convert back to UTC representation
  const istStartMs = istDate.getTime() - IST_OFFSET_MS;
  return new Date(istStartMs);
}

/**
 * Get end of day (23:59:59.999) in IST
 * @param {Date|string|number} [date] - Date to get end of day for (defaults to now)
 * @returns {Date} - End of day in IST
 */
function getEndOfDayIST(date) {
  const targetDate = date ? new Date(date) : getNowIST();
  
  // Convert to IST if not already
  const utc = targetDate.getTime() + (targetDate.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + IST_OFFSET_MS);
  
  // Set to end of day
  istDate.setHours(23, 59, 59, 999);
  
  // Convert back to UTC representation
  const istEndMs = istDate.getTime() - IST_OFFSET_MS;
  return new Date(istEndMs);
}

/**
 * Calculate difference in days from now (IST) to a given date
 * Positive = future, Negative = past (overdue)
 * 
 * @param {Date|string} date - Target date
 * @returns {number} - Days difference (negative if overdue)
 */
function diffDaysFromNowIST(date) {
  if (!date) return 0;
  
  const targetDate = new Date(date);
  const nowIST = getNowIST();
  
  // Get start of days in IST
  const startOfTargetDayIST = getStartOfDayIST(targetDate);
  const startOfTodayIST = getStartOfDayIST(nowIST);
  
  // Calculate difference in milliseconds
  const diffMs = startOfTargetDayIST.getTime() - startOfTodayIST.getTime();
  
  // Convert to days (rounded)
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  
  return diffDays;
}

/**
 * Calculate absolute days overdue from now (IST)
 * Returns 0 if not overdue
 * 
 * @param {Date|string} dueDate - Due date
 * @returns {number} - Days overdue (always >= 0)
 */
function getDaysOverdueIST(dueDate) {
  if (!dueDate) return 0;
  
  const diff = diffDaysFromNowIST(dueDate);
  
  // If diff is negative, the date is in the past (overdue)
  // Return absolute value, otherwise 0
  return diff < 0 ? Math.abs(diff) : 0;
}

/**
 * Bucket a date into OVERDUE/TODAY/UPCOMING relative to IST now
 * 
 * @param {Date|string} date - Date to bucket
 * @returns {'OVERDUE'|'TODAY'|'UPCOMING'} - Bucket category
 */
function bucketDateIST(date) {
  if (!date) return 'UPCOMING';
  
  const targetDate = new Date(date);
  const nowIST = getNowIST();
  
  const startOfTodayIST = getStartOfDayIST(nowIST);
  const endOfTodayIST = getEndOfDayIST(nowIST);
  
  const targetTime = targetDate.getTime();
  
  if (targetTime < startOfTodayIST.getTime()) {
    return 'OVERDUE';
  } else if (targetTime >= startOfTodayIST.getTime() && targetTime <= endOfTodayIST.getTime()) {
    return 'TODAY';
  } else {
    return 'UPCOMING';
  }
}

/**
 * Format date to IST string for logging/debugging
 * @param {Date|string} date - Date to format
 * @returns {string} - Formatted IST date string
 */
function formatIST(date) {
  if (!date) return 'N/A';
  
  const targetDate = new Date(date);
  const utc = targetDate.getTime() + (targetDate.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + IST_OFFSET_MS);
  
  return istDate.toISOString().replace('T', ' ').replace('Z', ' IST');
}

module.exports = {
  getNowIST,
  getStartOfDayIST,
  getEndOfDayIST,
  diffDaysFromNowIST,
  getDaysOverdueIST,
  bucketDateIST,
  formatIST,
  // Export constant for advanced usage
  IST_OFFSET_MS,
};
