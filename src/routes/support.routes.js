/**
 * Support Routes
 * 
 * Support ticketing system
 * Step 11: Fairness & Support
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {
  createTicket,
  getUserTickets,
  getTicketDetails,
  addTicketMessage,
  getAdminTickets,
  updateTicketStatus,
  addAdminMessage,
} = require('../controllers/support.controller');

// All routes require authentication
router.use(protect);

/**
 * @route   POST /api/v1/support/tickets
 * @desc    Create support ticket
 * @access  Private
 */
router.post('/tickets', createTicket);

/**
 * @route   GET /api/v1/support/tickets
 * @desc    Get user's tickets
 * @query   status, limit
 * @access  Private
 */
router.get('/tickets', getUserTickets);

/**
 * @route   GET /api/v1/support/tickets/:id
 * @desc    Get ticket details with messages
 * @access  Private
 */
router.get('/tickets/:id', getTicketDetails);

/**
 * @route   POST /api/v1/support/tickets/:id/messages
 * @desc    Add message to ticket
 * @access  Private
 */
router.post('/tickets/:id/messages', addTicketMessage);

/**
 * ADMIN ROUTES
 */

/**
 * @route   GET /api/v1/support/admin/tickets
 * @desc    Get all tickets (admin only)
 * @query   status, limit
 * @access  Private (Admin)
 */
router.get('/admin/tickets', getAdminTickets);

/**
 * @route   PATCH /api/v1/support/admin/tickets/:id/status
 * @desc    Update ticket status (admin only)
 * @access  Private (Admin)
 */
router.patch('/admin/tickets/:id/status', updateTicketStatus);

/**
 * @route   POST /api/v1/support/admin/tickets/:id/messages
 * @desc    Add support message (admin only)
 * @access  Private (Admin)
 */
router.post('/admin/tickets/:id/messages', addAdminMessage);

module.exports = router;
