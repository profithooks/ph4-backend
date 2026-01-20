/**
 * Security Validators
 * 
 * Step 12: Production Readiness
 */
const Joi = require('joi');
const {objectIdSchema, phoneSchema} = require('../middleware/validation.middleware');

const enableRecoverySchema = {
  body: Joi.object({
    recoveryPin: Joi.string().regex(/^[0-9]{4,6}$/).required(),
    recoveryEmail: Joi.string().email().optional(),
  }),
};

const verifyRecoveryPinSchema = {
  body: Joi.object({
    phone: phoneSchema.required(),
    recoveryPin: Joi.string().regex(/^[0-9]{4,6}$/).required(),
  }),
};

const approveDeviceSchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),
  body: Joi.object({
    reason: Joi.string().max(500).optional(),
  }),
};

const blockDeviceSchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),
  body: Joi.object({
    reason: Joi.string().max(500).required(),
  }),
};

module.exports = {
  enableRecoverySchema,
  verifyRecoveryPinSchema,
  approveDeviceSchema,
  blockDeviceSchema,
};
