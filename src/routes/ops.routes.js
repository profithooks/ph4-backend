/**
 * Ops Routes
 * 
 * Operational metrics and monitoring endpoints
 * Step 23: Go-Live & Rollout Control
 * Step 24: Post-Launch Metrics & Feedback Loop
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { requireOwner } = require('../middleware/permission.middleware');
const {
  getSystemHealth,
  getSystemActivity,
  getDashboard,
} = require('../controllers/ops.controller');
const {
  getWeeklyMetrics,
  exportWeeklyMetrics,
} = require('../controllers/opsWeekly.controller');

// All routes require authentication and owner role
router.use(protect, requireOwner);

/**
 * @route   GET /api/v1/ops/health
 * @desc    Get system health metrics
 * @access  Owner
 */
router.get('/health', getSystemHealth);

/**
 * @route   GET /api/v1/ops/activity
 * @desc    Get business activity metrics
 * @access  Owner
 */
router.get('/activity', getSystemActivity);

/**
 * @route   GET /api/v1/ops/dashboard
 * @desc    Get combined health + activity dashboard
 * @access  Owner
 */
router.get('/dashboard', getDashboard);

/**
 * @route   GET /api/v1/ops/weekly
 * @desc    Get weekly KPIs and drift detection
 * @query   from (YYYY-MM-DD, optional)
 * @query   to (YYYY-MM-DD, optional)
 * @access  Owner
 */
router.get('/weekly', getWeeklyMetrics);

/**
 * @route   GET /api/v1/ops/weekly/export
 * @desc    Export weekly metrics as CSV or JSON
 * @query   from (YYYY-MM-DD, optional)
 * @query   to (YYYY-MM-DD, optional)
 * @query   format (csv|json, default: csv)
 * @access  Owner
 */
router.get('/weekly/export', exportWeeklyMetrics);

module.exports = router;
