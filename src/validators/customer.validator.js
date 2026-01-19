/**
 * Customer route validation schemas
 */
const Joi = require('joi');

/**
 * Validate customer creation payload
 */
const createCustomerSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  phone: Joi.string().trim().min(10).max(15).required(),
  email: Joi.string().email().max(100).optional().allow(''),
  address: Joi.string().max(500).optional().allow(''),
  notes: Joi.string().max(1000).optional().allow(''),
  balance: Joi.number().default(0),
});

/**
 * Validate customer update payload
 */
const updateCustomerSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100),
  phone: Joi.string().trim().min(10).max(15),
  email: Joi.string().email().max(100).allow(''),
  address: Joi.string().max(500).allow(''),
  notes: Joi.string().max(1000).allow(''),
}).min(1); // At least one field required

module.exports = {
  createCustomerSchema,
  updateCustomerSchema,
};
