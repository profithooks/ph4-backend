/**
 * Firebase Configuration Helper
 * 
 * Provides safe, optional Firebase configuration support
 * Does NOT throw at import time; only validates when actually used
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

let _serviceAccount = null;
let _isInitialized = false;

/**
 * Check if Firebase is configured
 * Returns true if either FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH is set
 * 
 * @returns {boolean}
 */
function isFirebaseConfigured() {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

/**
 * Get Firebase service account object
 * 
 * Supports two methods:
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON: Stringified JSON in env var
 * 2. FIREBASE_SERVICE_ACCOUNT_PATH: Path to JSON file
 * 
 * @returns {Object|null} Service account object or null if not configured
 * @throws {Error} If configured but invalid
 */
function getFirebaseServiceAccount() {
  // Return cached if already loaded
  if (_isInitialized) {
    return _serviceAccount;
  }

  if (!isFirebaseConfigured()) {
    return null;
  }

  try {
    let serviceAccountJson;

    // Method 1: JSON string in env var
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        serviceAccountJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      } catch (parseError) {
        throw new Error(
          'FIREBASE_SERVICE_ACCOUNT_JSON is set but contains invalid JSON. ' +
          `Parse error: ${parseError.message}`
        );
      }
    }
    // Method 2: Path to JSON file
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const filePath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      
      if (!fs.existsSync(filePath)) {
        throw new Error(
          `FIREBASE_SERVICE_ACCOUNT_PATH points to non-existent file: ${filePath}`
        );
      }

      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        serviceAccountJson = JSON.parse(fileContent);
      } catch (readError) {
        throw new Error(
          `Failed to read/parse Firebase service account file at ${filePath}. ` +
          `Error: ${readError.message}`
        );
      }
    }

    // Validate required fields
    if (!serviceAccountJson) {
      throw new Error('Firebase service account JSON is empty');
    }

    const requiredFields = ['project_id', 'private_key', 'client_email'];
    const missingFields = requiredFields.filter(field => !serviceAccountJson[field]);

    if (missingFields.length > 0) {
      throw new Error(
        `Firebase service account JSON is missing required fields: ${missingFields.join(', ')}`
      );
    }

    // Cache the result
    _serviceAccount = serviceAccountJson;
    _isInitialized = true;

    logger.info('[FirebaseConfig] Firebase service account loaded successfully', {
      projectId: serviceAccountJson.project_id,
      clientEmail: serviceAccountJson.client_email,
      source: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'env_var' : 'file_path',
    });

    return _serviceAccount;
  } catch (error) {
    logger.error('[FirebaseConfig] Failed to load Firebase service account', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get Firebase project ID
 * 
 * @returns {string|null} Project ID or null if not configured
 */
function getFirebaseProjectId() {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }

  const serviceAccount = getFirebaseServiceAccount();
  if (serviceAccount && serviceAccount.project_id) {
    return serviceAccount.project_id;
  }

  return null;
}

module.exports = {
  isFirebaseConfigured,
  getFirebaseServiceAccount,
  getFirebaseProjectId,
};
