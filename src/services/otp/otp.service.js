/**
 * OTP Service
 * Provider-agnostic OTP operations
 * Chooses provider based on OTP_PROVIDER env variable
 */
const MSG91Provider = require('./providers/msg91');

// Supported providers
const PROVIDERS = {
  MSG91: MSG91Provider,
  // Add more providers here:
  // TWILIO: TwilioProvider,
  // AWS_SNS: AwsSnsProvider,
};

/**
 * Get OTP provider instance
 * @returns {BaseOtpProvider}
 */
const getProvider = () => {
  const providerName = process.env.OTP_PROVIDER || 'MSG91';

  const ProviderClass = PROVIDERS[providerName];
  if (!ProviderClass) {
    throw new Error(
      `Invalid OTP_PROVIDER: ${providerName}. Supported: ${Object.keys(
        PROVIDERS
      ).join(', ')}`
    );
  }

  // Create provider instance with config
  return new ProviderClass({
    authKey: process.env.MSG91_AUTHKEY,
    senderId: process.env.MSG91_SENDER_ID,
    templateId: process.env.MSG91_TEMPLATE_ID,
  });
};

// Lazy-load provider
let providerInstance = null;
const getProviderInstance = () => {
  if (!providerInstance) {
    providerInstance = getProvider();
  }
  return providerInstance;
};

/**
 * Send OTP to phone number
 * @param {Object} params
 * @param {string} params.phoneE164 - E.164 phone number
 * @returns {Promise<OtpSendResult>}
 */
const sendOtp = async ({ phoneE164 }) => {
  const provider = getProviderInstance();
  return await provider.sendOtp({ phoneE164 });
};

/**
 * Verify OTP for phone number
 * @param {Object} params
 * @param {string} params.phoneE164 - E.164 phone number
 * @param {string} params.otp - OTP code
 * @returns {Promise<OtpVerifyResult>}
 */
const verifyOtp = async ({ phoneE164, otp }) => {
  const provider = getProviderInstance();
  return await provider.verifyOtp({ phoneE164, otp });
};

module.exports = {
  sendOtp,
  verifyOtp,
  getProvider,
};
