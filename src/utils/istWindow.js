/**
 * IST Day Window Helpers
 * 
 * Single source of truth for IST day boundaries
 * Used by daily digest generators for consistent date handling
 */

const {getNowIST, getStartOfDayIST, getEndOfDayIST} = require('./timezone.util');

/**
 * Get IST day window for a given date
 * 
 * @param {Date} [date=new Date()] - Reference date
 * @returns {Object} { dayKey, startUtc, endUtc, nowIst }
 */
function getIstDayWindow(date = new Date()) {
  const now = getNowIST();
  const targetDate = date ? new Date(date) : now;
  
  const startUtc = getStartOfDayIST(targetDate);
  const endUtc = getEndOfDayIST(targetDate);
  
  // Format as YYYY-MM-DD in IST
  const istDate = new Date(startUtc.getTime() + (5.5 * 60 * 60 * 1000));
  const dayKey = istDate.toISOString().substring(0, 10);
  
  return {
    dayKey,
    startUtc,
    endUtc,
    nowIst: now,
  };
}

/**
 * Get IST tomorrow window for a given date
 * 
 * @param {Date} [date=new Date()] - Reference date
 * @returns {Object} { dayKeyTomorrow, startUtc, endUtc }
 */
function getIstTomorrowWindow(date = new Date()) {
  const targetDate = date ? new Date(date) : getNowIST();
  
  // Add 1 day to target date
  const tomorrow = new Date(targetDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const startUtc = getStartOfDayIST(tomorrow);
  const endUtc = getEndOfDayIST(tomorrow);
  
  // Format as YYYY-MM-DD in IST
  const istDate = new Date(startUtc.getTime() + (5.5 * 60 * 60 * 1000));
  const dayKeyTomorrow = istDate.toISOString().substring(0, 10);
  
  return {
    dayKeyTomorrow,
    startUtc,
    endUtc,
  };
}

/**
 * Get IST yesterday window for a given date
 * 
 * @param {Date} [date=new Date()] - Reference date
 * @returns {Object} { dayKeyYesterday, startUtc, endUtc }
 */
function getIstYesterdayWindow(date = new Date()) {
  const targetDate = date ? new Date(date) : getNowIST();
  
  // Subtract 1 day from target date
  const yesterday = new Date(targetDate);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const startUtc = getStartOfDayIST(yesterday);
  const endUtc = getEndOfDayIST(yesterday);
  
  // Format as YYYY-MM-DD in IST
  const istDate = new Date(startUtc.getTime() + (5.5 * 60 * 60 * 1000));
  const dayKeyYesterday = istDate.toISOString().substring(0, 10);
  
  return {
    dayKeyYesterday,
    startUtc,
    endUtc,
  };
}

module.exports = {
  getIstDayWindow,
  getIstTomorrowWindow,
  getIstYesterdayWindow,
};
