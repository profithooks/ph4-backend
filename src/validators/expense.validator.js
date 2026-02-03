const Joi = require('joi');

const baseExpenseSchema = {
  clientId: Joi.string().trim().required(),
  amount: Joi.number().positive().required(),
  category: Joi.string().trim().max(100).default('General'),
  spentAt: Joi.date().iso().required(),
  note: Joi.string().max(1000).allow('', null),
  paymentMode: Joi.string().valid('cash', 'upi', 'card', 'bank', 'other', null).allow(null),
  vendor: Joi.string().max(200).allow('', null),
  tags: Joi.array().items(Joi.string().trim().max(50)).default([]),
};

const createExpenseSchema = Joi.object(baseExpenseSchema);

const updateExpenseSchema = Joi.object({
  amount: Joi.number().positive(),
  category: Joi.string().trim().max(100),
  spentAt: Joi.date().iso(),
  note: Joi.string().max(1000).allow('', null),
  paymentMode: Joi.string().valid('cash', 'upi', 'card', 'bank', 'other', null).allow(null),
  vendor: Joi.string().max(200).allow('', null),
  tags: Joi.array().items(Joi.string().trim().max(50)),
}).min(1);

module.exports = {
  createExpenseSchema,
  updateExpenseSchema,
};
