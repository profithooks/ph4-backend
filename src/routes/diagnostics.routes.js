/**
 * Diagnostics routes
 * 
 * Read-only endpoints for viewing reliability events and system diagnostics
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {requireOwner} = require('../middleware/permission.middleware');
const {
  getReliabilityEvents,
  getReliabilityEventByRequestId,
  getReliabilityStats,
  notificationDryRun,
} = require('../controllers/diagnostics.controller');
const {
  getLatestIntegrityReport,
  getIntegrityReportHistory,
  runIntegrityCheck,
} = require('../controllers/integrity.controller');

// All diagnostics routes require authentication
router.use(protect);

/**
 * @route   GET /api/v1/diagnostics/reliability
 * @desc    Get reliability events for current user
 * @query   limit (number, max 500, default 100)
 * @query   kind (string, optional: WRITE_FAIL, ENGINE_FAIL, SYNC_FAIL, NOTIF_FAIL)
 * @access  Private
 */
router.get('/reliability', getReliabilityEvents);

/**
 * @route   GET /api/v1/diagnostics/reliability/stats
 * @desc    Get reliability stats summary
 * @query   hours (number, default 24)
 * @access  Private
 */
router.get('/reliability/stats', getReliabilityStats);

/**
 * @route   GET /api/v1/diagnostics/reliability/:requestId
 * @desc    Get reliability event by requestId
 * @access  Private
 */
router.get('/reliability/:requestId', getReliabilityEventByRequestId);

/**
 * @route   GET /api/v1/diagnostics/integrity/latest
 * @desc    Get latest integrity report
 * @access  Owner
 */
router.get('/integrity/latest', requireOwner, getLatestIntegrityReport);

/**
 * @route   GET /api/v1/diagnostics/integrity/history
 * @desc    Get integrity report history
 * @access  Owner
 */
router.get('/integrity/history', requireOwner, getIntegrityReportHistory);

/**
 * @route   POST /api/v1/diagnostics/integrity/run
 * @desc    Run integrity check on-demand
 * @access  Owner
 */
router.post('/integrity/run', requireOwner, runIntegrityCheck);


module.exports = router;
