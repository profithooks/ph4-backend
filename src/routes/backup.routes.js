/**
 * Backup Routes
 * 
 * Backup and restore system (currently disabled)
 * Returns 501 NOT_IMPLEMENTED for all endpoints
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {requireOwner} = require('../middleware/permission.middleware');

// All routes require authentication and owner permissions
router.use(protect);
router.use(requireOwner);

/**
 * 501 NOT_IMPLEMENTED handler
 * Returns consistent error response for disabled backup features
 */
const notImplementedHandler = (req, res) => {
  res.status(501).json({
    success: false,
    code: 'NOT_IMPLEMENTED',
    message: 'Backup/Restore is disabled in this build',
  });
};

/**
 * @route   POST /api/v1/backup/export
 * @desc    Export backup (disabled)
 * @access  Private (Owner)
 */
router.post('/export', notImplementedHandler);

/**
 * @route   GET /api/v1/backup/export/:jobId
 * @desc    Get export job status (disabled)
 * @access  Private (Owner)
 */
router.get('/export/:jobId', notImplementedHandler);

/**
 * @route   POST /api/v1/backup/restore/init
 * @desc    Initialize restore (disabled)
 * @access  Private (Owner)
 */
router.post('/restore/init', notImplementedHandler);

/**
 * @route   POST /api/v1/backup/restore/:jobId/confirm
 * @desc    Confirm restore (disabled)
 * @access  Private (Owner)
 */
router.post('/restore/:jobId/confirm', notImplementedHandler);

/**
 * @route   GET /api/v1/backup/restore/:jobId
 * @desc    Get restore job status (disabled)
 * @access  Private (Owner)
 */
router.get('/restore/:jobId', notImplementedHandler);

module.exports = router;
