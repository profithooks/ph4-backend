/**
 * IST Timezone Utilities
 * 
 * Provides consistent IST (Indian Standard Time, UTC+5:30) date handling
 * for daily write counters and entitlement logic.
 */

/**
 * Get current date string in IST timezone (YYYY-MM-DD)
 * 
 * @returns {string} Date string in format YYYY-MM-DD
 */
const getISTDateString = () => {
  // Get current UTC time
  const now = new Date();
  
  // Convert to IST (UTC + 5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  
  // Extract date components
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

/**
 * Get IST midnight for next day (for reset calculation)
 * 
 * @returns {Date} Date object representing next midnight in IST
 */
const getNextISTMidnight = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  
  // Get current IST time
  const istTime = new Date(now.getTime() + istOffset);
  
  // Set to next day midnight (IST)
  const tomorrow = new Date(istTime);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  
  // Convert back to UTC for storage
  return new Date(tomorrow.getTime() - istOffset);
};

/**
 * Get current IST timestamp
 * 
 * @returns {Date} Current time adjusted for IST
 */
const getISTTime = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffset);
};

module.exports = {
  getISTDateString,
  getNextISTMidnight,
  getISTTime,
};
