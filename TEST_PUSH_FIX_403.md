# Fix 403 "Invalid admin secret" Error

## The Problem

You're getting `403 Forbidden - Invalid admin secret` because:
1. `NODE_ENV` is set to `'production'` in Render.com
2. The endpoint requires `X-Admin-Secret` header
3. The header is missing or the value doesn't match `ADMIN_SECRET` in Render.com

## Solution: Add X-Admin-Secret Header

### Step 1: Get Your ADMIN_SECRET Value

1. Go to **Render.com** → Your backend service
2. Click **Environment** tab
3. Find `ADMIN_SECRET` variable
4. **Copy the exact value** (it's hidden, click to reveal)

### Step 2: Use It in Your Request

**In ReqBin or any curl tool, add this header:**

```
X-Admin-Secret: YOUR_ACTUAL_SECRET_VALUE_FROM_RENDER
```

### Step 3: Complete curl Command

**For ReqBin (web tool):**
1. Method: `POST`
2. URL: `https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push`
3. Headers (click "Headers" tab):
   - Header 1:
     - Name: `Content-Type`
     - Value: `application/json`
   - Header 2:
     - Name: `X-Admin-Secret`
     - Value: `YOUR_ACTUAL_SECRET_VALUE` (paste from Render.com)
4. Body:
   ```json
   {
     "kind": "DAILY_SUMMARY",
     "title": "Test Notification",
     "body": "This is a test push notification"
   }
   ```

**For Terminal:**
```bash
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ACTUAL_SECRET_VALUE" \
  -d '{
    "kind": "DAILY_SUMMARY",
    "title": "Test Notification",
    "body": "This is a test push notification"
  }'
```

## Alternative: Check NODE_ENV

If you want to test **without** the secret, check if `NODE_ENV` is actually `'production'`:

1. Go to Render.com → Environment
2. Check `NODE_ENV` value:
   - If it's **not set** or **not exactly `'production'`** → endpoint works without secret
   - If it's **exactly `'production'`** → you MUST use `X-Admin-Secret` header

## Quick Test (Copy-Paste Ready)

Replace `YOUR_ADMIN_SECRET` with the actual value from Render.com:

```bash
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -d '{"kind":"DAILY_SUMMARY","title":"Test","body":"Testing push notification"}'
```

## Common Mistakes

❌ **Missing header:** Not including `X-Admin-Secret`  
❌ **Wrong header name:** Using `Authorization` instead of `X-Admin-Secret`  
❌ **Wrong value:** Secret doesn't match Render.com value  
❌ **Extra spaces:** Secret has leading/trailing spaces  

✅ **Correct:** Header name is exactly `X-Admin-Secret` (case-sensitive)  
✅ **Correct:** Value matches exactly what's in Render.com (no extra spaces)

## Verify ADMIN_SECRET is Set

In Render.com:
1. Environment tab
2. Look for `ADMIN_SECRET`
3. If missing, add it:
   - Key: `ADMIN_SECRET`
   - Value: Generate with `openssl rand -base64 32`
   - Save and redeploy

## Expected Success Response

After adding the correct header, you should get:

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

Then check your Android device - notification should appear within 5-10 seconds!
