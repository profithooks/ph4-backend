# Step-by-Step Guide: Testing Push Notifications in Production

## Prerequisites Checklist

Before testing, verify:

- [ ] Backend code is pushed and deployed to Render.com
- [ ] Firebase is configured in Render.com (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH)
- [ ] User has logged in on Android device
- [ ] Push notification permission was granted on Android device
- [ ] Device is marked as TRUSTED (not PENDING)
- [ ] FCM token is registered (happens automatically after login)

## Step 1: Verify User's Device Setup

### Option A: Check via MongoDB (if you have access)

```javascript
// Connect to production MongoDB
use ph4

// Check devices for user
db.devices.find({
  userId: ObjectId("6973bb8e83db8d2f73d2639e")
}).pretty()
```

**What to look for:**
- `status: "TRUSTED"` ✅
- `fcmToken: "..."` (exists and not null) ✅
- `platform: "android"` ✅

**If device is PENDING:**
```javascript
db.devices.updateOne(
  {userId: ObjectId("6973bb8e83db8d2f73d2639e")},
  {$set: {status: "TRUSTED"}}
)
```

### Option B: Check via API Response

The test endpoint will tell you if devices are found (see Step 2).

## Step 2: Send Test Notification

### If NODE_ENV is NOT 'production' in Render:

```bash
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "DAILY_SUMMARY",
    "title": "Test Notification",
    "body": "This is a test push notification"
  }'
```

### If NODE_ENV IS 'production' in Render:

**First, set ADMIN_SECRET in Render.com:**
1. Go to Render.com dashboard
2. Select your backend service
3. Go to **Environment** tab
4. Click **Add Environment Variable**
5. Key: `ADMIN_SECRET`
6. Value: Generate a secure random string:
   ```bash
   openssl rand -base64 32
   ```
7. Click **Save**
8. Wait for auto-redeploy (or manually redeploy)

**Then use it in the request:**
```bash
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_GENERATED_SECRET_HERE" \
  -d '{
    "kind": "DAILY_SUMMARY",
    "title": "Test Notification",
    "body": "This is a test push notification"
  }'
```

## Step 3: Check the Response

### Success Response (200):
```json
{
  "success": true,
  "data": {
    "notificationId": "...",
    "devicesFound": 1,
    "devices": [
      {
        "deviceName": "Android Device",
        "platform": "android",
        "deviceId": "..."
      }
    ],
    "message": "Test notification created. Check device within a few seconds."
  }
}
```

**This means:**
- ✅ User found
- ✅ Devices with FCM tokens found
- ✅ Notification created
- ✅ Should be sent within 5-10 seconds

### Error: "No trusted devices with FCM tokens found" (400):
```json
{
  "success": false,
  "error": {
    "code": "NO_DEVICES",
    "message": "No trusted devices with FCM tokens found",
    "devices": [...]
  }
}
```

**Fix:**
1. Make sure user is logged in on Android device
2. Check device status is TRUSTED (not PENDING)
3. Verify FCM token exists (should be registered automatically)

### Error: "Forbidden - Invalid admin secret" (403):
- Set `ADMIN_SECRET` in Render.com (see Step 2)
- Use it in `X-Admin-Secret` header

### Error: "Not authorized, no token" (401):
- This means the endpoint isn't deployed yet
- Wait for Render to finish deploying after git push
- Or check if route path is correct: `/api/v1/ops/users/:id/test-push`

## Step 4: Check Your Android Device

**Timeline:**
- **0-2 seconds:** API responds
- **2-5 seconds:** Notification delivery worker processes it
- **5-10 seconds:** Notification appears on device

**What to expect:**
1. **Notification appears** in system tray
2. **Title:** "Test Notification"
3. **Body:** "This is a test push notification"
4. **Tapping notification:**
   - Opens the app
   - Navigates to Today screen (deeplink: `ph4://today`)

## Step 5: Verify in App

1. Open the app
2. Go to Notifications/Inbox (if you have one)
3. You should see the test notification listed there too

## Step 6: Check Backend Logs (Optional)

In Render.com dashboard:
1. Go to your backend service
2. Click **Logs** tab
3. Look for:
   - `[FirebasePushTransport] Notification sent successfully`
   - `[FCMClient] Send completed`
   - Any errors

## Troubleshooting

### Notification not received?

**Check 1: Device has FCM token?**
```bash
# Use the API response from Step 2
# It shows "devicesFound: 0" if no tokens
```

**Check 2: Firebase configured?**
- Verify `FIREBASE_SERVICE_ACCOUNT_JSON` is set in Render.com
- Check Render logs for Firebase initialization errors

**Check 3: Device logs (Android):**
```bash
# Connect device via USB
adb logcat | grep -i firebase
adb logcat | grep -i "push\|notification"
```

**Check 4: Backend logs:**
- Check Render.com logs for FCM send errors
- Look for token invalidation messages

### Still not working?

1. **Verify endpoint is deployed:**
   ```bash
   # Should return 400 (Firebase not configured) or 200, NOT 404
   curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
     -H "Content-Type: application/json" \
     -d '{}'
   ```

2. **Check Firebase configuration:**
   - Go to Render.com → Environment
   - Verify `FIREBASE_SERVICE_ACCOUNT_JSON` exists
   - Or `FIREBASE_SERVICE_ACCOUNT_PATH` exists

3. **Check device status:**
   - Device must be `TRUSTED` (not `PENDING`)
   - FCM token must exist

## Quick Test Command (Copy-Paste Ready)

Replace `YOUR_ADMIN_SECRET` if needed:

```bash
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -d '{"kind":"DAILY_SUMMARY","title":"Test","body":"Testing push notification"}'
```

## Expected Result

✅ **Success:** Notification appears on Android device within 10 seconds  
✅ **Tapping:** Opens app and navigates to Today screen  
✅ **In-app:** Notification appears in notification list  

If you see the success response but no notification on device, check:
- Device is online
- App has notification permission
- Firebase is properly configured
- FCM token is valid
