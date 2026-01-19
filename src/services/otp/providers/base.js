/**
 * Base OTP Provider Interface
 * All OTP providers must implement this interface
 * 
 * This abstraction allows swapping providers (MSG91, Twilio, etc.) without changing business logic
 */

/**
 * @typedef {Object} OtpSendResult
 * @property {boolean} ok - Whether the OTP was sent successfully
 * @property {string} provider - Provider name (e.g., 'MSG91', 'TWILIO')
 * @property {string} [providerRequestId] - Provider's request/transaction ID for tracking
 * @property {Object} [raw] - Sanitized provider response (no sensitive data)
 * @property {string} [error] - Error message if ok=false
 */

/**
 * @typedef {Object} OtpVerifyResult
 * @property {boolean} ok - Whether the OTP was verified successfully
 * @property {string} provider - Provider name
 * @property {Object} [raw] - Sanitized provider response
 * @property {string} [error] - Error message if ok=false
 */

/**
 * Base OTP Provider class
 * All providers should extend this or implement the same interface
 */
class BaseOtpProvider {
  constructor(config) {
    this.config = config;
    this.providerName = 'BASE';
  }

  /**
   * Send OTP to phone number
   * @param {Object} params
   * @param {string} params.phoneE164 - Phone number in E.164 format (e.g., "+919876543210")
   * @returns {Promise<OtpSendResult>}
   */
  async sendOtp({ phoneE164 }) {
    throw new Error('sendOtp() must be implemented by provider');
  }

  /**
   * Verify OTP for phone number
   * @param {Object} params
   * @param {string} params.phoneE164 - Phone number in E.164 format
   * @param {string} params.otp - OTP code to verify
   * @returns {Promise<OtpVerifyResult>}
   */
  async verifyOtp({ phoneE164, otp }) {
    throw new Error('verifyOtp() must be implemented by provider');
  }

  /**
   * Sanitize provider response (remove sensitive data)
   * @param {Object} response - Raw provider response
   * @returns {Object} - Sanitized response
   */
  sanitizeResponse(response) {
    if (!response) return {};

    // Remove common sensitive fields
    const sanitized = { ...response };
    delete sanitized.authkey;
    delete sanitized.api_key;
    delete sanitized.secret;
    delete sanitized.password;
    delete sanitized.otp; // CRITICAL: Never log OTP

    return sanitized;
  }
}

module.exports = BaseOtpProvider;
