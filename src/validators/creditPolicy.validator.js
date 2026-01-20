/**
 * Credit Policy Validators
 * 
 * Step 12: Production Readiness
 */
const Joi = require('joi');
const {objectIdSchema} = require('../middleware/validation.middleware');

const updateCreditPolicySchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),
  body: Joi.object({
    creditLimitEnabled: Joi.boolean(),
    creditLimitAmount: Joi.number().min(0).max(100000000),
    creditLimitGraceAmount: Joi.number().min(0).max(100000000),
    creditLimitAllowOverride: Joi.boolean(),
  }).min(1),
};

const createBillWithOverrideSchema = {
  body: Joi.object({
    // Bill fields (add existing bill fields)
    customerId: objectIdSchema.required(),
    amount: Joi.number().min(0).required(),
    dueDate: Joi.date().iso(),
    // Override fields
    ownerOverride: Joi.boolean().default(false),
    overrideReason: Joi.string().max(500).when('ownerOverride', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  }),
};

module.exports = {
  updateCreditPolicySchema,
  createBillWithOverrideSchema,
};
