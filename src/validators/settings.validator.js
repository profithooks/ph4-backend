/**
 * Settings route validation schemas
 */
const Joi = require('joi');

/**
 * Validate settings update payload
 */
const updateSettingsSchema = Joi.object({
  // Ledger settings
  ledgerEnabled: Joi.boolean(),
  
  // Auto follow-up settings
  autoFollowupEnabled: Joi.boolean(),
  autoFollowupDays: Joi.number().integer().min(1).max(365),
  
  // Recovery settings
  recoveryEnabled: Joi.boolean(),
  recoveryThreshold: Joi.number().min(0),
  
  // Notification settings
  notificationsEnabled: Joi.boolean(),
  emailNotifications: Joi.boolean(),
  smsNotifications: Joi.boolean(),
  
  // Business settings
  businessName: Joi.string().max(200),
  businessPhone: Joi.string().max(15),
  businessEmail: Joi.string().email().max(100),
  businessAddress: Joi.string().max(500),
  
  // Other settings (flexible)
}).min(1); // At least one setting must be provided

module.exports = {
  updateSettingsSchema,
};
