/**
 * Follow-up route validation schemas
 */
const Joi = require('joi');

/**
 * Validate ObjectId string format
 */
const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * Validate follow-up task creation payload
 */
const createTaskSchema = Joi.object({
  customerId: objectIdSchema.required(),
  title: Joi.string().trim().max(200).optional().allow(''),
  dueAt: Joi.date().required(),
  priority: Joi.string().valid('low', 'medium', 'high').default('medium'),
  notes: Joi.string().max(1000).optional().allow(''),
  status: Joi.string().valid('pending', 'completed', 'cancelled').default('pending'),
});

/**
 * Validate follow-up task update payload
 */
const updateTaskSchema = Joi.object({
  title: Joi.string().trim().max(200).allow(''),
  dueAt: Joi.date(),
  priority: Joi.string().valid('low', 'medium', 'high'),
  notes: Joi.string().max(1000).allow(''),
  status: Joi.string().valid('pending', 'completed', 'cancelled'),
}).min(1);

/**
 * Validate auto-generate followups payload
 */
const autoGenerateSchema = Joi.object({
  force: Joi.boolean().default(false),
});

module.exports = {
  createTaskSchema,
  updateTaskSchema,
  autoGenerateSchema,
};
