# Dev Push Notification Test Endpoint

**Date:** 2026-01-29  
**Type:** Development/Testing Tool  
**Status:** ✅ Complete

---

## Purpose

Secure endpoint for testing push notifications from the **LIVE backend** (Render deployment), without needing to trigger actual user actions.

---

## Endpoint

```
POST /api/v1/dev/push/test
```

---

## Security

This endpoint is **production-safe** with multiple security layers:

1. **JWT Authentication** - Requires valid user JWT token
2. **DEV_PUSH_KEY Header** - Requires `X-DEV-PUSH-KEY` header matching env var
3. **Token Limit** - Default max 3 tokens, capped at 10
4. **Trusted Devices Only** - Only sends to devices with `status: 'TRUSTED'`
5. **Partial Token Logging** - Only logs first 20 characters of tokens

---

## Setup

### 1. Set Environment Variable on Render

In Render Dashboard → Environment → Add:

```bash
DEV_PUSH_KEY=<paste_secure_random_string_here>
```

**Generate a secure key:**
```bash
openssl rand -base64 32
```

Example output: `xK8Qm2L9vN4pR7sT6wY1zA3bC5dE8fG0hI2jK4lM6nO=`

---

## Usage

### Step 1: Get Your JWT Token

Login from mobile app or use the auth endpoint:

```bash
curl -X POST "https://<YOUR-RENDER-URL>/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"<your_phone>","password":"<your_password>"}'
```

Copy the `token` from the response.

---

### Step 2: Test Push Notification

**Template:**
```bash
curl -X POST "https://<YOUR-RENDER-URL>/api/v1/dev/push/test" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <PASTE_JWT_HERE>" \
  -H "X-DEV-PUSH-KEY: <PASTE_DEV_PUSH_KEY_HERE>" \
  -d '{
    "title": "ProfitHooks Live Test",
    "body": "Sent from Render backend",
    "data": {"type": "test"},
    "maxTokens": 3
  }'
```

**Real Example (fill in your values):**
```bash
# Replace these:
# - YOUR_RENDER_URL: e.g., ph4-backend.onrender.com
# - YOUR_JWT: from login response
# - YOUR_DEV_PUSH_KEY: from Render env vars

export RENDER_URL="ph4-backend.onrender.com"
export JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
export DEV_KEY="xK8Qm2L9vN4pR7sT6wY1zA3bC5dE8fG0hI2jK4lM6nO="

curl -X POST "https://${RENDER_URL}/api/v1/dev/push/test" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWT}" \
  -H "X-DEV-PUSH-KEY: ${DEV_KEY}" \
  -d '{
    "title": "ProfitHooks Live Test",
    "body": "This is a test notification from Render",
    "data": {"type": "test", "timestamp": "2026-01-29T20:00:00Z"},
    "maxTokens": 3
  }'
```

---

## Request Body Parameters

All parameters are **optional**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | string | "ProfitHooks Live Test" | Notification title |
| `body` | string | "Sent from Render backend" | Notification body text |
| `data` | object | `{"type":"test"}` | Custom data payload (all values must be strings or will be stringified) |
| `maxTokens` | number | 3 | Max tokens to send to (capped at 10) |

---

## Response Format

### Success Response (200 OK)

```json
{
  "ok": true,
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "selected": [
    {
      "tokenPrefix": "dXzK9mP3vN2qR5sT6w...",
      "platform": "ios",
      "deviceName": "Naved's iPhone",
      "lastSeen": "2026-01-29T14:30:00.000Z"
    },
    {
      "tokenPrefix": "hI8jK4lM6nO7pQ1rS2...",
      "platform": "android",
      "deviceName": "Pixel 7",
      "lastSeen": "2026-01-29T14:25:00.000Z"
    }
  ],
  "results": {
    "successCount": 2,
    "failureCount": 0,
    "failures": []
  }
}
```

### Success with Failures (200 OK)

```json
{
  "ok": true,
  "requestId": "...",
  "selected": [
    {...},
    {...},
    {...}
  ],
  "results": {
    "successCount": 2,
    "failureCount": 1,
    "failures": [
      {
        "tokenPrefix": "xY9zK4lM6nO7pQ1rS2...",
        "errorCode": "messaging/registration-token-not-registered",
        "errorMessage": "The registration token is not registered",
        "shouldRemoveToken": true
      }
    ]
  }
}
```

### No Tokens Found (200 OK)

```json
{
  "ok": true,
  "requestId": "...",
  "message": "No FCM tokens found for this user/business",
  "selected": [],
  "results": {
    "successCount": 0,
    "failureCount": 0,
    "failures": []
  }
}
```

### Error Responses

**Missing JWT (401)**
```json
{
  "ok": false,
  "error": "Not authorized, no token"
}
```

**Missing DEV_PUSH_KEY Header (403)**
```json
{
  "ok": false,
  "error": "X-DEV-PUSH-KEY header required",
  "message": "Missing X-DEV-PUSH-KEY header"
}
```

**Invalid DEV_PUSH_KEY (403)**
```json
{
  "ok": false,
  "error": "Invalid X-DEV-PUSH-KEY",
  "message": "Invalid dev push key"
}
```

**DEV_PUSH_KEY Not Configured (403)**
```json
{
  "ok": false,
  "error": "DEV_PUSH_KEY not configured",
  "message": "This endpoint is disabled. Set DEV_PUSH_KEY in environment variables."
}
```

---

## How It Works

### 1. Token Selection

The endpoint:
1. Queries `Device` collection for the authenticated user's devices
2. Filters for:
   - `userId` or `businessId` matches authenticated user
   - `fcmToken` exists and not null
   - `status === 'TRUSTED'` (only trusted devices)
3. Sorts by most recent (`fcmTokenUpdatedAt DESC`, `lastSeenAt DESC`)
4. Limits to `maxTokens` (default 3, max 10)

### 2. Push Notification Send

Uses Firebase Admin SDK (`sendEachForMulticast`):
```javascript
{
  tokens: [...],
  notification: { title, body },
  data: { ...stringified values, requestId },
  android: { priority: "high" },
  apns: { payload: { aps: { sound: "default", badge: 1 } } }
}
```

### 3. Result Processing

- Counts successes vs failures
- Logs partial tokens (first 20 chars) only
- Returns detailed failure info for debugging
- Never logs full tokens (security)

---

## Security Best Practices

### ✅ DO

- Store `DEV_PUSH_KEY` in Render env vars (never commit to git)
- Use a strong random key (32+ characters)
- Rotate the key periodically
- Only share with authorized team members
- Use this endpoint for testing only (not production features)

### ❌ DON'T

- Commit `DEV_PUSH_KEY` to git or hardcode it
- Share the key publicly (Slack, email, etc.)
- Use weak/guessable keys like "test123"
- Spam users with test notifications (default limit: 3 tokens)
- Use this endpoint for production notification delivery

---

## Troubleshooting

### "No FCM tokens found"

**Causes:**
- User hasn't logged into mobile app yet
- Mobile app hasn't registered FCM token
- Devices are not marked as `TRUSTED`

**Solutions:**
1. Login to mobile app
2. Check Device collection in MongoDB:
   ```javascript
   db.devices.find({ userId: ObjectId("..."), fcmToken: { $ne: null } })
   ```
3. Verify device status is `TRUSTED`

---

### "Invalid X-DEV-PUSH-KEY"

**Causes:**
- Header value doesn't match env var
- Typo in header name (must be `X-DEV-PUSH-KEY`)
- Key not set in Render env vars

**Solutions:**
1. Check Render env vars for `DEV_PUSH_KEY`
2. Copy exact value (no trailing spaces)
3. Verify header name: `X-DEV-PUSH-KEY` (case-insensitive)

---

### "Firebase is not configured"

**Causes:**
- `FIREBASE_SERVICE_ACCOUNT_JSON` not set in Render
- Invalid JSON format
- Missing required fields in service account

**Solutions:**
1. Get service account JSON from Firebase Console
2. Stringify it and set as `FIREBASE_SERVICE_ACCOUNT_JSON` in Render
3. Or upload file and set `FIREBASE_SERVICE_ACCOUNT_PATH`

---

### Notification not received on device

**Causes:**
- FCM token expired/invalid
- Device not connected to internet
- App not running or in background (iOS restrictions)
- Notification permissions denied

**Solutions:**
1. Check response for error codes
2. If `shouldRemoveToken: true`, token is invalid (re-register from app)
3. Ensure device has internet connection
4. Check notification permissions in device settings

---

## Code References

**Controller:**
```
src/controllers/devPush.controller.js
```

**Routes:**
```
src/routes/devPush.routes.js
```

**FCM Client (Reused):**
```
src/services/push/fcmClient.js
```

**Device Model:**
```
src/models/Device.js
```

---

## Example: Complete Test Flow

### 1. Setup (One-time)

```bash
# Generate key
openssl rand -base64 32
# Output: xK8Qm2L9vN4pR7sT6wY1zA3bC5dE8fG0hI2jK4lM6nO=

# Add to Render env vars
DEV_PUSH_KEY=xK8Qm2L9vN4pR7sT6wY1zA3bC5dE8fG0hI2jK4lM6nO=

# Redeploy Render service (or it auto-redeploys on env change)
```

### 2. Get JWT Token

```bash
curl -X POST "https://ph4-backend.onrender.com/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919876543210","password":"mypass123"}'

# Response:
# {
#   "ok": true,
#   "data": {
#     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#     "user": {...}
#   }
# }
```

### 3. Test Push Notification

```bash
curl -X POST "https://ph4-backend.onrender.com/api/v1/dev/push/test" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "X-DEV-PUSH-KEY: xK8Qm2L9vN4pR7sT6wY1zA3bC5dE8fG0hI2jK4lM6nO=" \
  -d '{
    "title": "Test from Render",
    "body": "If you see this, push works!",
    "data": {"type": "test"},
    "maxTokens": 2
  }'

# Response:
# {
#   "ok": true,
#   "requestId": "a1b2c3d4-...",
#   "selected": [
#     {
#       "tokenPrefix": "dXzK9mP3vN2qR5sT6w...",
#       "platform": "ios",
#       "deviceName": "Naved's iPhone",
#       "lastSeen": "2026-01-29T14:30:00.000Z"
#     }
#   ],
#   "results": {
#     "successCount": 1,
#     "failureCount": 0,
#     "failures": []
#   }
# }
```

### 4. Check Device

- Notification should appear on device
- Title: "Test from Render"
- Body: "If you see this, push works!"

---

## Summary

**Endpoint:** `POST /api/v1/dev/push/test`

**Security:**
- ✅ JWT authentication required
- ✅ `X-DEV-PUSH-KEY` header required
- ✅ Token limit (max 10)
- ✅ Trusted devices only
- ✅ Partial token logging only

**Use Cases:**
- ✅ Testing push from live Render backend
- ✅ Verifying Firebase setup
- ✅ Debugging notification delivery
- ✅ Testing notification payload formats

**Production Safe:**
- ✅ No public access (auth + key required)
- ✅ No spam (default 3 tokens, max 10)
- ✅ No security leaks (partial tokens only)
- ✅ Clear audit trail (requestId + logging)

---

**Status:** ✅ **Ready for Testing on Render!**

**Document Version:** 1.0  
**Last Updated:** 2026-01-29
