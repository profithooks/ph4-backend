/**
 * Phone number utilities for E.164 normalization
 * E.164 format: +[country code][subscriber number]
 * Examples: +14155552671, +919876543210
 */

/**
 * Normalize phone number to E.164 format
 * @param {Object} params
 * @param {string} params.countryCode - Country code with + (e.g., "+91")
 * @param {string} params.phone - Phone number (digits, spaces, hyphens allowed)
 * @returns {string} - E.164 formatted phone number
 * @throws {Error} - If invalid input
 */
const normalizeE164 = ({ countryCode, phone }) => {
  if (!countryCode || !phone) {
    throw new Error('countryCode and phone are required');
  }

  // Validate country code starts with +
  if (!countryCode.startsWith('+')) {
    throw new Error('countryCode must start with +');
  }

  // Extract only digits from country code
  const countryDigits = countryCode.slice(1).replace(/\D/g, '');
  if (!countryDigits || !/^[1-9]\d{0,3}$/.test(countryDigits)) {
    throw new Error('Invalid country code format');
  }

  // Strip all non-digit characters from phone
  const phoneDigits = phone.replace(/\D/g, '');
  if (!phoneDigits || phoneDigits.length < 7 || phoneDigits.length > 15) {
    throw new Error('Phone number must be 7-15 digits');
  }

  // Return E.164 format
  return `+${countryDigits}${phoneDigits}`;
};

/**
 * Validate if string is valid E.164 format
 * @param {string} phoneE164 - Phone number to validate
 * @returns {boolean}
 */
const isValidE164 = (phoneE164) => {
  if (!phoneE164 || typeof phoneE164 !== 'string') {
    return false;
  }

  // E.164: +[1-9][0-9]{7,14}
  // Total: 9-16 characters including +
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  return e164Regex.test(phoneE164);
};

/**
 * Mask phone number for logging (security)
 * @param {string} phoneE164 - E.164 phone number
 * @returns {string} - Masked phone (e.g., "+91******3210")
 */
const maskPhone = (phoneE164) => {
  if (!phoneE164 || !isValidE164(phoneE164)) {
    return '***INVALID***';
  }

  // Keep + and country code, mask middle, keep last 4
  const length = phoneE164.length;
  if (length <= 8) {
    // Very short number, mask most of it
    return phoneE164.slice(0, 3) + '***' + phoneE164.slice(-2);
  }

  // Standard masking: +CC******LAST4
  const countryCode = phoneE164.slice(0, 3); // +XX or +XXX
  const lastFour = phoneE164.slice(-4);
  const maskLength = length - countryCode.length - 4;
  const mask = '*'.repeat(Math.max(maskLength, 4));

  return `${countryCode}${mask}${lastFour}`;
};

/**
 * Extract country code from E.164 number
 * @param {string} phoneE164
 * @returns {string} - Country code with + (e.g., "+91")
 */
const extractCountryCode = (phoneE164) => {
  if (!isValidE164(phoneE164)) {
    throw new Error('Invalid E.164 phone number');
  }

  // Common country code lengths: 1-3 digits
  // Try to match known patterns (simplified)
  const match = phoneE164.match(/^\+(\d{1,3})/);
  return match ? `+${match[1]}` : '+1'; // Default to +1 if can't determine
};

/**
 * Format E.164 for MSG91 (remove + prefix)
 * MSG91 expects: countrycode+number without +
 * @param {string} phoneE164
 * @returns {string} - Phone without + (e.g., "919876543210")
 */
const formatForMSG91 = (phoneE164) => {
  if (!isValidE164(phoneE164)) {
    throw new Error('Invalid E.164 phone number');
  }

  return phoneE164.slice(1); // Remove leading +
};

module.exports = {
  normalizeE164,
  isValidE164,
  maskPhone,
  extractCountryCode,
  formatForMSG91,
};
