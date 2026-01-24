# Setting Up Firebase in Render.com (Production)

## Step 1: Get Firebase Service Account JSON

### Option A: If You Already Have It

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: `profithooks-dea90` (based on your GoogleService-Info.plist)
3. Go to **Project Settings** (gear icon) → **Service Accounts**
4. Click **Generate New Private Key**
5. Download the JSON file

### Option B: Create New Service Account

1. Go to Firebase Console → Project Settings → Service Accounts
2. Click **Generate New Private Key**
3. Save the JSON file

## Step 2: Add to Render.com Environment Variables

1. Go to **Render.com** → Your backend service
2. Click **Environment** tab
3. Add new environment variable:

   **Option 1: Use JSON String (Recommended)**
   - Key: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Value: Copy the **entire JSON content** from the downloaded file
   - Format: It should be a single-line JSON string (no newlines)
   - Example:
     ```json
     {"type":"service_account","project_id":"profithooks-dea90","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...","auth_uri":"...","token_uri":"...","auth_provider_x509_cert_url":"...","client_x509_cert_url":"..."}
     ```

   **Option 2: Use File Path (If you upload file)**
   - Key: `FIREBASE_SERVICE_ACCOUNT_PATH`
   - Value: `/path/to/service-account-key.json`
   - Note: This requires file upload to Render, which is more complex

4. **Also add:**
   - Key: `FIREBASE_PROJECT_ID`
   - Value: `profithooks-dea90` (from your GoogleService-Info.plist)

5. Click **Save Changes**
6. **Redeploy** (or wait for auto-redeploy)

## Step 3: Format JSON for Render.com

The JSON needs to be a **single-line string** in Render.com. Here's how:

### Method 1: Use jq (if you have it)
```bash
cat path/to/service-account-key.json | jq -c
```

### Method 2: Manual Formatting
1. Open the JSON file
2. Remove all newlines
3. Remove extra spaces
4. Copy the entire single-line JSON
5. Paste into Render.com

### Method 3: Use Online Tool
1. Go to https://jsonformatter.org/
2. Paste your JSON
3. Click "Minify" or "Compact"
4. Copy the result
5. Paste into Render.com

## Step 4: Verify Configuration

After redeploy, test the endpoint again:

```bash
curl -X POST https://profithooks-api.onrender.com/api/v1/ops/users/6973bb8e83db8d2f73d2639e/test-push \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: YOUR_SECRET" \
  -d '{
    "kind": "DAILY_SUMMARY",
    "title": "Test Notification",
    "body": "Testing push notification"
  }'
```

**Expected responses:**
- ✅ `200` with `"devicesFound": 1` = Firebase configured correctly
- ❌ `400` with `"FIREBASE_NOT_CONFIGURED"` = JSON format issue or missing env var
- ❌ `400` with `"NO_DEVICES"` = Firebase works, but no devices found (different issue)

## Troubleshooting

### Error: "Firebase is not configured"

**Check 1: Environment Variable Exists?**
- Go to Render.com → Environment
- Verify `FIREBASE_SERVICE_ACCOUNT_JSON` exists
- Or `FIREBASE_SERVICE_ACCOUNT_PATH` exists

**Check 2: JSON Format Correct?**
- Must be valid JSON
- Must be single-line (no newlines)
- Must include all required fields: `type`, `project_id`, `private_key`, `client_email`

**Check 3: Redeployed?**
- After adding env var, Render auto-redeploys
- Wait 2-5 minutes
- Check Render logs for Firebase initialization errors

### Error: "Invalid JSON"

**Fix:**
1. Validate JSON: https://jsonlint.com/
2. Ensure it's a single-line string
3. Escape quotes if needed (but usually not required in Render.com env vars)

### Error: "Project ID mismatch"

**Fix:**
- Set `FIREBASE_PROJECT_ID=profithooks-dea90` in Render.com
- Or ensure `project_id` in JSON matches your Firebase project

## Quick Setup Checklist

- [ ] Downloaded service account JSON from Firebase Console
- [ ] Formatted JSON as single-line string
- [ ] Added `FIREBASE_SERVICE_ACCOUNT_JSON` to Render.com
- [ ] Added `FIREBASE_PROJECT_ID=profithooks-dea90` to Render.com
- [ ] Saved and waited for redeploy
- [ ] Tested endpoint again

## Example JSON Structure

Your `FIREBASE_SERVICE_ACCOUNT_JSON` should look like this (single line):

```json
{"type":"service_account","project_id":"profithooks-dea90","private_key_id":"abc123...","private_key":"-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk-xxxxx@profithooks-dea90.iam.gserviceaccount.com","client_id":"123456789","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40profithooks-dea90.iam.gserviceaccount.com"}
```

**Important:** The entire JSON must be on ONE line when pasted into Render.com.

## After Setup

Once Firebase is configured:
1. Test endpoint again
2. Should get `200` response
3. Notification appears on Android device within 5-10 seconds
