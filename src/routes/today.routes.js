/**
 * Today Routes
 * 
 * Daily chase list + money-at-risk dashboard
 * Step 6: Recovery Engine (Cash Return)
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {
  getTodaySummary,
  getDailyChaseList,
} = require('../controllers/today.controller');

// All routes require authentication
router.use(protect);

/**
 * @route   GET /api/v1/today/summary
 * @desc    Get money-at-risk summary for today
 * @query   date (optional YYYY-MM-DD)
 * @access  Private
 */
router.get('/summary', getTodaySummary);

/**
 * @route   GET /api/v1/today/chase
 * @desc    Get daily chase list (who to chase today)
 * @query   date (optional YYYY-MM-DD)
 * @query   limit (default 50, max 200)
 * @access  Private
 */
router.get('/chase', getDailyChaseList);

module.exports = router;
