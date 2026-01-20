/**
 * Audit Routes
 * 
 * Business-wide audit log endpoints
 * Step 5: Staff Accountability
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {
  getBusinessAudit,
  getAuditEvent,
  getAuditStats,
} = require('../controllers/audit.controller');

// All routes require authentication
router.use(protect);

/**
 * @route   GET /api/v1/audit
 * @desc    Get business-wide audit log
 * @query   limit (number, default 100, max 500)
 * @query   cursor (ISO timestamp for pagination)
 * @query   filter (entity type: BILL, CUSTOMER, FOLLOWUP, etc.)
 * @access  Private
 */
router.get('/', getBusinessAudit);

/**
 * @route   GET /api/v1/audit/stats
 * @desc    Get audit statistics
 * @query   days (number, default 30)
 * @access  Private
 */
router.get('/stats', getAuditStats);

/**
 * @route   GET /api/v1/audit/:id
 * @desc    Get specific audit event by ID
 * @access  Private
 */
router.get('/:id', getAuditEvent);

module.exports = router;
