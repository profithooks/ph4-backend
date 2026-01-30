/**
 * Daily Stats Service
 * 
 * Computes and stores daily statistics for business and global metrics
 */
const DailyStats = require('../models/DailyStats');
const logger = require('../utils/logger');

/**
 * Get IST date boundaries for a given date
 * @param {Date} date - Date to get boundaries for
 * @returns {Object} - { startIST, endIST, dateKey }
 */
const getISTDateBoundaries = (date) => {
  // IST is UTC+5:30
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  
  // Convert to IST
  const istDate = new Date(date.getTime() + IST_OFFSET);
  
  // Get IST date components
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;
  
  // Create IST midnight (00:00:00 IST)
  const startIST = new Date(Date.UTC(year, istDate.getUTCMonth(), istDate.getUTCDate(), 0, 0, 0, 0) - IST_OFFSET);
  
  // Create IST end of day (23:59:59.999 IST)
  const endIST = new Date(Date.UTC(year, istDate.getUTCMonth(), istDate.getUTCDate(), 23, 59, 59, 999) - IST_OFFSET);
  
  return { startIST, endIST, dateKey };
};

/**
 * Compute business stats for a given date and businessId
 * @param {string} dateKey - Date key (YYYY-MM-DD)
 * @param {Date} startIST - Start of IST day
 * @param {Date} endIST - End of IST day
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} - Computed metrics
 */
const computeBusinessStats = async (dateKey, startIST, endIST, businessId) => {
  const mongoose = require('mongoose');
  const metrics = {
    billsCount: 0,
    billedAmount: 0,
    collectedAmount: 0,
    pendingAmount: 0,
    followupsCount: 0,
  };
  
  try {
    // Bills stats (created yesterday)
    const Bill = require('../models/Bill');
    const billsAgg = await Bill.aggregate([
      {
        $match: {
          userId: mongoose.Types.ObjectId(businessId),
          createdAt: { $gte: startIST, $lt: endIST },
          isDeleted: { $ne: true },
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          billedAmount: { $sum: { $ifNull: ['$grandTotal', 0] } },
          pendingAdded: { $sum: { $subtract: [
            { $ifNull: ['$grandTotal', 0] },
            { $ifNull: ['$paidAmount', 0] }
          ] } },
        }
      }
    ]);
    
    if (billsAgg.length > 0) {
      metrics.billsCount = billsAgg[0].count || 0;
      metrics.billedAmount = billsAgg[0].billedAmount || 0;
      metrics.pendingAmount = billsAgg[0].pendingAdded || 0;
    }
  } catch (error) {
    logger.warn('[DailyStats] Bills collection error:', error.message);
  }
  
  try {
    // Collected amount (payments made yesterday)
    const Payment = require('../models/Payment');
    const paymentsAgg = await Payment.aggregate([
      {
        $match: {
          userId: mongoose.Types.ObjectId(businessId),
          createdAt: { $gte: startIST, $lt: endIST },
          isDeleted: { $ne: true },
        }
      },
      {
        $group: {
          _id: null,
          collected: { $sum: { $ifNull: ['$amount', 0] } },
        }
      }
    ]);
    
    if (paymentsAgg.length > 0) {
      metrics.collectedAmount = paymentsAgg[0].collected || 0;
    }
  } catch (error) {
    logger.debug('[DailyStats] Payment collection not available:', error.message);
  }
  
  try {
    // Followups stats
    const FollowupTask = require('../models/FollowupTask');
    const followupsCount = await FollowupTask.countDocuments({
      userId: mongoose.Types.ObjectId(businessId),
      createdAt: { $gte: startIST, $lt: endIST },
      isDeleted: { $ne: true },
    });
    metrics.followupsCount = followupsCount || 0;
  } catch (error) {
    logger.warn('[DailyStats] FollowupTask collection error:', error.message);
  }
  
  return metrics;
};

/**
 * Compute global stats for a given date (sum across all businesses)
 * @param {string} dateKey - Date key (YYYY-MM-DD)
 * @param {Date} startIST - Start of IST day
 * @param {Date} endIST - End of IST day
 * @returns {Promise<Object>} - { metrics, isProjected, businessCount }
 */
const computeGlobalStats = async (dateKey, startIST, endIST) => {
  const metrics = {
    billsCount: 0,
    billedAmount: 0,
    collectedAmount: 0,
    pendingAmount: 0,
    followupsCount: 0,
  };
  let businessCount = 0;
  
  try {
    // Global bills stats
    const Bill = require('../models/Bill');
    const billsAgg = await Bill.aggregate([
      {
        $match: {
          createdAt: { $gte: startIST, $lt: endIST },
          isDeleted: { $ne: true },
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          billedAmount: { $sum: { $ifNull: ['$grandTotal', 0] } },
          pendingAdded: { $sum: { $subtract: [
            { $ifNull: ['$grandTotal', 0] },
            { $ifNull: ['$paidAmount', 0] }
          ] } },
          businesses: { $addToSet: '$userId' },
        }
      }
    ]);
    
    if (billsAgg.length > 0) {
      metrics.billsCount = billsAgg[0].count || 0;
      metrics.billedAmount = billsAgg[0].billedAmount || 0;
      metrics.pendingAmount = billsAgg[0].pendingAdded || 0;
      businessCount = (billsAgg[0].businesses || []).length;
    }
  } catch (error) {
    logger.warn('[DailyStats] Global bills error:', error.message);
  }
  
  try {
    // Global collected amount
    const Payment = require('../models/Payment');
    const paymentsAgg = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startIST, $lt: endIST },
          isDeleted: { $ne: true },
        }
      },
      {
        $group: {
          _id: null,
          collected: { $sum: { $ifNull: ['$amount', 0] } },
        }
      }
    ]);
    
    if (paymentsAgg.length > 0) {
      metrics.collectedAmount = paymentsAgg[0].collected || 0;
    }
  } catch (error) {
    logger.debug('[DailyStats] Global payments not available:', error.message);
  }
  
  try {
    // Global followups stats
    const FollowupTask = require('../models/FollowupTask');
    const followupsCount = await FollowupTask.countDocuments({
      createdAt: { $gte: startIST, $lt: endIST },
      isDeleted: { $ne: true },
    });
    metrics.followupsCount = followupsCount || 0;
  } catch (error) {
    logger.warn('[DailyStats] Global followups error:', error.message);
  }
  
  // Apply projection if data is sparse (early stage)
  const isProjected = 
    metrics.billsCount < 1000 && 
    metrics.billedAmount < 1000000 && 
    businessCount < 100;
  
  if (isProjected) {
    // Deterministic multiplier based on dateKey hash
    const multiplier = getDeterministicMultiplier(dateKey);
    metrics.billsCount = Math.round(metrics.billsCount * multiplier);
    metrics.billedAmount = Math.round(metrics.billedAmount * multiplier);
    metrics.collectedAmount = Math.round(metrics.collectedAmount * multiplier);
    metrics.pendingAmount = Math.round(metrics.pendingAmount * multiplier);
    metrics.followupsCount = Math.round(metrics.followupsCount * multiplier);
  }
  
  return { metrics, isProjected };
};

/**
 * Get deterministic multiplier for a given dateKey (1.2 to 1.6)
 * @param {string} dateKey - Date key (YYYY-MM-DD)
 * @returns {number} - Multiplier between 1.2 and 1.6
 */
const getDeterministicMultiplier = (dateKey) => {
  // Simple hash of dateKey to get consistent multiplier
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = ((hash << 5) - hash) + dateKey.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  const normalized = Math.abs(hash % 100) / 100; // 0 to 0.99
  return 1.2 + (normalized * 0.4); // 1.2 to 1.6
};

/**
 * Generate daily stats for a given date
 * Computes stats for all businesses + global, stores in DB (idempotent)
 * @param {Date} date - Date to generate stats for (defaults to yesterday IST)
 * @returns {Promise<Object>} - Generation report
 */
const generateDailyStats = async (date = null) => {
  // Default to yesterday IST if no date provided
  if (!date) {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET);
    date = new Date(istNow.getTime() - 24 * 60 * 60 * 1000); // Yesterday IST
  }
  
  const { startIST, endIST, dateKey } = getISTDateBoundaries(date);
  
  logger.info(`[DailyStats] Generating stats for ${dateKey}`, {
    startIST: startIST.toISOString(),
    endIST: endIST.toISOString(),
  });
  
  const report = {
    dateKey,
    businessesProcessed: 0,
    globalProcessed: false,
    errors: [],
  };
  
  try {
    // Get all active businesses (users with bills)
    const User = require('../models/User');
    const businesses = await User.find({ role: { $in: ['OWNER', 'owner'] } }).select('_id');
    
    // Compute stats for each business
    for (const business of businesses) {
      try {
        const metrics = await computeBusinessStats(dateKey, startIST, endIST, business._id);
        
        // Upsert into DailyStats (idempotent)
        await DailyStats.findOneAndUpdate(
          { dateKey, scope: 'business', businessId: business._id },
          {
            dateKey,
            scope: 'business',
            businessId: business._id,
            metrics,
            generatedAt: new Date(),
          },
          { upsert: true, new: true }
        );
        
        report.businessesProcessed++;
      } catch (error) {
        logger.error(`[DailyStats] Error processing business ${business._id}:`, error);
        report.errors.push({ businessId: business._id, error: error.message });
      }
    }
    
    // Compute global stats
    try {
      const { metrics: globalMetrics, isProjected } = await computeGlobalStats(dateKey, startIST, endIST);
      
      // Upsert global stats
      await DailyStats.findOneAndUpdate(
        { dateKey, scope: 'global', businessId: null },
        {
          dateKey,
          scope: 'global',
          businessId: null,
          metrics: globalMetrics,
          isProjected,
          generatedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      
      report.globalProcessed = true;
    } catch (error) {
      logger.error('[DailyStats] Error processing global stats:', error);
      report.errors.push({ scope: 'global', error: error.message });
    }
    
    logger.info('[DailyStats] Generation complete', report);
    return report;
  } catch (error) {
    logger.error('[DailyStats] Generation failed:', error);
    throw error;
  }
};

/**
 * Get daily stats for a given date
 * @param {string} dateKey - Date key (YYYY-MM-DD) or 'yesterday'
 * @param {string} businessId - Optional business ID (for business stats)
 * @returns {Promise<Object>} - { dateKey, business, global, generatedAt }
 */
const getDailyStats = async (dateKey, businessId = null) => {
  // Handle 'yesterday' keyword
  if (dateKey === 'yesterday') {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET);
    const yesterday = new Date(istNow.getTime() - 24 * 60 * 60 * 1000);
    const { dateKey: yesterdayKey } = getISTDateBoundaries(yesterday);
    dateKey = yesterdayKey;
  }
  
  const result = {
    dateKey,
    business: null,
    global: null,
    generatedAt: null,
  };
  
  // Get business stats if businessId provided
  if (businessId) {
    const businessStats = await DailyStats.findOne({
      dateKey,
      scope: 'business',
      businessId,
    });
    
    if (businessStats) {
      result.business = {
        ...businessStats.metrics,
        isProjected: false, // Business stats are always real
      };
      result.generatedAt = businessStats.generatedAt;
    }
  }
  
  // Get global stats
  const globalStats = await DailyStats.findOne({
    dateKey,
    scope: 'global',
    businessId: null,
  });
  
  if (globalStats) {
    result.global = {
      ...globalStats.metrics,
      isProjected: globalStats.isProjected || false,
    };
    if (!result.generatedAt) {
      result.generatedAt = globalStats.generatedAt;
    }
  }
  
  return result;
};

module.exports = {
  generateDailyStats,
  getDailyStats,
  getISTDateBoundaries,
};
