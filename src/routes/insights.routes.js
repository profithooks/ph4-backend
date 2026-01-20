/**
 * Insights Routes
 * 
 * Decision Intelligence: Aging, forecast, defaulters
 * Step 7: Decision Intelligence
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {
  getAgingBuckets,
  getCashInForecast,
  getDefaulterRiskList,
  getBusinessInterest,
  getFinancialYearSummary,
} = require('../controllers/insights.controller');

// All routes require authentication
router.use(protect);

/**
 * @route   GET /api/v1/insights/aging
 * @desc    Get aging buckets (0-7, 8-15, 16-30, 31-60, 60+)
 * @query   date (optional YYYY-MM-DD)
 * @access  Private
 */
router.get('/aging', getAgingBuckets);

/**
 * @route   GET /api/v1/insights/forecast
 * @desc    Get cash-in forecast (7/30 days)
 * @query   date (optional YYYY-MM-DD)
 * @access  Private
 */
router.get('/forecast', getCashInForecast);

/**
 * @route   GET /api/v1/insights/defaulters
 * @desc    Get defaulter risk list
 * @query   date (optional YYYY-MM-DD), limit (default 20, max 100)
 * @access  Private
 */
router.get('/defaulters', getDefaulterRiskList);

/**
 * @route   GET /api/v1/insights/interest
 * @desc    Get business interest summary
 * @query   date (optional YYYY-MM-DD), limit (default 50, max 100)
 * @access  Private
 */
router.get('/interest', getBusinessInterest);

/**
 * @route   GET /api/v1/insights/financial-year
 * @desc    Get financial year opening/closing summary
 * @query   fyStart (optional YYYY-MM-DD), fyEnd (optional YYYY-MM-DD)
 * @access  Private
 */
router.get('/financial-year', getFinancialYearSummary);

module.exports = router;
