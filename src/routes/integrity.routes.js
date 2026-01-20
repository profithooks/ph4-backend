/**
 * Integrity Routes
 * 
 * Endpoints for data integrity checking and reporting
 * Step 21: Data Integrity & Reconciliation
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { requireOwner } = require('../middleware/permission.middleware');
const {
  getLatestIntegrityReport,
  getIntegrityReportHistory,
  runIntegrityCheck,
} = require('../controllers/integrity.controller');

// All routes require authentication
router.use(protect);

/**
 * @route   GET /api/v1/diagnostics/integrity/latest
 * @desc    Get latest integrity report
 * @access  Owner
 */
router.get('/latest', requireOwner, getLatestIntegrityReport);

/**
 * @route   GET /api/v1/diagnostics/integrity/history
 * @desc    Get integrity report history
 * @access  Owner
 */
router.get('/history', requireOwner, getIntegrityReportHistory);

/**
 * @route   POST /api/v1/diagnostics/integrity/run
 * @desc    Run integrity check on-demand
 * @access  Owner
 */
router.post('/run', requireOwner, runIntegrityCheck);

module.exports = router;
