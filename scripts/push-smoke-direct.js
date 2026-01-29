/**
 * Direct Push Smoke Test (NO DATABASE)
 * 
 * Sends a single push notification directly to an FCM token without connecting to MongoDB.
 * Useful for quick connectivity testing.
 * 
 * Usage:
 *   FCM_TOKEN="your-token" node scripts/push-smoke-direct.js
 * 
 * With custom title/body:
 *   FCM_TOKEN="..." TITLE="Custom Title" BODY="Custom Body" node scripts/push-smoke-direct.js
 * 
 * With data payload:
 *   FCM_TOKEN="..." DATA='{"kind":"TEST","ts":"2026-01-24T10:00:00Z"}' node scripts/push-smoke-direct.js
 * 
 * Example:
 *   FCM_TOKEN="dW_VE86In08JuKaF0xkiDQ:APA91bE..." node scripts/push-smoke-direct.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Use global fetch (Node.js 18+) or require node-fetch for older versions
let fetch;
if (typeof globalThis.fetch === 'function') {
  fetch = globalThis.fetch;
} else {
  // Fallback for older Node.js versions
  try {
    fetch = require('node-fetch');
  } catch (e) {
    console.error('❌ fetch is not available. Node.js 18+ required or install node-fetch');
    process.exit(1);
  }
}

// ============================================================================
// Configuration
// ============================================================================
const FIREBASE_SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '.secrets/ph4-firebase-admin.json';
const FCM_TOKEN = process.env.FCM_TOKEN;
const TITLE = process.env.TITLE || 'ProfitHooks Test';
const BODY = process.env.BODY || 'Push plumbing OK';
const DATA_JSON = process.env.DATA; // Optional JSON string

// ============================================================================
// Validation
// ============================================================================
if (!FCM_TOKEN) {
  console.error('❌ FCM_TOKEN is required');
  console.error('\nUsage:');
  console.error('  FCM_TOKEN="your-token" node scripts/push-smoke-direct.js');
  process.exit(1);
}

// Parse DATA if provided
let dataPayload = {};
if (DATA_JSON) {
  try {
    dataPayload = JSON.parse(DATA_JSON);
  } catch (error) {
    console.error('❌ Invalid JSON in DATA environment variable');
    console.error(`   Error: ${error.message}`);
    console.error(`   Provided: ${DATA_JSON}`);
    process.exit(1);
  }
}

// ============================================================================
// Load Firebase Service Account
// ============================================================================
console.log('═══════════════════════════════════════════════════════════════');
console.log('Direct Push Smoke Test (NO DATABASE)');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('[Step 1] Loading Firebase service account...');
let serviceAccount;
let serviceAccountPath;
try {
  serviceAccountPath = path.resolve(FIREBASE_SERVICE_ACCOUNT_PATH);
  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`❌ Service account file not found: ${serviceAccountPath}`);
    process.exit(1);
  }
  
  // Load service account JSON file
  const serviceAccountJson = fs.readFileSync(serviceAccountPath, 'utf8');
  serviceAccount = JSON.parse(serviceAccountJson);
  
  // Set GOOGLE_APPLICATION_CREDENTIALS to help Firebase Admin SDK find the credential
  // This ensures the messaging API uses the correct credential
  process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;
  
  console.log(`✅ Service account loaded from: ${serviceAccountPath}`);
  console.log(`   Project ID: ${serviceAccount.project_id || 'N/A'}`);
  console.log(`   Client Email: ${serviceAccount.client_email || 'N/A'}`);
  console.log(`   Has private_key: ${!!serviceAccount.private_key}`);
  console.log(`   GOOGLE_APPLICATION_CREDENTIALS set: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
} catch (error) {
  console.error(`❌ Failed to load service account: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
console.log('');

// ============================================================================
// Initialize Firebase Admin SDK
// ============================================================================
console.log('[Step 2] Initializing Firebase Admin SDK...');

// Debug: Print service account details
console.log('   Service Account Details:');
console.log(`     project_id: ${serviceAccount.project_id || 'N/A'}`);
console.log(`     client_email: ${serviceAccount.client_email || 'N/A'}`);
console.log(`     has private_key: ${!!serviceAccount.private_key}`);

try {
  // Clear any existing apps
  if (admin.apps.length > 0) {
    admin.apps.forEach(app => {
      try {
        admin.app(app.name).delete();
      } catch (e) {
        // Ignore errors when deleting
      }
    });
  }
  
  // Initialize with explicit service account credential
  // Explicitly set projectId to ensure it's available to messaging API
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
  
  console.log(`✅ Firebase Admin SDK initialized`);
  console.log(`   Project ID: ${serviceAccount.project_id}`);
  
  // Debug: Verify app options
  const app = admin.app();
  console.log(`   App options projectId: ${app.options?.projectId || 'N/A'}`);
  console.log(`   App name: ${app.name}`);
  console.log(`   App has credential: ${!!app.options?.credential}`);
} catch (error) {
  console.error(`❌ Failed to initialize Firebase: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
console.log('');

// ============================================================================
// Validate FCM Token
// ============================================================================
console.log('[Step 3] Validating FCM token...');
console.log(`   Token length: ${FCM_TOKEN.length} characters`);
if (FCM_TOKEN.length < 100) {
  console.error(`❌ FCM token appears too short (${FCM_TOKEN.length} chars, expected 100+)`);
  process.exit(1);
}
if (!/^[A-Za-z0-9_\-:]+$/.test(FCM_TOKEN)) {
  console.error('❌ FCM token contains invalid characters');
  process.exit(1);
}
console.log('✅ FCM token syntax valid');
console.log('');

// ============================================================================
// Main async function
// ============================================================================
async function sendPush() {
// ============================================================================
// Step 3.5: Verify Authentication and Get Access Token
// ============================================================================
console.log('[Step 3.5] Verifying Firebase authentication...');
let accessToken; // Store for use in fallback HTTP v1 call
let tokenResponse; // Store full response
try {
  const app = admin.app();
  const credential = app.options?.credential;
  
  if (!credential) {
    console.error('❌ No credential found in Firebase app options');
    process.exit(1);
  }
  
  // Get access token to verify authentication works
  tokenResponse = await credential.getAccessToken();
  accessToken = tokenResponse.access_token;
  
  console.log(`✅ Access token retrieved`);
  console.log(`   Token length: ${accessToken.length} characters`);
  if (tokenResponse.expires_in) {
    console.log(`   Expires in: ${tokenResponse.expires_in} seconds`);
  }
  
  // Verify the token has the required scope via tokeninfo
  try {
    const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`;
    const tokenInfoResponse = await fetch(tokenInfoUrl);
    if (tokenInfoResponse.ok) {
      const tokenInfo = await tokenInfoResponse.json();
      const hasMessagingScope = tokenInfo.scope && tokenInfo.scope.includes('https://www.googleapis.com/auth/firebase.messaging');
      console.log(`   Token has firebase.messaging scope: ${hasMessagingScope ? '✅ Yes' : '❌ No'}`);
      if (!hasMessagingScope) {
        console.error('   ⚠️  Access token does not have required firebase.messaging scope');
        console.error('   This may indicate the service account needs IAM permissions');
      }
    }
  } catch (e) {
    // Ignore tokeninfo errors
  }
} catch (error) {
  console.error(`❌ Failed to get access token: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
console.log('');

// ============================================================================
// Send Push Notification
// ============================================================================
console.log('[Step 4] Sending push notification...');
console.log(`   Title: ${TITLE}`);
console.log(`   Body: ${BODY}`);
if (Object.keys(dataPayload).length > 0) {
  console.log(`   Data: ${JSON.stringify(dataPayload)}`);
}

const message = {
  token: FCM_TOKEN,
  notification: {
    title: TITLE,
    body: BODY,
  },
  data: dataPayload,
  android: {
    priority: 'high',
  },
  apns: {
    headers: {
      'apns-priority': '10',
    },
    payload: {
      aps: {
        sound: 'default',
      },
    },
  },
};

// Attempt A: Use Firebase Admin SDK messaging API
console.log('\n[Attempt A] Using Firebase Admin SDK messaging API...');
let attemptASuccess = false;
let attemptAError = null;
try {
  // Ensure we're using the default app
  const app = admin.app();
  
  // Debug: Verify app state before sending
  console.log('   Debug: App name:', app.name);
  console.log('   Debug: App has credential:', !!app.options?.credential);
  console.log('   Debug: App projectId:', app.options?.projectId);
  
  // Use messaging() from the default app
  const messaging = admin.messaging(app);
  const response = await messaging.send(message);
  
  console.log('✅ Attempt A succeeded!');
  console.log(`   Message ID: ${response}`);
  attemptASuccess = true;
} catch (error) {
  attemptAError = error;
  console.log('❌ Attempt A failed');
  console.error(`   Error Code: ${error.code || 'N/A'}`);
  console.error(`   Error Message: ${error.message || 'N/A'}`);
  
  // Firebase error details
  if (error.errorInfo) {
    console.error(`   Firebase Code: ${error.errorInfo.code || 'N/A'}`);
    console.error(`   Firebase Message: ${error.errorInfo.message || 'N/A'}`);
  }
  
  if (error.stack) {
    console.error('   Stack Trace:', error.stack.split('\n').slice(0, 3).join('\n'));
  }
}

// Attempt B: Manual HTTP v1 API call (fallback)
if (!attemptASuccess) {
  console.log('\n[Attempt B] Fallback: Manual FCM HTTP v1 API call...');
  console.log('   Using access token from Step 3.5');
  console.log(`   Endpoint: https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`);
  
  try {
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    const httpBody = {
      message: {
        token: FCM_TOKEN,
        notification: {
          title: TITLE,
          body: BODY,
        },
        data: dataPayload,
        android: {
          priority: 'HIGH',
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              sound: 'default',
            },
          },
        },
      },
    };
    
    const httpResponse = await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(httpBody),
    });
    
    const responseText = await httpResponse.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch (e) {
      // Response is not JSON
    }
    
    console.log(`\n   HTTP Response Status: ${httpResponse.status} ${httpResponse.statusText}`);
    console.log('   HTTP Response Body:');
    if (responseJson) {
      console.log(JSON.stringify(responseJson, null, 2));
    } else {
      console.log(responseText);
    }
    
    if (httpResponse.ok) {
      console.log('\n✅ Attempt B succeeded!');
      if (responseJson?.name) {
        console.log(`   Message ID: ${responseJson.name}`);
      }
      console.log('');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('✅ Direct Push Smoke Test Completed Successfully (via HTTP v1)');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('\n💡 Note: Firebase Admin SDK messaging API failed, but manual HTTP v1 call succeeded.');
      console.log('   This suggests a potential issue with firebase-admin SDK transport.');
      process.exit(0);
    } else {
      console.error('\n❌ Attempt B also failed');
      console.error('   This suggests the issue is with project/API/permissions, not the SDK.');
      
      // Provide diagnostic information
      if (responseJson?.error) {
        const fcmError = responseJson.error;
        console.error(`   FCM Error Code: ${fcmError.code || 'N/A'}`);
        console.error(`   FCM Error Message: ${fcmError.message || 'N/A'}`);
        if (fcmError.status) {
          console.error(`   FCM Error Status: ${fcmError.status}`);
        }
      }
    }
  } catch (httpError) {
    console.error('\n❌ Attempt B HTTP request failed');
    console.error(`   Error: ${httpError.message}`);
    if (httpError.stack) {
      console.error('   Stack:', httpError.stack.split('\n').slice(0, 3).join('\n'));
    }
  }
  
  // Both attempts failed
  console.error('\n═══════════════════════════════════════════════════════════════');
  console.error('❌ Both Attempt A (SDK) and Attempt B (HTTP v1) failed');
  console.error('═══════════════════════════════════════════════════════════════');
  
  // Check for common errors and provide guidance (from Attempt A error)
  if (attemptAError) {
    const errorCode = attemptAError.code || attemptAError.errorInfo?.code || '';
    const errorMessage = (attemptAError.message || attemptAError.errorInfo?.message || '').toLowerCase();
  
    if (errorCode.includes('invalid-registration-token') || errorMessage.includes('invalid-registration-token')) {
      console.error('\n💡 Hint: The FCM token may be invalid or expired. Generate a new token from the app.');
    } else if (errorCode.includes('registration-token-not-registered') || errorMessage.includes('not-registered')) {
      console.error('\n💡 Hint: The FCM token is not registered. The app may have been uninstalled or token revoked.');
    } else if (errorMessage.includes('badenvironmentkeyintoken') || errorMessage.includes('apns')) {
      console.error('\n💡 Hint: APNs environment mismatch. Debug builds use development APNs, Release uses production.');
    } else if (errorCode.includes('third-party-auth-error') || errorMessage.includes('missing required authentication')) {
      console.error('\n💡 Hint: Authentication issue. Verify:');
      console.error('   1. Service account has "Firebase Cloud Messaging API" enabled');
      console.error('   2. Service account has "Firebase Cloud Messaging API Service Agent" role');
      console.error('   3. Firebase project has Cloud Messaging API enabled');
    }
  }
  
  console.error('═══════════════════════════════════════════════════════════════');
  process.exit(1);
} else {
  // Attempt A succeeded
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ Direct Push Smoke Test Completed Successfully');
  console.log('═══════════════════════════════════════════════════════════════');
  process.exit(0);
}
}

// Run async function
sendPush().catch(error => {
  console.error('\n❌ Unhandled error:', error);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
