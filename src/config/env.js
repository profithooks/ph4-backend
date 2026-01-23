/**
 * Environment configuration
 */
require('dotenv').config();

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Validate JWT secret strength
 * Must be at least 32 characters for production security
 */
const validateJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  
  if (!secret) {
    throw new Error(
      'FATAL: JWT_SECRET is not set. Please set a strong secret (>=32 chars) in your .env file.\n' +
      'Example: JWT_SECRET=your-super-secret-key-min-32-chars-long-random-string'
    );
  }

  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `FATAL: JWT_SECRET is too weak (${secret.length} chars). ` +
      `Must be at least ${MIN_JWT_SECRET_LENGTH} characters.\n` +
      'Generate a strong secret: openssl rand -base64 32'
    );
  }

  return secret;
};

/**
 * Get public app base URL (web frontend domain)
 * Used for share link URLs that point to web viewer
 */
const getPublicAppBaseUrl = () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // If explicitly set, use it
  if (process.env.PUBLIC_APP_BASE_URL) {
    return process.env.PUBLIC_APP_BASE_URL;
  }
  
  // Dev default: web dev server (Vite default port 5173)
  if (nodeEnv !== 'production') {
    return 'http://localhost:5173';
  }
  
  // Production: must be set
  return null; // Will throw error if used in production
};

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/ph4',
  jwtSecret: validateJwtSecret(),
  jwtExpire: process.env.JWT_EXPIRE || '7d', // Changed from 30d to 7d for security
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  publicBillBaseUrl: process.env.PUBLIC_BILL_BASE_URL || null, // Deprecated: kept for backward compatibility
  publicAppBaseUrl: getPublicAppBaseUrl(), // Web frontend base URL for share links
};
