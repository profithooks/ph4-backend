/**
 * Notification Routes
 * 
 * Endpoints for managing and viewing notifications
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {
  getNotifications,
  getNotification,
  getCustomerNotifications,
  markAsRead,
  getUnreadCount,
} = require('../controllers/notification.controller');

// All routes require authentication
router.use(protect);

/**
 * @route   GET /api/v1/notifications
 * @desc    Get user's notifications (inbox)
 * @query   limit (number, default 50, max 100)
 * @query   cursor (ISO timestamp for pagination)
 * @access  Private
 */
router.get('/', getNotifications);

/**
 * @route   GET /api/v1/notifications/unread/count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread/count', getUnreadCount);

/**
 * @route   GET /api/v1/notifications/:id
 * @desc    Get notification by ID with attempts
 * @access  Private
 */
router.get('/:id', getNotification);

/**
 * @route   POST /api/v1/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.post('/:id/read', markAsRead);

module.exports = router;
