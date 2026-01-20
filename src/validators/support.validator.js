/**
 * Support Validators
 * 
 * Step 12: Production Readiness
 */
const Joi = require('joi');
const {objectIdSchema, paginationSchema} = require('../middleware/validation.middleware');

const createTicketSchema = {
  body: Joi.object({
    subject: Joi.string().min(5).max(200).required(),
    message: Joi.string().min(10).max(5000).required(),
    category: Joi.string()
      .valid('BILLING', 'RECOVERY', 'SYNC', 'BUG', 'FEATURE', 'ACCOUNT', 'OTHER')
      .default('OTHER'),
    priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').default('MEDIUM'),
  }),
};

const listTicketsSchema = {
  query: Joi.object({
    status: Joi.string().valid('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'),
    category: Joi.string().valid('BILLING', 'RECOVERY', 'SYNC', 'BUG', 'FEATURE', 'ACCOUNT', 'OTHER'),
    ...paginationSchema,
  }),
};

const getTicketSchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),
};

const addMessageSchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),
  body: Joi.object({
    message: Joi.string().min(1).max(5000).required(),
    isInternal: Joi.boolean().default(false),
  }),
};

const updateTicketStatusSchema = {
  params: Joi.object({
    id: objectIdSchema.required(),
  }),
  body: Joi.object({
    status: Joi.string()
      .valid('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED')
      .required(),
    internalNote: Joi.string().max(1000).optional(),
  }),
};

module.exports = {
  createTicketSchema,
  listTicketsSchema,
  getTicketSchema,
  addMessageSchema,
  updateTicketStatusSchema,
};
