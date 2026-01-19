/**
 * MSG91 OTP Provider Implementation
 * Docs: https://docs.msg91.com/p/tf9GTextN/e/J1WkH1ggV/MSG91
 */
const axios = require('axios');
const BaseOtpProvider = require('./base');
const { formatForMSG91 } = require('../../../utils/phone');

class MSG91Provider extends BaseOtpProvider {
  constructor(config) {
    super(config);
    this.providerName = 'MSG91';
    this.authKey = config.authKey || process.env.MSG91_AUTHKEY;
    this.senderId = config.senderId || process.env.MSG91_SENDER_ID || '';
    this.templateId = config.templateId || process.env.MSG91_TEMPLATE_ID || '';
    
    if (!this.authKey) {
      throw new Error('MSG91_AUTHKEY is required');
    }

    // MSG91 API endpoints
    this.baseUrl = 'https://control.msg91.com/api/v5';
  }

  /**
   * Send OTP via MSG91
   * @param {Object} params
   * @param {string} params.phoneE164 - E.164 phone number
   * @returns {Promise<OtpSendResult>}
   */
  async sendOtp({ phoneE164 }) {
    try {
      // Convert E.164 to MSG91 format (remove +)
      const mobileNumber = formatForMSG91(phoneE164);

      console.log(`[MSG91] Sending OTP to ${phoneE164.slice(0, 6)}***`);

      // MSG91 OTP Send API
      // Using query params as per MSG91 v5 API
      const url = `${this.baseUrl}/otp`;
      const params = {
        authkey: this.authKey,
        mobile: mobileNumber,
      };

      // Add optional params
      if (this.templateId) {
        params.template_id = this.templateId;
      }
      if (this.senderId) {
        params.sender = this.senderId;
      }

      const response = await axios.get(url, {
        params,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = response.data;

      // MSG91 success response structure
      // Success: { type: "success", message: "..." }
      const isSuccess =
        data.type === 'success' || 
        data.message?.toLowerCase().includes('success') ||
        response.status === 200;

      if (isSuccess) {
        console.log(`[MSG91] OTP sent successfully to ${phoneE164.slice(0, 6)}***`);
        return {
          ok: true,
          provider: this.providerName,
          providerRequestId: data.request_id || data.requestId || 'unknown',
          raw: this.sanitizeResponse(data),
        };
      } else {
        console.warn(`[MSG91] OTP send failed:`, data.message || data);
        return {
          ok: false,
          provider: this.providerName,
          error: data.message || 'MSG91 send failed',
          raw: this.sanitizeResponse(data),
        };
      }
    } catch (error) {
      console.error(`[MSG91] OTP send error:`, error.message);
      
      // Extract error message from response if available
      const errorMsg = error.response?.data?.message || error.message;

      return {
        ok: false,
        provider: this.providerName,
        error: errorMsg,
        raw: error.response?.data
          ? this.sanitizeResponse(error.response.data)
          : { error: error.message },
      };
    }
  }

  /**
   * Verify OTP via MSG91
   * @param {Object} params
   * @param {string} params.phoneE164 - E.164 phone number
   * @param {string} params.otp - OTP code
   * @returns {Promise<OtpVerifyResult>}
   */
  async verifyOtp({ phoneE164, otp }) {
    try {
      // Convert E.164 to MSG91 format
      const mobileNumber = formatForMSG91(phoneE164);

      console.log(`[MSG91] Verifying OTP for ${phoneE164.slice(0, 6)}***`);

      // MSG91 OTP Verify API
      const url = `${this.baseUrl}/otp/verify`;
      const params = {
        authkey: this.authKey,
        mobile: mobileNumber,
        otp: otp,
      };

      const response = await axios.get(url, {
        params,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = response.data;

      // MSG91 verify response
      // Success: { type: "success", message: "OTP verified success" }
      // Failure: { type: "error", message: "..." }
      const isSuccess =
        data.type === 'success' ||
        data.message?.toLowerCase().includes('verified') ||
        response.status === 200;

      if (isSuccess) {
        console.log(`[MSG91] OTP verified successfully for ${phoneE164.slice(0, 6)}***`);
        return {
          ok: true,
          provider: this.providerName,
          raw: this.sanitizeResponse(data),
        };
      } else {
        console.warn(`[MSG91] OTP verification failed:`, data.message || 'Invalid OTP');
        return {
          ok: false,
          provider: this.providerName,
          error: data.message || 'Invalid OTP',
          raw: this.sanitizeResponse(data),
        };
      }
    } catch (error) {
      console.error(`[MSG91] OTP verify error:`, error.message);

      // Check if it's an invalid OTP error
      const errorMsg = error.response?.data?.message || error.message;
      const isInvalidOtp =
        errorMsg?.toLowerCase().includes('invalid') ||
        errorMsg?.toLowerCase().includes('incorrect') ||
        error.response?.status === 401;

      return {
        ok: false,
        provider: this.providerName,
        error: isInvalidOtp ? 'Invalid OTP' : errorMsg,
        raw: error.response?.data
          ? this.sanitizeResponse(error.response.data)
          : { error: error.message },
      };
    }
  }
}

module.exports = MSG91Provider;
