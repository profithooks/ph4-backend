/**
 * Channel Selector
 * 
 * Determines which channels to use for notifications based on:
 * - Settings (notifications enabled)
 * - Firebase configuration
 * - User device tokens
 */
const Device = require('../../models/Device');
const {isFirebaseConfigured} = require('../../config/firebase');
const logger = require('../../utils/logger');

// Cache for user device token checks (per cron run)
let _userTokenCache = {};
let _cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if user has trusted devices with FCM tokens
 * Uses caching to avoid repeated queries in tight loops
 * 
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
async function userHasFcmTokens(userId) {
  const now = Date.now();
  
  // Clear cache if expired
  if (!_cacheTimestamp || (now - _cacheTimestamp) > CACHE_TTL_MS) {
    _userTokenCache = {};
    _cacheTimestamp = now;
  }

  // Check cache first
  if (userId in _userTokenCache) {
    return _userTokenCache[userId];
  }

  try {
    // Check if Firebase is configured
    if (!isFirebaseConfigured()) {
      _userTokenCache[userId] = false;
      return false;
    }

    // Check if user has trusted devices with FCM tokens
    const deviceCount = await Device.countDocuments({
      userId,
      status: 'TRUSTED',
      fcmToken: {$ne: null, $exists: true},
    });

    const hasTokens = deviceCount > 0;
    _userTokenCache[userId] = hasTokens;
    
    return hasTokens;
  } catch (error) {
    logger.error('[ChannelSelector] Failed to check FCM tokens', {
      error: error.message,
      userId,
    });
    // Conservative: assume no tokens on error
    _userTokenCache[userId] = false;
    return false;
  }
}

/**
 * Select channels for notification
 * Always includes IN_APP, includes PUSH only if conditions met
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Array<string>>} Channels array
 */
async function selectChannels(userId) {
  const channels = ['IN_APP'];
  
  // Add PUSH if Firebase configured and user has tokens
  const hasTokens = await userHasFcmTokens(userId);
  if (hasTokens) {
    channels.push('PUSH');
  }
  
  return channels;
}

/**
 * Clear channel cache (useful for testing or manual refresh)
 */
function clearCache() {
  _userTokenCache = {};
  _cacheTimestamp = null;
}

module.exports = {
  userHasFcmTokens,
  selectChannels,
  clearCache,
};
