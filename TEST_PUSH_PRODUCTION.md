# Testing Push Notifications in Production

## Quick Test (Recommended)

Use the API endpoint - it works in production:

```bash
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -d '{
    "kind": "DAILY_SUMMARY",
    "title": "Test Notification",
    "body": "This is a test push notification from production"
  }'
```

**Note:** In production, you need the `X-Admin-Secret` header. Set `ADMIN_SECRET` in your Render.com environment variables.

## Production Endpoint Details

**URL:** `https://profithooks-api.onrender.com/api/v1/ops/users/:userId/test-push`

**Method:** `POST`

**Headers:**
- `Content-Type: application/json`
- `X-Admin-Secret: <your-admin-secret>` (required in production)

**Body:**
```json
{
  "kind": "DAILY_SUMMARY",
  "title": "Test Notification",
  "body": "Test message"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "notificationId": "...",
    "devicesFound": 1,
    "devices": [...],
    "message": "Test notification created. Check device within a few seconds."
  }
}
```

## Step-by-Step Production Test

### 1. Get User ID
You already have it: `6973bb8e83db8d2f73d2639e`

### 2. Set Admin Secret (if not already set)

In Render.com dashboard:
1. Go to your backend service
2. Environment → Add Environment Variable
3. Key: `ADMIN_SECRET`
4. Value: (generate a secure random string)
5. Save and redeploy

### 3. Send Test Notification

```bash
# Replace YOUR_ADMIN_SECRET with your actual secret
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -d '{
    "kind": "DAILY_SUMMARY",
    "title": "Test from Production",
    "body": "Testing push notifications"
  }'
```

### 4. Check Response

The response will tell you:
- ✅ If devices with FCM tokens were found
- ✅ If notification was created
- ✅ If it was sent immediately

### 5. Verify on Device

- Notification should appear within 5-10 seconds
- Tapping should open the app and navigate to Today screen

## Troubleshooting Production

### "Forbidden - Invalid admin secret"

**Fix:**
1. Check `ADMIN_SECRET` is set in Render.com
2. Use the exact same value in the `X-Admin-Secret` header
3. Redeploy backend if you just added it

### "No trusted devices with FCM tokens found"

**Check in MongoDB (production database):**
```javascript
// Connect to production MongoDB
db.devices.find({
  userId: ObjectId("6973bb8e83db8d2f73d2639e")
}).pretty()
```

**Verify:**
- `status: "TRUSTED"` (not PENDING)
- `fcmToken` exists and is not null
- `platform: "android"` (or "ios")

**If device is PENDING, update it:**
```javascript
db.devices.updateOne(
  {userId: ObjectId("6973bb8e83db8d2f73d2639e")},
  {$set: {status: "TRUSTED"}}
)
```

### "Firebase is not configured"

**Check in Render.com:**
1. Go to Environment Variables
2. Verify `FIREBASE_SERVICE_ACCOUNT_JSON` is set
3. Or `FIREBASE_SERVICE_ACCOUNT_PATH` is set
4. Redeploy if you just added it

## Alternative: Test via Script (Local)

If you want to test from your local machine against production database:

1. **Set production MongoDB URI:**
   ```bash
   export MONGO_URI="mongodb+srv://your-production-connection-string"
   ```

2. **Set Firebase config:**
   ```bash
   export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
   ```

3. **Run script:**
   ```bash
   cd /Users/naved/Desktop/ph4-backend
   npm install  # If firebase-admin not installed locally
   node scripts/test-push-notification.js 6973bb8e83db8d2f73d2639e
   ```

## Quick Production Test Command

```bash
# Replace ADMIN_SECRET with your actual secret from Render.com
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -d '{"kind":"DAILY_SUMMARY","title":"Test","body":"Testing push"}'
```

## Expected Timeline

1. **0-2 seconds:** API responds with success
2. **2-5 seconds:** Notification delivery worker processes it
3. **5-10 seconds:** Notification appears on Android device

## Verify It Worked

1. **Check API response** - Should show `devicesFound > 0`
2. **Check device** - Notification should appear
3. **Check backend logs** (Render.com logs) - Should show FCM send success
4. **Check MongoDB** - Notification and NotificationAttempt records created
