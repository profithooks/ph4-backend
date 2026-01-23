# Testing Push Notifications

This guide shows you how to test push notifications on Android devices.

## Prerequisites

1. **User must be logged in on Android device**
2. **Push notification permission granted** (Android 13+)
3. **Device must be TRUSTED** (not PENDING or BLOCKED)
4. **FCM token must be registered** (happens automatically after login if Firebase is configured)

## Method 1: Using Test Script (Recommended)

### Step 1: Check User's Devices

First, verify the user has devices with FCM tokens:

```bash
cd /Users/naved/Desktop/ph4-backend
node scripts/test-push-notification.js 6973bb8e83db8d2f73d2639e
```

This will:
- Check if Firebase is configured
- Find the user
- List all devices and their FCM token status
- Send a test notification

### Step 2: Run the Script

```bash
# Basic test (uses DAILY_SUMMARY kind)
node scripts/test-push-notification.js 6973bb8e83db8d2f73d2639e

# Custom notification kind
node scripts/test-push-notification.js 6973bb8e83db8d2f73d2639e OVERDUE_ALERT
```

### Step 3: Check Output

The script will show:
- ✅ User found
- ✅ Devices with FCM tokens found
- ✅ FCM send result (success/failure count)
- ✅ Notification created via service

## Method 2: Using API Endpoint

### Step 1: Send Test Notification

```bash
curl -X POST http://localhost:5055/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "DAILY_SUMMARY",
    "title": "Test Notification",
    "body": "This is a test push notification"
  }'
```

### Step 2: Check Response

The response will show:
- Devices found
- Notification created
- Worker stats (if notification was sent immediately)

## Method 3: Using Firebase Console

### Step 1: Get FCM Token from Database

```bash
# Connect to MongoDB
mongosh mongodb://localhost:27017/ph4

# Find user's device token
db.devices.find({
  userId: ObjectId("6973bb8e83db8d2f73d2639e"),
  status: "TRUSTED",
  fcmToken: { $exists: true, $ne: null }
}).pretty()
```

### Step 2: Send via Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Go to **Cloud Messaging**
4. Click **Send test message**
5. Paste the FCM token
6. Enter title and body
7. Click **Test**

**Note:** This method bypasses the backend and won't create notification records.

## Troubleshooting

### "No trusted devices with FCM tokens found"

**Check:**
1. User logged in on device?
   ```bash
   # Check devices
   db.devices.find({userId: ObjectId("6973bb8e83db8d2f73d2639e")}).pretty()
   ```

2. Device status is TRUSTED?
   ```bash
   # Update device to TRUSTED if needed
   db.devices.updateOne(
     {userId: ObjectId("6973bb8e83db8d2f73d2639e")},
     {$set: {status: "TRUSTED"}}
   )
   ```

3. FCM token exists?
   ```bash
   # Check for FCM token
   db.devices.find({
     userId: ObjectId("6973bb8e83db8d2f73d2639e"),
     fcmToken: { $exists: true, $ne: null }
   }).pretty()
   ```

4. Token was registered?
   - Check app logs for `[PUSH] Token registered`
   - Or manually register via API:
     ```bash
     # Get auth token first, then:
     curl -X POST http://localhost:5055/api/v1/security/devices/push-token \
       -H "Authorization: Bearer YOUR_JWT_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"fcmToken": "YOUR_FCM_TOKEN"}'
     ```

### "Firebase is not configured"

**Fix:**
1. Set `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env`
2. Restart backend server
3. Verify: `node -e "const {isFirebaseConfigured} = require('./src/config/firebase'); console.log(isFirebaseConfigured())"`

### Notification not received on device

**Check:**
1. App is running? (foreground notifications work)
2. App is in background? (background notifications work)
3. App is closed? (quit state notifications work)
4. Check device logs:
   ```bash
   # Android
   adb logcat | grep -i firebase
   adb logcat | grep -i "push\|notification"
   ```

5. Check backend logs for FCM send errors

## Quick Test Commands

### Check user's devices:
```bash
mongosh mongodb://localhost:27017/ph4 --eval '
db.devices.find({
  userId: ObjectId("6973bb8e83db8d2f73d2639e")
}).forEach(d => {
  print("Device: " + d.deviceName);
  print("  Platform: " + d.platform);
  print("  Status: " + d.status);
  print("  FCM Token: " + (d.fcmToken ? "Yes (" + d.fcmToken.substring(0, 20) + "...)" : "No"));
  print("---");
})
'
```

### Send test notification:
```bash
cd /Users/naved/Desktop/ph4-backend
node scripts/test-push-notification.js 6973bb8e83db8d2f73d2639e DAILY_SUMMARY
```

### Check notification was created:
```bash
mongosh mongodb://localhost:27017/ph4 --eval '
db.notifications.find({
  userId: ObjectId("6973bb8e83db8d2f73d2639e")
}).sort({createdAt: -1}).limit(1).pretty()
'
```

## Notification Kinds for Testing

You can test with any of these kinds:
- `DAILY_SUMMARY` - Daily summary
- `OVERDUE_ALERT` - Overdue payment alert
- `DUE_TODAY` - Payment due today
- `PROMISE_DUE_TODAY` - Promise due today
- `PROMISE_BROKEN` - Broken promise
- `FOLLOWUP_DUE` - Follow-up due
- `PAYMENT_RECEIVED` - Payment received

## Expected Behavior

1. **Foreground (app open):**
   - Notification appears as local notification (Notifee)
   - Tapping opens the app and navigates to deeplink

2. **Background (app minimized):**
   - Notification appears in system tray
   - Tapping opens app and navigates to deeplink

3. **Quit (app closed):**
   - Notification appears in system tray
   - Tapping opens app and navigates to deeplink

## Verification

After sending, check:
1. ✅ Notification appears on device
2. ✅ Tapping notification opens correct screen
3. ✅ Notification appears in app's notification list
4. ✅ Backend logs show successful FCM send
