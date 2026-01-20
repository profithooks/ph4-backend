/**
 * Notification Controller
 * 
 * Handles notification queries and management
 */
const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');
const NotificationAttempt = require('../models/NotificationAttempt');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');

/**
 * Get user's notifications (inbox)
 * GET /api/v1/notifications?limit=50&cursor=
 */
const getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const cursor = req.query.cursor; // Cursor is a timestamp or ID
  
  const query = {userId};
  
  // Cursor pagination
  if (cursor) {
    query.createdAt = {$lt: new Date(cursor)};
  }
  
  const notifications = await Notification.find(query)
    .sort({createdAt: -1})
    .limit(limit)
    .lean();
  
  // Get latest attempt status for each notification
  const enriched = await Promise.all(
    notifications.map(async notification => {
      const attempts = await NotificationAttempt.find({
        notificationId: notification._id,
      })
        .sort({createdAt: -1})
        .lean();
      
      // Derive overall status from attempts
      let overallStatus = 'SENT';
      let hasQueued = false;
      let hasFailed = false;
      let hasRetrying = false;
      
      for (const attempt of attempts) {
        if (attempt.status === 'QUEUED' || attempt.status === 'LEASED') {
          hasQueued = true;
        } else if (attempt.status === 'RETRY_SCHEDULED') {
          hasRetrying = true;
        } else if (attempt.status === 'FAILED') {
          hasFailed = true;
        }
      }
      
      if (hasQueued) {
        overallStatus = 'QUEUED';
      } else if (hasRetrying) {
        overallStatus = 'RETRYING';
      } else if (hasFailed) {
        overallStatus = 'FAILED';
      }
      
      return {
        ...notification,
        overallStatus,
        attemptCount: attempts.length,
      };
    }),
  );
  
  // Next cursor
  const nextCursor = notifications.length === limit
    ? notifications[notifications.length - 1].createdAt
    : null;
  
  res.success({
    notifications: enriched,
    nextCursor,
    hasMore: !!nextCursor,
  });
});

/**
 * Get notification by ID with attempts
 * GET /api/v1/notifications/:id
 */
const getNotification = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const {id} = req.params;
  
  const notification = await Notification.findOne({
    _id: id,
    userId,
  }).lean();
  
  if (!notification) {
    throw new AppError('Notification not found', 404, 'NOT_FOUND');
  }
  
  // Get all attempts
  const attempts = await NotificationAttempt.find({
    notificationId: notification._id,
  })
    .sort({createdAt: -1})
    .lean();
  
  res.success({
    notification,
    attempts,
  });
});

/**
 * Get notifications for a customer
 * GET /api/v1/customers/:id/notifications?limit=20
 */
const getCustomerNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const {id: customerId} = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  
  // Verify customer belongs to user
  const customer = await Customer.findOne({
    _id: customerId,
    userId,
  });
  
  if (!customer) {
    throw new AppError('Customer not found', 404, 'NOT_FOUND');
  }
  
  // Get notifications for this customer
  const notifications = await Notification.find({
    userId,
    customerId,
  })
    .sort({createdAt: -1})
    .limit(limit)
    .lean();
  
  // Enrich with attempt status
  const enriched = await Promise.all(
    notifications.map(async notification => {
      const attempts = await NotificationAttempt.find({
        notificationId: notification._id,
      })
        .sort({createdAt: -1})
        .lean();
      
      // Derive overall status
      let overallStatus = 'SENT';
      
      for (const attempt of attempts) {
        if (attempt.status === 'QUEUED' || attempt.status === 'LEASED') {
          overallStatus = 'QUEUED';
          break;
        } else if (attempt.status === 'RETRY_SCHEDULED') {
          overallStatus = 'RETRYING';
          break;
        } else if (attempt.status === 'FAILED') {
          overallStatus = 'FAILED';
          break;
        }
      }
      
      return {
        ...notification,
        overallStatus,
        attempts,
      };
    }),
  );
  
  res.success({
    customerId,
    customerName: customer.name,
    notifications: enriched,
  });
});

/**
 * Mark notification as read
 * POST /api/v1/notifications/:id/read
 */
const markAsRead = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const {id} = req.params;
  
  const notification = await Notification.findOneAndUpdate(
    {
      _id: id,
      userId,
      readAt: null, // Only update if not already read
    },
    {
      $set: {readAt: new Date()},
    },
    {new: true},
  );
  
  if (!notification) {
    throw new AppError('Notification not found or already read', 404, 'NOT_FOUND');
  }
  
  res.success({notification});
});

/**
 * Get unread count
 * GET /api/v1/notifications/unread/count
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  
  const count = await Notification.countDocuments({
    userId,
    readAt: null,
  });
  
  res.success({count});
});

module.exports = {
  getNotifications,
  getNotification,
  getCustomerNotifications,
  markAsRead,
  getUnreadCount,
};
