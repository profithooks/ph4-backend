/**
 * Message route validation schemas
 */
const Joi = require('joi');

/**
 * Validate ObjectId string format
 */
const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * Validate message event creation payload
 */
const createMessageEventSchema = Joi.object({
  customerId: objectIdSchema.required(),
  messageType: Joi.string().valid('whatsapp', 'sms', 'email').required(),
  content: Joi.string().min(1).max(5000).required(),
  scheduledAt: Joi.date().optional(),
  metadata: Joi.object().optional(),
});

/**
 * Validate message event status update payload
 */
const updateMessageStatusSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'sent', 'delivered', 'failed', 'cancelled')
    .required(),
  errorMessage: Joi.string().max(500).optional().allow(''),
});

module.exports = {
  createMessageEventSchema,
  updateMessageStatusSchema,
};
