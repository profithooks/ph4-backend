/**
 * Auth route validation schemas
 */
const Joi = require('joi');

/**
 * Validate signup payload
 * Note: 'email' field can be either email or phone number
 */
const signupSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  email: Joi.string().trim().min(1).max(100).required(),
  password: Joi.string().min(6).max(100).required(),
  phone: Joi.string().trim().min(10).max(15).optional().allow(''),
});

/**
 * Validate login payload
 * Note: 'email' field can be either email or phone number
 */
const loginSchema = Joi.object({
  email: Joi.string().trim().min(1).max(100).required(),
  password: Joi.string().required(),
});

module.exports = {
  signupSchema,
  loginSchema,
};
