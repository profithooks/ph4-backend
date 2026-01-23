# Firebase Cloud Messaging (FCM) Setup Guide

This guide explains how to configure Firebase Cloud Messaging (FCM) for push notifications in the PH4 backend.

## Overview

The backend supports Firebase Cloud Messaging as an optional transport for push notifications. If Firebase is not configured, the system falls back to a `StubTransport` that logs warnings but does not send actual push notifications.

**Important**: Push notifications are disabled by default. They will only be sent if Firebase is properly configured.

---

## Prerequisites

1. A Google account
2. Access to [Firebase Console](https://console.firebase.google.com/)
3. A Firebase project (or create a new one)

---

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"** or select an existing project
3. Follow the setup wizard:
   - Enter project name (e.g., "PH4 Production")
   - Enable/disable Google Analytics (optional)
   - Click **"Create project"**

---

## Step 2: Enable Cloud Messaging API

1. In your Firebase project, go to **Project Settings** (gear icon)
2. Navigate to the **Cloud Messaging** tab
3. Ensure **Cloud Messaging API (Legacy)** is enabled
   - If not enabled, click **"Enable"**

---

## Step 3: Generate Service Account Key

1. In Firebase Console, go to **Project Settings** → **Service Accounts** tab
2. Click **"Generate new private key"**
3. A JSON file will be downloaded (e.g., `ph4-firebase-adminsdk-xxxxx.json`)
4. **Keep this file secure** - it contains sensitive credentials

---

## Step 4: Configure Backend Environment

You have two options for providing the service account credentials:

### Option A: Environment Variable (Recommended for Production)

Set the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable with the JSON content as a string:

```bash
# In your .env file or environment configuration
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"your-project-id",...}'
```

**Note**: When using environment variables, ensure the JSON is properly escaped. In some deployment platforms (like Render.com), you may need to:
- Escape quotes: `\"` instead of `"`
- Remove newlines
- Or use the file path method (Option B)

### Option B: File Path (Recommended for Local Development)

1. Place the downloaded JSON file in a secure location (e.g., `config/firebase-service-account.json`)
2. Add the file to `.gitignore` to prevent committing secrets:
   ```
   config/firebase-service-account.json
   ```
3. Set the `FIREBASE_SERVICE_ACCOUNT_PATH` environment variable:

```bash
# In your .env file
FIREBASE_SERVICE_ACCOUNT_PATH=./config/firebase-service-account.json
```

### Optional: Project ID

If you want to explicitly set the Firebase project ID (useful for debugging):

```bash
FIREBASE_PROJECT_ID=your-project-id
```

---

## Step 5: Verify Configuration

After setting the environment variables, restart your backend server. Check the logs for:

```
[FirebaseConfig] Firebase service account loaded successfully
```

If you see errors, verify:
- The JSON file is valid
- The service account has the required permissions
- The file path is correct (if using `FIREBASE_SERVICE_ACCOUNT_PATH`)

---

## Step 6: Device Token Registration

For push notifications to work, mobile devices must register their FCM tokens with the backend:

1. Mobile app requests FCM token from Firebase SDK
2. Mobile app sends token to backend API (e.g., `POST /api/security/devices`)
3. Backend stores token in `Device` model with `fcmToken` field
4. Device must be in `TRUSTED` status to receive push notifications

---

## Token Invalidation & Cleanup

The backend automatically handles invalid FCM tokens:

- **Invalid tokens** (e.g., app uninstalled, token expired) are automatically removed from the database
- Tokens are cleaned up when FCM returns errors like:
  - `messaging/registration-token-not-registered`
  - `messaging/invalid-registration-token`
  - `messaging/mismatched-credential`

This ensures the database stays clean and notifications are only sent to valid devices.

---

## Testing

### Verify Transport Selection

Run the test suite to verify transport selection:

```bash
npm test -- notificationTransports.test.js
```

This test verifies:
- `StubTransport` is used when Firebase is not configured
- `FirebasePushTransport` is used when Firebase is configured

### Manual Testing

1. Ensure Firebase is configured
2. Create a test notification with `PUSH` channel
3. Check logs for FCM send attempts
4. Verify notification appears on trusted devices

---

## Troubleshooting

### "Firebase is not configured" Error

- Verify `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_PATH` is set
- Check that the JSON file is valid
- Ensure the file path is correct (if using file path method)

### "Failed to initialize Firebase Admin SDK"

- Verify service account JSON has required fields: `project_id`, `private_key`, `client_email`
- Check that the service account has Cloud Messaging permissions
- Ensure the private key is not corrupted

### "No trusted devices with FCM tokens found"

- Verify devices are registered with `fcmToken` field set
- Ensure device `status` is `TRUSTED` (not `PENDING` or `BLOCKED`)
- Check that mobile app is properly registering tokens

### Notifications Not Received

- Verify device has valid FCM token
- Check device is in `TRUSTED` status
- Ensure mobile app has proper FCM configuration
- Check Firebase Console for delivery statistics

---

## Security Best Practices

1. **Never commit service account JSON to version control**
   - Add to `.gitignore`
   - Use environment variables in production

2. **Rotate service account keys periodically**
   - Generate new key in Firebase Console
   - Update environment variable
   - Delete old key

3. **Restrict service account permissions**
   - Only grant Cloud Messaging permissions
   - Use least privilege principle

4. **Monitor token usage**
   - Check Firebase Console for unusual activity
   - Set up alerts for quota limits

---

## Environment Variables Summary

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | One of these | Service account JSON as string |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | One of these | Path to service account JSON file |
| `FIREBASE_PROJECT_ID` | Optional | Explicit project ID (auto-detected from JSON) |

---

## Additional Resources

- [Firebase Cloud Messaging Documentation](https://firebase.google.com/docs/cloud-messaging)
- [Firebase Admin SDK for Node.js](https://firebase.google.com/docs/admin/setup)
- [FCM Message Types](https://firebase.google.com/docs/cloud-messaging/concept-options)

---

## Support

If you encounter issues:
1. Check backend logs for detailed error messages
2. Verify Firebase Console for delivery statistics
3. Review this guide for common troubleshooting steps
