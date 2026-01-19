/**
 * Bill route validation schemas
 */
const Joi = require('joi');

/**
 * Validate ObjectId string format
 */
const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * Validate bill creation payload
 */
const createBillSchema = Joi.object({
  customerId: objectIdSchema.required(),
  items: Joi.array()
    .min(1)
    .items(
      Joi.object({
        itemId: objectIdSchema.optional(),
        name: Joi.string().trim().min(1).max(200).required(),
        qty: Joi.number().positive().required(),
        price: Joi.number().min(0).required(),
        total: Joi.number().min(0).required(),
      })
    )
    .required(),
  subTotal: Joi.number().min(0).required(),
  discount: Joi.number().min(0).default(0),
  tax: Joi.number().min(0).default(0),
  grandTotal: Joi.number().min(0).required(),
  paidAmount: Joi.number().min(0).default(0),
  dueDate: Joi.date().optional(),
  notes: Joi.string().max(1000).optional().allow(''),
  idempotencyKey: Joi.string().max(200).optional(),
});

/**
 * Validate bill payment payload
 */
const addPaymentSchema = Joi.object({
  amount: Joi.number().positive().required(),
  paymentDate: Joi.date().optional(),
  notes: Joi.string().max(500).optional().allow(''),
});

/**
 * Validate bill cancellation payload
 */
const cancelBillSchema = Joi.object({
  reason: Joi.string().max(500).optional().allow(''),
});

module.exports = {
  createBillSchema,
  addPaymentSchema,
  cancelBillSchema,
};
