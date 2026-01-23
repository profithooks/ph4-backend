/**
 * Firebase Cloud Messaging (FCM) Client
 * 
 * Wrapper around firebase-admin messaging API
 * Handles token management, error classification, and result normalization
 */
const admin = require('firebase-admin');
const {getFirebaseServiceAccount} = require('../../config/firebase');
const logger = require('../../utils/logger');

let _isInitialized = false;

/**
 * Initialize Firebase Admin SDK (singleton)
 * Only initializes once, even if called multiple times
 */
function initializeFirebase() {
  if (_isInitialized) {
    return;
  }

  const serviceAccount = getFirebaseServiceAccount();
  
  if (!serviceAccount) {
    throw new Error(
      'Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH'
    );
  }

  try {
    // Initialize with service account credential
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    _isInitialized = true;
    logger.info('[FCMClient] Firebase Admin SDK initialized successfully', {
      projectId: serviceAccount.project_id,
    });
  } catch (error) {
    logger.error('[FCMClient] Failed to initialize Firebase Admin SDK', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Convert any value to string safely for FCM data payload
 * FCM requires all data values to be strings
 * 
 * @param {*} value - Any value
 * @returns {string} String representation
 */
function stringifyDataValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  
  if (typeof value === 'string') {
    return value;
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  
  return String(value);
}

/**
 * Classify FCM error code
 * 
 * @param {string} errorCode - FCM error code
 * @returns {Object} { isInvalidToken, shouldRemoveToken, isRetryable }
 */
function classifyError(errorCode) {
  // Token errors that mean token should be removed
  const invalidTokenCodes = [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/mismatched-credential',
  ];

  // Errors that are retryable (temporary failures)
  const retryableCodes = [
    'messaging/unavailable',
    'messaging/internal-error',
  ];

  const isInvalidToken = invalidTokenCodes.includes(errorCode);
  const isRetryable = retryableCodes.includes(errorCode);

  return {
    isInvalidToken,
    shouldRemoveToken: isInvalidToken,
    isRetryable: isRetryable && !isInvalidToken,
  };
}

/**
 * Send FCM messages to multiple tokens
 * 
 * @param {Object} params
 * @param {Array<string>} params.tokens - Array of FCM registration tokens
 * @param {string} params.title - Notification title
 * @param {string} params.body - Notification body
 * @param {Object} params.data - Data payload (will be stringified)
 * @returns {Promise<Object>} Normalized result
 */
async function sendToTokens({tokens, title, body, data = {}}) {
  if (!_isInitialized) {
    initializeFirebase();
  }

  if (!tokens || tokens.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
      responses: [],
    };
  }

  // Stringify all data values (FCM requirement)
  const stringifiedData = {};
  for (const [key, value] of Object.entries(data)) {
    stringifiedData[key] = stringifyDataValue(value);
  }

  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: stringifiedData,
      // Android-specific options
      android: {
        priority: 'high',
      },
      // APNs-specific options
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const multicastMessage = {
      tokens,
      ...message,
    };

    const response = await admin.messaging().sendEachForMulticast(multicastMessage);

    // Normalize responses
    const responses = [];
    let successCount = 0;
    let failureCount = 0;

    response.responses.forEach((resp, idx) => {
      const token = tokens[idx];
      const isSuccess = resp.success;

      if (isSuccess) {
        successCount++;
        responses.push({
          token,
          success: true,
          messageId: resp.messageId,
        });
      } else {
        failureCount++;
        const error = resp.error;
        const errorCode = error?.code || 'unknown';
        const errorMessage = error?.message || 'Unknown error';

        const classification = classifyError(errorCode);

        responses.push({
          token,
          success: false,
          errorCode,
          errorMessage,
          ...classification,
        });

        logger.warn('[FCMClient] Failed to send to token', {
          token: token.substring(0, 20) + '...', // Log partial token for debugging
          errorCode,
          errorMessage,
          shouldRemoveToken: classification.shouldRemoveToken,
        });
      }
    });

    logger.info('[FCMClient] Send completed', {
      totalTokens: tokens.length,
      successCount,
      failureCount,
    });

    return {
      successCount,
      failureCount,
      responses,
    };
  } catch (error) {
    logger.error('[FCMClient] Fatal error sending FCM messages', {
      error: error.message,
      tokenCount: tokens.length,
    });

    // Return all as failures
    return {
      successCount: 0,
      failureCount: tokens.length,
      responses: tokens.map(token => ({
        token,
        success: false,
        errorCode: 'fatal_error',
        errorMessage: error.message,
        isInvalidToken: false,
        shouldRemoveToken: false,
        isRetryable: true,
      })),
    };
  }
}

module.exports = {
  sendToTokens,
  initializeFirebase,
};
