/**
 * Analytics Controller
 * 
 * Analytics and reporting endpoints
 */
const asyncHandler = require('express-async-handler');
const {computeAgingAnalytics} = require('../services/agingAnalytics.service');
const logger = require('../utils/logger');

/**
 * Get aging analytics
 * GET /api/v1/analytics/aging
 */
const getAgingAnalytics = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  
  logger.info('[Analytics] Getting aging analytics', {userId});
  
  const analytics = await computeAgingAnalytics(userId);
  
  res.success(analytics, 200);
});

module.exports = {
  getAgingAnalytics,
};
