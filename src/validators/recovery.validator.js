/**
 * Recovery route validation schemas
 */
const Joi = require('joi');

/**
 * Validate ObjectId string format
 */
const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * Validate open recovery case payload
 */
const openCaseSchema = Joi.object({
  customerId: objectIdSchema.required(),
  pendingAmount: Joi.number().positive().required(),
  reason: Joi.string().max(500).optional().allow(''),
});

/**
 * Validate set promise payload
 */
const setPromiseSchema = Joi.object({
  customerId: objectIdSchema.required(),
  promiseAt: Joi.date().required(),
  promiseAmount: Joi.number().positive().required(),
  notes: Joi.string().max(500).optional().allow(''),
});

/**
 * Validate update recovery status payload
 */
const updateStatusSchema = Joi.object({
  customerId: objectIdSchema.required(),
  status: Joi.string()
    .valid('open', 'promise', 'kept', 'broken', 'escalated', 'closed')
    .required(),
  notes: Joi.string().max(500).optional().allow(''),
});

/**
 * Validate auto-keep promise payload
 */
const autoKeepPromiseSchema = Joi.object({
  customerId: objectIdSchema.required(),
  paidAmount: Joi.number().positive().required(),
});

/**
 * Validate escalate promise payload
 */
const escalatePromiseSchema = Joi.object({
  reason: Joi.string().max(500).optional().allow(''),
  escalationLevel: Joi.string().valid('low', 'medium', 'high').default('medium'),
});

module.exports = {
  openCaseSchema,
  setPromiseSchema,
  updateStatusSchema,
  autoKeepPromiseSchema,
  escalatePromiseSchema,
};
