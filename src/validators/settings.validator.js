/**
 * Settings Validators
 * 
 * Step 12: Production Readiness
 */
const Joi = require('joi');

const updateInterestPolicySchema = {
  body: Joi.object({
    interestEnabled: Joi.boolean(),
    interestRatePctPerMonth: Joi.number().min(0).max(10),
    interestGraceDays: Joi.number().integer().min(0).max(90),
    interestCapPctOfPrincipal: Joi.number().min(0).max(500),
    financialYearStartMonth: Joi.number().integer().min(1).max(12),
  }).min(1), // At least one field required
};

const updateBusinessSettingsSchema = {
  body: Joi.object({
    businessName: Joi.string().max(200),
    ownerName: Joi.string().max(100),
    phone: Joi.string().regex(/^[0-9]{10,15}$/),
    email: Joi.string().email(),
    address: Joi.string().max(500),
    gstNumber: Joi.string().max(50),
    // Step 9: Recovery settings
    recoveryEnabled: Joi.boolean(),
    recoveryPinHash: Joi.string(),
    // Step 6: Auto followup settings
    autoFollowupEnabled: Joi.boolean(),
    followupCadence: Joi.string().valid('DAILY', 'WEEKLY', 'CUSTOM'),
    followupDaysAfterBillCreate: Joi.number().integer().min(0).max(365),
    followupDaysAfterReminder: Joi.number().integer().min(0).max(365),
    escalationDays: Joi.number().integer().min(0),
    gracePeriodDays: Joi.number().integer().min(0),
    // Channel settings
    whatsappEnabled: Joi.boolean(),
    smsEnabled: Joi.boolean(),
    channelsEnabled: Joi.object({
      whatsapp: Joi.boolean(),
      sms: Joi.boolean(),
    }),
    // Ledger settings
    ledgerEnabled: Joi.boolean(),
  }).min(1),
};

// Alias for backward compatibility
const updateSettingsSchema = updateBusinessSettingsSchema;

module.exports = {
  updateInterestPolicySchema,
  updateBusinessSettingsSchema,
  updateSettingsSchema, // Export the alias
};
