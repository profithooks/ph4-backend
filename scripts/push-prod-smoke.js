/**
 * Production Push Smoke Test
 * 
 * Validates Firebase connectivity and sends test push notification to production data
 * 
 * Usage:
 *   MONGODB_URI="..." FIREBASE_SERVICE_ACCOUNT_PATH="..." PROJECT_ID="..." FCM_TOKEN="..." node scripts/push-prod-smoke.js
 * 
 * Optional:
 *   EXPECT_APS_ENV="development" or "production" (for logging only)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const admin = require('firebase-admin');

// ============================================================================
// STEP 0: Auto-detect values from codebase
// ============================================================================
// Auto-detect Firebase service account path
const DEFAULT_FIREBASE_SERVICE_ACCOUNT_PATH = '.secrets/ph4-firebase-admin.json';
const DEFAULT_PROJECT_ID = 'profithooks-dea90';

// Try to read MongoDB URI from multiple sources (production)
let defaultMongoUri = null;
// Priority: 1) MONGODB_URI env var, 2) MONGO_URI env var, 3) from config/env.js
if (process.env.MONGODB_URI) {
  defaultMongoUri = process.env.MONGODB_URI;
} else if (process.env.MONGO_URI) {
  defaultMongoUri = process.env.MONGO_URI;
} else {
  try {
    const {mongoUri} = require('../src/config/env');
    defaultMongoUri = mongoUri;
  } catch (e) {
    defaultMongoUri = null;
  }
}

// ============================================================================
// STEP 0: Banner and Environment Display
// ============================================================================
console.log('═══════════════════════════════════════════════════════════════');
console.log('Production Push Smoke Test');
console.log('═══════════════════════════════════════════════════════════════\n');

// Read environment variables with auto-fill defaults
const MONGODB_URI = process.env.MONGODB_URI || defaultMongoUri;
const FIREBASE_SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || DEFAULT_FIREBASE_SERVICE_ACCOUNT_PATH;
const PROJECT_ID = process.env.PROJECT_ID || DEFAULT_PROJECT_ID;
const FCM_TOKEN = process.env.FCM_TOKEN || 'dW_VE86In08JuKaF0xkiDQ:APA91bEJyk1A_-GhA0EMDqWZufr7vA3Trec3J8BUZiGIteFzyFzJkNMnxRKsHrxmli2F5yvnJYKERxBfNR9uUuEpkXcAgeYQSq7orK2d5H_HPxk-54iDPGA';
const EXPECT_APS_ENV = process.env.EXPECT_APS_ENV || 'production'; // Default to production

// Try to auto-detect PROJECT_ID from Firebase service account file if not set
if (!process.env.PROJECT_ID && FIREBASE_SERVICE_ACCOUNT_PATH) {
  try {
    const serviceAccountPath = path.resolve(FIREBASE_SERVICE_ACCOUNT_PATH);
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccountJson = fs.readFileSync(serviceAccountPath, 'utf8');
      const serviceAccount = JSON.parse(serviceAccountJson);
      if (serviceAccount.project_id) {
        // PROJECT_ID will use the default, but we can log it
        console.log(`[Auto-detect] Found PROJECT_ID in service account: ${serviceAccount.project_id}`);
      }
    }
  } catch (e) {
    // Ignore - will be caught later
  }
}

// Display environment (mask secrets, show auto-filled values)
console.log('[Env] Environment Variables (auto-filled from codebase if not set):');
if (MONGODB_URI) {
  const mongoMasked = MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  const mongoMatch = MONGODB_URI.match(/mongodb:\/\/[^\/]+\/([^?]+)/);
  const dbName = mongoMatch ? mongoMatch[1] : 'unknown';
  const hostMatch = MONGODB_URI.match(/mongodb:\/\/([^\/]+)\//);
  const host = hostMatch ? hostMatch[1].replace(/:[^@]+@/, ':***@') : 'unknown';
  const source = process.env.MONGODB_URI ? '(env var)' : '(auto-filled from config)';
  console.log(`  MONGODB_URI: ${host} (db: ${dbName}) ${source}`);
} else {
  console.log('  MONGODB_URI: ❌ NOT SET (required)');
}
const firebaseSource = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? '(env var)' : '(auto-filled default)';
console.log(`  FIREBASE_SERVICE_ACCOUNT_PATH: ${FIREBASE_SERVICE_ACCOUNT_PATH || '❌ NOT SET'} ${firebaseSource}`);
const projectSource = process.env.PROJECT_ID ? '(env var)' : '(auto-filled default)';
console.log(`  PROJECT_ID: ${PROJECT_ID || '❌ NOT SET'} ${projectSource}`);
if (FCM_TOKEN) {
  const tokenSource = process.env.FCM_TOKEN ? '(env var)' : '(auto-filled default)';
  console.log(`  FCM_TOKEN: ${FCM_TOKEN.substring(0, 12)}... (${FCM_TOKEN.length} chars) ${tokenSource}`);
} else {
  console.log('  FCM_TOKEN: ❌ NOT SET (required)');
}
if (EXPECT_APS_ENV) {
  const apsSource = process.env.EXPECT_APS_ENV ? '(env var)' : '(auto-filled default: production)';
  console.log(`  EXPECT_APS_ENV: ${EXPECT_APS_ENV} ${apsSource}`);
}
console.log('');

// ============================================================================
// STEP 1: Validate Required Environment Variables
// ============================================================================
console.log('[Step 1] Validating required environment variables...');
const missing = [];
if (!MONGODB_URI) missing.push('MONGODB_URI');
if (!FIREBASE_SERVICE_ACCOUNT_PATH) missing.push('FIREBASE_SERVICE_ACCOUNT_PATH');
if (!PROJECT_ID) missing.push('PROJECT_ID');
if (!FCM_TOKEN) missing.push('FCM_TOKEN');

if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('\nExample usage:');
  console.error('  MONGODB_URI="mongodb://..." \\');
  console.error('  FIREBASE_SERVICE_ACCOUNT_PATH=".secrets/ph4-firebase-admin.json" \\');
  console.error('  PROJECT_ID="profithooks-dea90" \\');
  console.error('  FCM_TOKEN="..." \\');
  console.error('  node scripts/push-prod-smoke.js');
  process.exit(1);
}
console.log('✅ All required environment variables present\n');

// ============================================================================
// Main async function
// ============================================================================
async function main() {
// ============================================================================
// STEP 2: Load and Validate Firebase Service Account
// ============================================================================
console.log('[Step 2] Loading Firebase service account...');
let serviceAccount;
try {
  const serviceAccountPath = path.resolve(FIREBASE_SERVICE_ACCOUNT_PATH);
  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`❌ Service account file not found: ${serviceAccountPath}`);
    process.exit(1);
  }
  const serviceAccountJson = fs.readFileSync(serviceAccountPath, 'utf8');
  serviceAccount = JSON.parse(serviceAccountJson);
  console.log(`✅ Service account loaded from: ${serviceAccountPath}`);
  console.log(`   Project ID: ${serviceAccount.project_id || 'N/A'}`);
  console.log(`   Client Email: ${serviceAccount.client_email || 'N/A'}`);
} catch (error) {
  console.error(`❌ Failed to load service account: ${error.message}`);
  process.exit(1);
}
console.log('');

// ============================================================================
// STEP 3: Initialize Firebase Admin SDK
// ============================================================================
console.log('[Step 3] Initializing Firebase Admin SDK...');
try {
  // Clear any existing apps
  if (admin.apps.length > 0) {
    admin.apps.forEach(app => admin.app().delete());
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: PROJECT_ID,
  });
  console.log(`✅ Firebase Admin SDK initialized`);
  console.log(`   Project ID: ${PROJECT_ID}`);
} catch (error) {
  console.error(`❌ Failed to initialize Firebase: ${error.message}`);
  process.exit(1);
}
console.log('');

// ============================================================================
// STEP 4: Get and Validate Access Token
// ============================================================================
console.log('[Step 4] Getting and validating access token...');
let accessToken;
try {
  const credential = admin.credential.cert(serviceAccount);
  const tokenResponse = await credential.getAccessToken();
  accessToken = tokenResponse.access_token;
  console.log(`✅ Access token retrieved`);
  console.log(`   Token length: ${accessToken.length} characters`);
  console.log(`   Token type: ${tokenResponse.token_type || 'Bearer'}`);
  if (tokenResponse.expires_in) {
    console.log(`   Expires in: ${tokenResponse.expires_in} seconds`);
  }
} catch (error) {
  console.error(`❌ Failed to get access token: ${error.message}`);
  process.exit(1);
}

// Validate token via tokeninfo endpoint
console.log('\n[Step 4.1] Validating access token via tokeninfo...');
try {
  const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`;
  const tokenInfoResponse = await fetch(tokenInfoUrl);
  
  if (!tokenInfoResponse.ok) {
    console.error(`❌ Tokeninfo request failed: ${tokenInfoResponse.status} ${tokenInfoResponse.statusText}`);
    process.exit(1);
  }
  
  const tokenInfo = await tokenInfoResponse.json();
  console.log('✅ Tokeninfo response:');
  console.log(`   Scope: ${tokenInfo.scope || 'N/A'}`);
  console.log(`   Exp: ${tokenInfo.exp || 'N/A'}`);
  console.log(`   Expires in: ${tokenInfo.expires_in || 'N/A'} seconds`);
  console.log(`   Aud: ${tokenInfo.aud || 'N/A'}`);
  
  // Check for firebase.messaging scope
  if (!tokenInfo.scope || !tokenInfo.scope.includes('https://www.googleapis.com/auth/firebase.messaging')) {
    console.error('❌ Access token does not have firebase.messaging scope');
    console.error(`   Available scopes: ${tokenInfo.scope || 'none'}`);
    process.exit(1);
  }
  console.log('✅ Token has firebase.messaging scope');
} catch (error) {
  console.error(`❌ Failed to validate token: ${error.message}`);
  process.exit(1);
}
console.log('');

// ============================================================================
// STEP 5: Connect to MongoDB and Validate Database
// ============================================================================
console.log('[Step 5] Connecting to MongoDB...');
try {
  await mongoose.connect(MONGODB_URI);
  const dbName = mongoose.connection.db.databaseName;
  const host = mongoose.connection.host;
  console.log(`✅ Connected to MongoDB`);
  console.log(`   Host: ${host}`);
  console.log(`   Database: ${dbName}`);
  
  // Hard fail if database name contains "test" or "local"
  const dbNameLower = dbName.toLowerCase();
  if (dbNameLower.includes('test') || dbNameLower.includes('local')) {
    console.error(`❌ Database name "${dbName}" appears to be non-production (contains "test" or "local")`);
    console.error('   This script is for production data only. Aborting for safety.');
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log('✅ Database name validated (not test/local)');
} catch (error) {
  console.error(`❌ Failed to connect to MongoDB: ${error.message}`);
  process.exit(1);
}
console.log('');

// ============================================================================
// STEP 6: Validate FCM Token Syntax
// ============================================================================
console.log('[Step 6] Validating FCM token syntax...');
// FCM tokens are typically base64-like strings, 152+ characters
if (FCM_TOKEN.length < 100) {
  console.error(`❌ FCM token appears too short (${FCM_TOKEN.length} chars, expected 100+)`);
  process.exit(1);
}
// Basic format check: should contain alphanumeric, -, _, : characters
if (!/^[A-Za-z0-9_\-:]+$/.test(FCM_TOKEN)) {
  console.error('❌ FCM token contains invalid characters');
  process.exit(1);
}
console.log(`✅ FCM token syntax valid (${FCM_TOKEN.length} characters)`);
console.log('');

// ============================================================================
// STEP 7: Validate-Only Send
// ============================================================================
console.log('[Step 7] Sending validate-only message...');
const validateOnlyUrl = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
const validateOnlyBody = {
  validate_only: true,
  message: {
    token: FCM_TOKEN,
    notification: {
      title: 'PH4 Validate',
      body: 'validate_only test',
    },
    data: {
      kind: 'TEST_VALIDATE',
      ts: new Date().toISOString(),
    },
  },
};

try {
  const validateResponse = await fetch(validateOnlyUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validateOnlyBody),
  });

  const validateResponseBody = await validateResponse.json();
  
  console.log(`Response Status: ${validateResponse.status} ${validateResponse.statusText}`);
  console.log('Response Body:');
  console.log(JSON.stringify(validateResponseBody, null, 2));

  if (!validateResponse.ok) {
    console.error('❌ Validate-only send failed');
    process.exit(1);
  }
  console.log('✅ Validate-only send succeeded');
} catch (error) {
  console.error(`❌ Validate-only send error: ${error.message}`);
  process.exit(1);
}
console.log('');

// ============================================================================
// STEP 8: Real Send
// ============================================================================
console.log('[Step 8] Sending real message...');
const realSendUrl = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
const realSendBody = {
  message: {
    token: FCM_TOKEN,
    notification: {
      title: 'PH4 Production Test',
      body: 'This is a production push test',
    },
    data: {
      kind: 'TEST_PRODUCTION',
      ts: new Date().toISOString(),
    },
  },
};

// Add APNs payload if EXPECT_APS_ENV is set
if (EXPECT_APS_ENV) {
  realSendBody.message.apns = {
    payload: {
      aps: {
        sound: 'default',
        badge: 1,
      },
    },
  };
  console.log(`   Including APNs payload (expected env: ${EXPECT_APS_ENV})`);
}

try {
  const realResponse = await fetch(realSendUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(realSendBody),
  });

  const realResponseBody = await realResponse.json();
  
  console.log(`Response Status: ${realResponse.status} ${realResponse.statusText}`);
  console.log('Response Body:');
  console.log(JSON.stringify(realResponseBody, null, 2));

  if (!realResponse.ok) {
    // Check for APNs environment mismatch error
    const errorCode = realResponseBody.error?.code || realResponseBody.error?.status || '';
    const errorMessage = JSON.stringify(realResponseBody.error || realResponseBody);
    
    if (errorMessage.includes('BadEnvironmentKeyInToken') || 
        errorMessage.includes('ApnsError') ||
        errorCode.includes('INVALID_ARGUMENT')) {
      console.error('\n❌ APNs Environment Mismatch Detected');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('Mismatch: iOS token environment != APNs key environment.');
      console.error('');
      console.error('Explanation:');
      console.error('  - Debug/Xcode builds use "development" APNs environment');
      console.error('  - Release/TestFlight builds use "production" APNs environment');
      console.error('');
      console.error('How to fix:');
      console.error('  1. Ensure Firebase -> Cloud Messaging -> iOS APNs keys are uploaded');
      console.error('     in the CORRECT environment (development vs production)');
      console.error('  2. Ensure the app\'s entitlements aps-environment matches:');
      console.error('     - Debug builds: aps-environment = development');
      console.error('     - Release builds: aps-environment = production');
      console.error('  3. Verify the FCM token was generated from the correct build type');
      console.error('═══════════════════════════════════════════════════════════════');
    } else {
      console.error('❌ Real send failed');
    }
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log('✅ Real send succeeded');
  if (realResponseBody.name) {
    console.log(`   Message name: ${realResponseBody.name}`);
  }
} catch (error) {
  console.error(`❌ Real send error: ${error.message}`);
  await mongoose.connection.close();
  process.exit(1);
}
console.log('');

// ============================================================================
// STEP 9: Cleanup and Exit
// ============================================================================
console.log('[Step 9] Cleaning up...');
await mongoose.connection.close();
console.log('✅ MongoDB connection closed');
console.log('');

console.log('═══════════════════════════════════════════════════════════════');
console.log('✅ Production Push Smoke Test Completed Successfully');
console.log('═══════════════════════════════════════════════════════════════');
process.exit(0);
}

// Run main function
main().catch(error => {
  console.error('\n❌ Unhandled error:', error);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
