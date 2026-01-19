/**
 * Item route validation schemas
 */
const Joi = require('joi');

/**
 * Validate item creation payload
 */
const createItemSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  price: Joi.number().min(0).required(),
  unit: Joi.string().valid('pcs', 'kg', 'ltr', 'box', 'dozen', 'meter', 'other').default('pcs'),
  description: Joi.string().max(500).optional().allow(''),
  category: Joi.string().max(100).optional().allow(''),
});

/**
 * Validate item update payload
 */
const updateItemSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200),
  price: Joi.number().min(0),
  unit: Joi.string().valid('pcs', 'kg', 'ltr', 'box', 'dozen', 'meter', 'other'),
  description: Joi.string().max(500).allow(''),
  category: Joi.string().max(100).allow(''),
}).min(1);

/**
 * Validate item upsert payload
 */
const upsertItemSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  price: Joi.number().min(0).required(),
  unit: Joi.string().valid('pcs', 'kg', 'ltr', 'box', 'dozen', 'meter', 'other').default('pcs'),
});

module.exports = {
  createItemSchema,
  updateItemSchema,
  upsertItemSchema,
};
