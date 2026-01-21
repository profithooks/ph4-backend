/**
 * Support Controller
 * 
 * Support ticketing system with SLA tracking
 * Step 11: Fairness & Support
 */
const SupportTicket = require('../models/SupportTicket');
const SupportTicketMessage = require('../models/SupportTicketMessage');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Create support ticket
 * POST /api/v1/support/tickets
 */
exports.createTicket = async (req, res, next) => {
  try {
    const {subject, message, category, priority} = req.body;
    const userId = req.user._id;
    const businessId = req.user.businessId || userId;
    
    // Create ticket
    const ticket = await SupportTicket.create({
      businessId,
      userId,
      subject,
      message,
      category: category || 'OTHER',
      priority: priority || 'MEDIUM',
      status: 'OPEN',
    });
    
    // Create initial message
    await SupportTicketMessage.create({
      ticketId: ticket._id,
      senderType: 'CUSTOMER',
      senderUserId: userId,
      senderName: req.user.businessName || req.user.phone,
      message,
      isInternal: false,
    });
    
    logger.info('[Support] Ticket created', {
      ticketId: ticket._id,
      userId,
      subject: ticket.subject,
      priority: ticket.priority,
    });
    
    res.status(201).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    logger.error('[Support] Create ticket error', error);
    next(error);
  }
};

/**
 * Get user's tickets
 * GET /api/v1/support/tickets
 */
exports.getUserTickets = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {status, limit = 20} = req.query;
    
    const query = {userId};
    if (status) {
      query.status = status;
    }
    
    const tickets = await SupportTicket.find(query)
      .sort({createdAt: -1})
      .limit(parseInt(limit, 10));
    
    res.status(200).json({
      success: true,
      data: tickets,
    });
  } catch (error) {
    logger.error('[Support] Get user tickets error', error);
    next(error);
  }
};

/**
 * Get ticket details with messages
 * GET /api/v1/support/tickets/:id
 */
exports.getTicketDetails = async (req, res, next) => {
  try {
    const {id} = req.params;
    const userId = req.user._id;
    
    // Get ticket
    const ticket = await SupportTicket.findOne({
      _id: id,
      userId,
    });
    
    if (!ticket) {
      throw new AppError('Ticket not found', 404, 'NOT_FOUND');
    }
    
    // Get messages (excluding internal notes)
    const messages = await SupportTicketMessage.find({
      ticketId: id,
      isInternal: false,
    }).sort({createdAt: 1});
    
    res.status(200).json({
      success: true,
      data: {
        ticket,
        messages,
      },
    });
  } catch (error) {
    logger.error('[Support] Get ticket details error', error);
    next(error);
  }
};

/**
 * Add message to ticket
 * POST /api/v1/support/tickets/:id/messages
 */
exports.addTicketMessage = async (req, res, next) => {
  try {
    const {id} = req.params;
    const {message} = req.body;
    const userId = req.user._id;
    
    // Verify ticket exists and belongs to user
    const ticket = await SupportTicket.findOne({
      _id: id,
      userId,
    });
    
    if (!ticket) {
      throw new AppError('Ticket not found', 404, 'NOT_FOUND');
    }
    
    // Create message
    const ticketMessage = await SupportTicketMessage.create({
      ticketId: id,
      senderType: 'CUSTOMER',
      senderUserId: userId,
      senderName: req.user.businessName || req.user.phone,
      message,
      isInternal: false,
    });
    
    // Update ticket lastReplyAt
    ticket.lastReplyAt = new Date();
    await ticket.save();
    
    logger.info('[Support] Message added to ticket', {
      ticketId: id,
      userId,
      messageId: ticketMessage._id,
    });
    
    res.status(201).json({
      success: true,
      data: ticketMessage,
    });
  } catch (error) {
    logger.error('[Support] Add ticket message error', error);
    next(error);
  }
};

/**
 * Get all tickets (admin only)
 * GET /api/v1/support/admin/tickets
 */
exports.getAdminTickets = async (req, res, next) => {
  try {
    const {status, limit = 50} = req.query;
    
    const query = {};
    if (status) {
      query.status = status;
    }
    
    const tickets = await SupportTicket.find(query)
      .populate('userId', 'phone businessName')
      .sort({createdAt: -1})
      .limit(parseInt(limit, 10));
    
    res.status(200).json({
      success: true,
      data: tickets,
    });
  } catch (error) {
    logger.error('[Support] Get admin tickets error', error);
    next(error);
  }
};

/**
 * Update ticket status (admin only)
 * PATCH /api/v1/support/admin/tickets/:id/status
 * PATCH /api/v1/support/tickets/:id/status (owner alias)
 */
exports.updateTicketStatus = async (req, res, next) => {
  try {
    const {id} = req.params;
    const {status, internalNote} = req.body;
    
    // Find ticket
    const ticket = await SupportTicket.findById(id);
    
    if (!ticket) {
      throw new AppError('Ticket not found', 404, 'NOT_FOUND');
    }
    
    // Update status
    ticket.status = status;
    
    // Set resolved/closed timestamps
    if (status === 'RESOLVED' && !ticket.resolvedAt) {
      ticket.resolvedAt = new Date();
    }
    if (status === 'CLOSED' && !ticket.closedAt) {
      ticket.closedAt = new Date();
    }
    
    await ticket.save();
    
    // Add internal note if provided
    if (internalNote) {
      await SupportTicketMessage.create({
        ticketId: id,
        senderType: 'SUPPORT',
        senderEmail: req.user.email || 'system',
        senderName: 'Support Team',
        message: internalNote,
        isInternal: true,
      });
    }
    
    logger.info('[Support] Ticket status updated', {
      ticketId: id,
      newStatus: status,
      updatedBy: req.user._id,
    });
    
    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    logger.error('[Support] Update ticket status error', error);
    next(error);
  }
};

/**
 * Add support message (admin only)
 * POST /api/v1/support/admin/tickets/:id/messages
 */
exports.addAdminMessage = async (req, res, next) => {
  try {
    const {id} = req.params;
    const {message, isInternal = false} = req.body;
    
    // Verify ticket exists
    const ticket = await SupportTicket.findById(id);
    
    if (!ticket) {
      throw new AppError('Ticket not found', 404, 'NOT_FOUND');
    }
    
    // Create message
    const ticketMessage = await SupportTicketMessage.create({
      ticketId: id,
      senderType: 'SUPPORT',
      senderEmail: req.user.email || 'system',
      senderName: 'Support Team',
      message,
      isInternal,
    });
    
    // Update ticket lastReplyAt
    ticket.lastReplyAt = new Date();
    await ticket.save();
    
    logger.info('[Support] Admin message added to ticket', {
      ticketId: id,
      messageId: ticketMessage._id,
      isInternal,
    });
    
    res.status(201).json({
      success: true,
      data: ticketMessage,
    });
  } catch (error) {
    logger.error('[Support] Add admin message error', error);
    next(error);
  }
};
