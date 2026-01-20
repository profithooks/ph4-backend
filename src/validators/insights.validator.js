/**
 * Insights Validators
 * 
 * Step 12: Production Readiness
 */
const Joi = require('joi');
const {dateSchema, paginationSchema} = require('../middleware/validation.middleware');

const getAgingBucketsSchema = {
  query: Joi.object({
    date: dateSchema.default(() => new Date(), 'current date'),
    ...paginationSchema,
  }),
};

const getCashInForecastSchema = {
  query: Joi.object({
    date: dateSchema.default(() => new Date(), 'current date'),
    horizon: Joi.number().integer().valid(7, 30).default(7),
  }),
};

const getDefaultersSchema = {
  query: Joi.object({
    date: dateSchema.default(() => new Date(), 'current date'),
    ...paginationSchema,
  }),
};

const getBusinessInterestSchema = {
  query: Joi.object({
    date: dateSchema.default(() => new Date(), 'current date'),
    ...paginationSchema,
  }),
};

const getFinancialYearSummarySchema = {
  query: Joi.object({
    fyStart: dateSchema.optional(),
    fyEnd: dateSchema.optional(),
  }),
};

module.exports = {
  getAgingBucketsSchema,
  getCashInForecastSchema,
  getDefaultersSchema,
  getBusinessInterestSchema,
  getFinancialYearSummarySchema,
};
