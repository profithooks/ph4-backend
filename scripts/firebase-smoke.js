/**
 * Firebase Plumbing Smoke Test
 * 
 * Proves backend->Firebase auth and FCM connectivity
 * 
 * Usage:
 *   node scripts/firebase-smoke.js
 * 
 * Environment:
 *   FCM_TEST_TOKEN - Optional FCM token for dry-run test (defaults to "INVALID_TOKEN_FOR_TEST")
 */
require('dotenv').config();

// Lazy load firebase-admin to provide better error message if not installed
let admin;
try {
  admin = require('firebase-admin');
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error('❌ firebase-admin is not installed!');
    console.error('   Please run: npm install');
    console.error('   Or: npm install firebase-admin');
    process.exit(1);
  }
  throw error;
}

const {getFirebaseServiceAccount, getFirebaseProjectId, isFirebaseConfigured} = require('../src/config/firebase');
const logger = require('../src/utils/logger');

const TEST_TOKEN = process.env.FCM_TEST_TOKEN || 'INVALID_TOKEN_FOR_TEST';
const IS_INVALID_TOKEN = !process.env.FCM_TEST_TOKEN || TEST_TOKEN.startsWith('INVALID_');

async function smokeTest() {
  console.log('═══════════════════════════════════════');
  console.log('Firebase Plumbing Smoke Test');
  console.log('═══════════════════════════════════════\n');

  try {
    // Step 1: Check if Firebase is configured
    console.log('[1] Checking Firebase configuration...');
    if (!isFirebaseConfigured()) {
      console.error('❌ Firebase is not configured!');
      console.error('   Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH');
      process.exit(1);
    }
    console.log('✅ Firebase is configured\n');

    // Step 2: Initialize Firebase (using same path as production)
    console.log('[2] Initializing Firebase Admin SDK...');
    const {initializeFirebase} = require('../src/services/push/fcmClient');
    initializeFirebase();
    console.log('✅ Firebase Admin SDK initialized\n');

    // Step 3: Get project ID
    console.log('[3] Getting Firebase project ID...');
    let projectId = getFirebaseProjectId();
    
    // Fallback: try to get from initialized app
    if (!projectId) {
      try {
        const app = admin.app();
        projectId = app.options?.projectId || app.options?.credential?.projectId;
      } catch (e) {
        // Ignore
      }
    }
    
    if (!projectId) {
      console.error('❌ Could not determine project ID');
      process.exit(1);
    }
    console.log(`✅ Project ID: ${projectId}\n`);

    // Step 4: Get access token (credential test)
    console.log('[4] Testing credential (getting access token)...');
    try {
      const serviceAccount = getFirebaseServiceAccount();
      const credential = admin.credential.cert(serviceAccount);
      const accessToken = await credential.getAccessToken();
      
      if (accessToken && accessToken.access_token) {
        const tokenPreview = accessToken.access_token.substring(0, 20);
        console.log(`✅ Access token retrieved: ${tokenPreview}...`);
        console.log(`   Token type: ${accessToken.token_type || 'Bearer'}`);
        console.log(`   Expires in: ${accessToken.expires_in || 'N/A'} seconds\n`);
      } else {
        console.log('⚠️  Access token response format unexpected');
        console.log(`   Response keys: ${Object.keys(accessToken || {}).join(', ')}\n`);
      }
    } catch (tokenError) {
      console.error('❌ Failed to get access token:', tokenError.message);
      console.error('   This may indicate credential issues\n');
    }

    // Step 5: Dry-run FCM send
    console.log('[5] Testing FCM connectivity (dry-run send)...');
    console.log(`   Using test token: ${TEST_TOKEN.substring(0, 20)}...`);
    
    let fcmConnectivityVerified = false;
    
    try {
      const message = {
        token: TEST_TOKEN,
        notification: {
          title: 'PH4 Smoke',
          body: 'backend->firebase',
        },
        data: {
          type: 'SMOKE',
        },
      };

      // Use dryRun: true to validate without actually sending
      // Firebase Admin SDK send() signature: send(message, dryRun?: boolean)
      const response = await admin.messaging().send(message, true);
      
      console.log('✅ FCM DRYRUN OK');
      console.log(`   Message ID: ${response}`);
      console.log('   Firebase connectivity verified\n');
      fcmConnectivityVerified = true;
    } catch (sendError) {
      // Classify error
      const errorCode = sendError.code || sendError.errorInfo?.code || 'UNKNOWN';
      const errorMessage = sendError.message || sendError.errorInfo?.message || sendError.toString();
      
      // Expected errors for invalid test token
      const expectedErrors = [
        'messaging/invalid-argument',
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered',
      ];
      
      const isExpectedError = IS_INVALID_TOKEN && expectedErrors.includes(errorCode);
      
      if (isExpectedError) {
        console.log('✅ Expected error for invalid token; plumbing OK');
        console.log(`   Error code: ${errorCode}`);
        console.log(`   Error message: ${errorMessage}`);
        console.log('   ✅ Firebase connectivity verified (invalid token test)\n');
        fcmConnectivityVerified = true;
      } else {
        console.log('⚠️  FCM dry-run result:');
        console.log(`   Error code: ${errorCode}`);
        console.log(`   Error message: ${errorMessage}`);
        
        if (expectedErrors.includes(errorCode)) {
          console.log('   ⚠️  This error suggests the token may be invalid');
          console.log('   ⚠️  If using a real token, verify FCM_TEST_TOKEN is correct\n');
        } else {
          console.log('   ⚠️  Unexpected error - may indicate configuration issue\n');
        }
      }
    }

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('Smoke Test Summary');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Firebase configured: Yes`);
    console.log(`✅ Project ID: ${projectId}`);
    console.log(`✅ Admin SDK initialized: Yes`);
    if (fcmConnectivityVerified) {
      console.log(`✅ FCM connectivity: Verified`);
    } else {
      console.log(`⚠️  FCM connectivity: Not verified (unexpected error)`);
    }
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Smoke test failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run smoke test
smokeTest()
  .then(() => {
    console.log('✅ Smoke test completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Smoke test error:', error);
    process.exit(1);
  });
