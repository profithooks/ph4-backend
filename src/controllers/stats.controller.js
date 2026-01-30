/**
 * Stats Controller
 * 
 * Handles daily statistics API endpoints
 */
const asyncHandler = require('express-async-handler');
const { getDailyStats } = require('../services/dailyStatsService');

/**
 * @desc    Get daily stats
 * @route   GET /api/v1/stats/daily?date=yesterday|YYYY-MM-DD
 * @access  Private (business stats require auth)
 */
const getDailyStatsHandler = asyncHandler(async (req, res) => {
  const { date = 'yesterday' } = req.query;
  // Use businessId if exists, otherwise use user's own _id
  const businessId = req.user?.businessId || req.user?._id || null;
  
  // Validate date format if not 'yesterday'
  if (date !== 'yesterday' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Invalid date format. Use YYYY-MM-DD or "yesterday"',
        code: 'INVALID_DATE_FORMAT',
      },
    });
  }
  
  const stats = await getDailyStats(date, businessId);
  
  res.success(stats, 200);
});

module.exports = {
  getDailyStatsHandler,
};
