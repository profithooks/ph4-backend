/**
 * Message event controllers
 */
const MessageEvent = require('../models/MessageEvent');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');
const {enqueueEvent, retryMessage} = require('../services/messageDelivery.service');

/**
 * @route   POST /api/messages/events
 * @desc    Create message event (idempotent via idempotencyKey)
 * @access  Private
 */
exports.createMessageEvent = async (req, res, next) => {
  try {
    const {
      customerId,
      channel,
      templateKey,
      payload,
      status,
      idempotencyKey,
      requestId,
    } = req.body;

    // Validate required fields
    if (!customerId) {
      return next(new AppError('Customer ID is required', 400, 'VALIDATION_ERROR'));
    }
    if (!templateKey) {
      return next(new AppError('Template key is required', 400, 'VALIDATION_ERROR'));
    }
    if (!payload) {
      return next(new AppError('Payload is required', 400, 'VALIDATION_ERROR'));
    }
    if (!idempotencyKey) {
      return next(new AppError('Idempotency key is required', 400, 'VALIDATION_ERROR'));
    }

    // Verify customer exists and belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      userId: req.user._id,
    });

    if (!customer) {
      return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    }

    // Idempotent upsert: if same idempotencyKey exists, return existing doc
    const existingEvent = await MessageEvent.findOne({
      userId: req.user._id,
      idempotencyKey,
    });

    if (existingEvent) {
      // Idempotency hit - return existing event
      return res.status(200).json({
        success: true,
        data: existingEvent,
        idempotent: true,
      });
    }

    // Create new message event
    const messageEvent = await MessageEvent.create({
      userId: req.user._id,
      customerId,
      channel: channel || 'WHATSAPP',
      templateKey,
      payload,
      status: status || 'CREATED',
      idempotencyKey,
      requestId: requestId || req.requestId, // Use request UID if not provided
    });

    // Auto-enqueue for delivery if CREATED
    if (messageEvent.status === 'CREATED') {
      try {
        await enqueueEvent(messageEvent._id.toString());
      } catch (enqueueError) {
        console.error('[MessageController] Failed to enqueue message:', enqueueError);
        // Don't fail the request - message can be enqueued later
      }
    }

    res.status(201).json({
      success: true,
      data: messageEvent,
      idempotent: false,
    });
  } catch (error) {
    // Handle duplicate key error (race condition on unique index)
    if (error.code === 11000) {
      // Fetch the existing document
      const existingEvent = await MessageEvent.findOne({
        userId: req.user._id,
        idempotencyKey: req.body.idempotencyKey,
      });
      
      return res.status(200).json({
        success: true,
        data: existingEvent,
        idempotent: true,
      });
    }
    next(error);
  }
};

/**
 * @route   GET /api/messages/events
 * @desc    Get message events for a customer (timeline)
 * @access  Private
 */
exports.getMessageEvents = async (req, res, next) => {
  try {
    const {customerId, limit = 50} = req.query;

    if (!customerId) {
      return next(new AppError('Customer ID is required', 400, 'VALIDATION_ERROR'));
    }

    // Verify customer exists and belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      userId: req.user._id,
    });

    if (!customer) {
      return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    }

    // Fetch message events
    const events = await MessageEvent.find({
      userId: req.user._id,
      customerId,
    })
      .sort({createdAt: -1})
      .limit(parseInt(limit, 10));

    res.status(200).json({
      success: true,
      data: events,
      count: events.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/messages/events/:eventId
 * @desc    Get a single message event by ID
 * @access  Private
 */
exports.getMessageEventById = async (req, res, next) => {
  try {
    const {eventId} = req.params;

    const event = await MessageEvent.findOne({
      _id: eventId,
      userId: req.user._id,
    });

    if (!event) {
      return next(new AppError('Message event not found', 404, 'NOT_FOUND'));
    }

    res.status(200).json({
      success: true,
      data: event,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PATCH /api/messages/events/:eventId/status
 * @desc    Update message event status (e.g., SENT -> DELIVERED)
 * @access  Private
 */
exports.updateMessageEventStatus = async (req, res, next) => {
  try {
    const {eventId} = req.params;
    const {status} = req.body;

    const validStatuses = ['CREATED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED'];
    if (!status || !validStatuses.includes(status)) {
      return next(
        new AppError(
          `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    const event = await MessageEvent.findOne({
      _id: eventId,
      userId: req.user._id,
    });

    if (!event) {
      return next(new AppError('Message event not found', 404, 'NOT_FOUND'));
    }

    event.status = status;
    await event.save();

    res.status(200).json({
      success: true,
      data: event,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/messages/events/:eventId/retry
 * @desc    Retry a failed message (manual retry)
 * @access  Private
 */
exports.retryMessageEvent = async (req, res, next) => {
  try {
    const {eventId} = req.params;

    // Verify message belongs to user
    const event = await MessageEvent.findOne({
      _id: eventId,
      userId: req.user._id,
    });

    if (!event) {
      return next(new AppError('Message event not found', 404, 'NOT_FOUND'));
    }

    // Retry via service
    const retriedEvent = await retryMessage(eventId);

    res.status(200).json({
      success: true,
      data: retriedEvent,
      message: 'Message queued for retry',
    });
  } catch (error) {
    // Handle service errors
    if (error.message.includes('Cannot retry')) {
      return next(new AppError(error.message, 400, 'INVALID_OPERATION'));
    }
    next(error);
  }
};
