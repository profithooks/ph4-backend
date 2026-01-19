/**
 * Message event routes
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validate.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  createMessageEventSchema,
  updateMessageStatusSchema,
} = require('../validators/message.validator');
const {
  createMessageEvent,
  getMessageEvents,
  getMessageEventById,
  updateMessageEventStatus,
  retryMessageEvent,
} = require('../controllers/message.controller');

// All routes are protected
router.use(protect);

// POST /api/messages/events - Create message event (idempotent)
router.post('/events', validate(createMessageEventSchema), createMessageEvent);

// GET /api/messages/events?customerId=...&limit=50 - List customer events
router.get('/events', getMessageEvents);

// GET /api/messages/events/:eventId - Get single event
router.get('/events/:eventId', validateObjectId('eventId'), getMessageEventById);

// PATCH /api/messages/events/:eventId/status - Update event status
router.patch('/events/:eventId/status', validateObjectId('eventId'), validate(updateMessageStatusSchema), updateMessageEventStatus);

// POST /api/messages/events/:eventId/retry - Retry failed message
router.post('/events/:eventId/retry', validateObjectId('eventId'), retryMessageEvent);

module.exports = router;
