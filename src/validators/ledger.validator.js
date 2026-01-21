/**
 * Ledger route validation schemas
 */
const Joi = require('joi');

/**
 * Validate ObjectId string format
 */
const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * Validate credit transaction payload
 */
const addCreditSchema = Joi.object({
  customerId: objectIdSchema.required(),
  amount: Joi.number().positive().required(),
  note: Joi.string().max(500).optional().allow(''),
  transactionDate: Joi.date().optional(),
  idempotencyKey: Joi.string().max(200).optional(),
  overrideReason: Joi.string().max(500).optional(), // Required when x-owner-override header is set
});

/**
 * Validate debit transaction payload
 */
const addDebitSchema = Joi.object({
  customerId: objectIdSchema.required(),
  amount: Joi.number().positive().required(),
  note: Joi.string().max(500).optional().allow(''),
  transactionDate: Joi.date().optional(),
  idempotencyKey: Joi.string().max(200).optional(),
});

module.exports = {
  addCreditSchema,
  addDebitSchema,
};
