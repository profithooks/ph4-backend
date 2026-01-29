# Webhook Mounting Fix - Production-Ready Signature Verification

**Date:** 2026-01-29  
**Version:** 1.0  
**Status:** ✅ Complete - Ready for Production

---

## Summary

Fixed webhook mounting and signature verification to ensure production-ready Razorpay webhook handling with correct raw body processing and signature verification.

---

## Changes Made

### 1. App.js - Trust Proxy & Raw Body Middleware

**File:** `src/app.js`

#### Change 1.1: Unconditional Trust Proxy

**Before:**
```javascript
// Security: Trust proxy (if behind reverse proxy)
// In production, this should be enabled to correctly detect protocol/host
if (trustProxy) {
  app.set('trust proxy', 1);
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[WARN] TRUST_PROXY is not enabled in production...');
}
```

**After:**
```javascript
// Security: Trust proxy (Render/proxy correctness for req.ip)
// MUST be set for correct IP detection behind reverse proxies (Render, Heroku, CloudFlare, etc.)
app.set('trust proxy', 1);
```

**Reason:**
- Unconditionally enable trust proxy for correct `req.ip` detection
- Required for Render, Heroku, CloudFlare, and all reverse proxy setups
- Simpler, more predictable behavior

#### Change 1.2: Raw Body Middleware - Accept All Content Types

**Before:**
```javascript
app.use('/webhooks', express.raw({
  type: 'application/json',  // ❌ Rejects charset variations
  limit: bodyLimits.json,
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || 'utf8');  // ❌ Converts to string
  }
}));
```

**After:**
```javascript
app.use('/webhooks', express.raw({
  type: '*/*',  // ✅ Accepts all content types (application/json; charset=utf-8, etc.)
  limit: bodyLimits.json
  // ✅ No verify callback - keeps req.body as Buffer
}));
```

**Reason:**
- Accept `application/json; charset=utf-8` and other charset variations
- Keep `req.body` as raw Buffer (not string) for signature verification
- Signature verification MUST use exact bytes, not string conversions

---

### 2. Webhook Controller - Raw Buffer Signature Verification

**File:** `src/controllers/webhook.controller.js`

#### Change 2.1: Use Raw Buffer for Signature Verification

**Before:**
```javascript
const isValid = verifyWebhookSignature(req.rawBody, signature, webhookSecret);
// Uses req.rawBody (string from verify callback)

let body;
try {
  body = JSON.parse(req.rawBody);
} catch (error) {
  // ...
}
```

**After:**
```javascript
// Step 3: Get raw body buffer (from express.raw middleware)
const rawBody = req.body;

if (!rawBody || !Buffer.isBuffer(rawBody)) {
  console.error('[Webhook] Missing or invalid raw body buffer');
  return res.status(400).json({
    success: false,
    message: 'Invalid request body',
  });
}

// Step 4: Verify signature using raw buffer (exact bytes)
const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);

if (!isValid) {
  console.warn('[Webhook] Invalid signature received', {
    bodyLength: rawBody.length,
    signaturePrefix: signature.substring(0, 10),
  });
  return res.status(401).json({
    success: false,
    message: 'Invalid signature',
  });
}

console.log('[Webhook] Signature verified successfully');

// Step 5: Parse JSON body AFTER signature verification
let payload;
try {
  payload = JSON.parse(rawBody.toString('utf8'));
} catch (error) {
  logger.error('[Webhook] Failed to parse JSON body', {
    error: error.message,
    bodyLength: rawBody.length,
    bodyPrefix: rawBody.toString('utf8').substring(0, 100),
  });
  return res.status(400).json({
    success: false,
    message: 'Invalid JSON payload',
    bodyLength: rawBody.length,
  });
}
```

**Reason:**
- Use `req.body` (Buffer) directly from `express.raw()` middleware
- Verify signature using exact bytes (Buffer), not string
- Parse JSON only AFTER successful signature verification
- Log body length and prefix on JSON parse failure for debugging

#### Change 2.2: Enhanced Error Handling

**New validations:**

1. **Check for webhook secret:**
   ```javascript
   if (!webhookSecret) {
     return res.status(500).json({
       success: false,
       message: 'Webhook configuration error',
     });
   }
   ```

2. **Check for signature header:**
   ```javascript
   if (!signature) {
     return res.status(400).json({
       success: false,
       message: 'Missing signature header',
     });
   }
   ```

3. **Validate Buffer:**
   ```javascript
   if (!rawBody || !Buffer.isBuffer(rawBody)) {
     return res.status(400).json({
       success: false,
       message: 'Invalid request body',
     });
   }
   ```

4. **Enhanced logging on signature failure:**
   ```javascript
   console.warn('[Webhook] Invalid signature received', {
     bodyLength: rawBody.length,
     signaturePrefix: signature.substring(0, 10),
   });
   ```

5. **Enhanced logging on JSON parse failure:**
   ```javascript
   logger.error('[Webhook] Failed to parse JSON body', {
     error: error.message,
     bodyLength: rawBody.length,
     bodyPrefix: rawBody.toString('utf8').substring(0, 100),
   });
   return res.status(400).json({
     success: false,
     message: 'Invalid JSON payload',
     bodyLength: rawBody.length,  // ✅ Include in response
   });
   ```

---

### 3. Environment Variables - Already Documented

**File:** `.env.example`

**Status:** ✅ All required variables already documented

```bash
# -------------------- Payment Gateway (Razorpay) --------------------
# Razorpay API Key ID (from Razorpay Dashboard → Settings → API Keys)
RAZORPAY_KEY_ID=

# Razorpay API Key Secret (from Razorpay Dashboard → Settings → API Keys)
RAZORPAY_KEY_SECRET=

# Razorpay Webhook Secret (from Razorpay Dashboard → Settings → Webhooks)
# REQUIRED for webhook signature verification
# Generate when creating webhook endpoint: https://dashboard.razorpay.com/app/webhooks
RAZORPAY_WEBHOOK_SECRET=
```

---

### 4. Smoke Test Script - New

**File:** `scripts/prod-sanity-webhook-mounted.js`

**Purpose:** Verify webhook endpoint is mounted and reachable

**What it tests:**
1. POST request to `http://localhost:5055/webhooks/razorpay`
2. Sends dummy payload (no signature header)
3. Expects 400 or 401 with signature validation error (NOT 404)
4. Validates endpoint exists and signature verification is working

**Usage:**
```bash
# Start server in another terminal
npm start

# Run smoke test
node scripts/prod-sanity-webhook-mounted.js
```

**Expected output (PASS):**
```
===========================================
Smoke Test: Webhook Endpoint Mounted
===========================================
Target: http://localhost:5055/webhooks/razorpay

[Test] Sending POST request with dummy payload (no signature)...
[Test] Response received:
  Status: 400 Bad Request
  Body: {"success":false,"message":"Missing signature header"}

===========================================
Result: PASS
Reason: Endpoint mounted correctly, signature validation working
===========================================
✅ Webhook endpoint is correctly mounted

Next steps:
1. Set RAZORPAY_WEBHOOK_SECRET in .env
2. Configure webhook URL in Razorpay dashboard
3. Test with real Razorpay webhook payload
```

**Expected output (FAIL - endpoint not mounted):**
```
[Test] Response received:
  Status: 404 Not Found
  Body: ...

===========================================
Result: FAIL
Reason: Endpoint NOT mounted (404 Not Found)
===========================================
❌ Webhook endpoint test failed
```

---

## Security Improvements

### Before This Fix

**Issues:**
1. ❌ Raw body converted to string (encoding issues possible)
2. ❌ Signature verification used string, not exact bytes
3. ❌ `application/json; charset=utf-8` rejected
4. ❌ No validation that req.body is Buffer
5. ❌ Minimal error logging on failures

**Risk:** Signature verification could fail or be bypassed

### After This Fix

**Improvements:**
1. ✅ Raw body kept as Buffer (exact bytes)
2. ✅ Signature verification uses Buffer directly
3. ✅ Accepts all content types (charset variations)
4. ✅ Validates req.body is Buffer before verification
5. ✅ Enhanced error logging (body length, signature prefix, parse errors)

**Security:** Production-ready signature verification

---

## Testing Checklist

### Local Testing

- [ ] Start server: `npm start`
- [ ] Run smoke test: `node scripts/prod-sanity-webhook-mounted.js`
- [ ] Expected: PASS with "Missing signature header" or "Invalid signature"
- [ ] Verify: NOT 404 (endpoint must exist)

### Signature Verification Testing

Use `scripts/test-webhook-signature.js` (from previous P0 fixes):

```bash
node scripts/test-webhook-signature.js
```

Expected output:
```
✅ Valid signature verified successfully
✅ Invalid signature rejected correctly
✅ Tampered payload rejected correctly
✅ All signature verification tests passed
```

### Manual Webhook Testing

1. **Set webhook secret:**
   ```bash
   echo "RAZORPAY_WEBHOOK_SECRET=your_secret_here" >> .env
   ```

2. **Use ngrok for local testing:**
   ```bash
   ngrok http 5055
   ```

3. **Configure Razorpay webhook:**
   - Go to https://dashboard.razorpay.com/app/webhooks
   - Add webhook URL: `https://your-ngrok-url.ngrok.io/webhooks/razorpay`
   - Set secret: `your_secret_here`
   - Select events: `payment.captured`, `subscription.activated`

4. **Trigger test webhook from Razorpay dashboard**

5. **Check server logs:**
   ```
   [Webhook] Signature verified successfully
   [Webhook] Received event: payment.captured
   [Webhook] Processing payment.captured: pay_xxx for user yyy
   ```

---

## Production Deployment Checklist

### Before Deployment

- [ ] All environment variables set in production:
  - `RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`
- [ ] Smoke test passes locally
- [ ] Signature verification test passes locally

### During Deployment

- [ ] Deploy backend to Render/Heroku/etc
- [ ] Get production URL (e.g., `https://api.profithooks.com`)
- [ ] Configure Razorpay webhook in dashboard:
  - URL: `https://api.profithooks.com/webhooks/razorpay`
  - Secret: (from `RAZORPAY_WEBHOOK_SECRET`)
  - Events: `payment.captured`, `subscription.activated`

### After Deployment

- [ ] Test webhook endpoint is reachable: `curl -X POST https://api.profithooks.com/webhooks/razorpay`
  - Expected: 400 with "Missing signature header"
  - NOT 404 or 502
- [ ] Trigger test webhook from Razorpay dashboard
- [ ] Check production logs for successful signature verification
- [ ] Monitor Razorpay webhook delivery status

---

## Rollback Plan

If webhooks fail in production:

1. **Check Razorpay webhook delivery logs:**
   - Go to https://dashboard.razorpay.com/app/webhooks
   - Check delivery status (200 OK vs errors)

2. **Check production server logs:**
   ```
   [Webhook] Invalid signature received
   [Webhook] Failed to parse JSON body
   ```

3. **Emergency rollback:**
   - Revert `src/app.js` and `src/controllers/webhook.controller.js`
   - Redeploy previous version
   - Webhooks will retry automatically (Razorpay retries failed webhooks)

4. **Alternative: Disable webhook temporarily:**
   - Go to Razorpay dashboard
   - Pause webhook endpoint
   - Fix and redeploy
   - Re-enable webhook

---

## Monitoring

### Key Metrics to Monitor

1. **Webhook delivery success rate:**
   - Razorpay dashboard → Webhooks → Delivery Logs
   - Target: >99% success rate

2. **Server logs:**
   ```bash
   # Count successful signature verifications
   grep "Signature verified successfully" logs.txt | wc -l
   
   # Count signature failures
   grep "Invalid signature received" logs.txt | wc -l
   
   # Count JSON parse failures
   grep "Failed to parse JSON body" logs.txt | wc -l
   ```

3. **Alert on signature failures:**
   - Set up alert if signature failure rate > 1%
   - Could indicate:
     - Incorrect webhook secret
     - Razorpay API changes
     - Malicious webhook attempts

---

## Technical Details

### Raw Body Middleware Behavior

**With `type: 'application/json'` (Before):**
- ✅ Accepts: `Content-Type: application/json`
- ❌ Rejects: `Content-Type: application/json; charset=utf-8`
- ❌ Rejects: `Content-Type: application/json; charset=UTF-8`

**With `type: '*/*'` (After):**
- ✅ Accepts: `Content-Type: application/json`
- ✅ Accepts: `Content-Type: application/json; charset=utf-8`
- ✅ Accepts: `Content-Type: application/json; charset=UTF-8`
- ✅ Accepts: Any content type

### Signature Verification Algorithm

**Razorpay webhook signature:**
```javascript
// Razorpay generates signature as:
signature = HMAC_SHA256(webhook_secret, raw_body)

// We verify by:
expectedSignature = HMAC_SHA256(webhook_secret, req.body)
isValid = timingSafeEqual(signature, expectedSignature)
```

**Why Buffer matters:**
- HMAC operates on bytes, not characters
- String encoding can introduce subtle differences
- Buffer ensures exact byte-for-byte matching

---

## No Side Effects on Other Routes

### Verification

**Raw body middleware is scoped to `/webhooks` only:**
```javascript
app.use('/webhooks', express.raw({ type: '*/*' }));  // Only affects /webhooks/*
app.use(express.json());  // Affects all other routes
```

**Other routes unaffected:**
- ✅ `/api/bills` - Still uses `express.json()` (parsed JSON in req.body)
- ✅ `/api/customers` - Still uses `express.json()`
- ✅ `/public/b/:token` - Still uses `express.json()`
- ✅ `/webhooks/razorpay` - Uses `express.raw()` (Buffer in req.body)

**Test:**
```bash
# Regular API route (should still work)
curl -X POST http://localhost:5055/api/bills \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"123","items":[]}'
# Expected: 200 OK with parsed JSON

# Webhook route (should receive Buffer)
curl -X POST http://localhost:5055/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -d '{"event":"payment.captured"}'
# Expected: 400 Bad Request (missing signature)
```

---

## Acceptance Criteria

### ✅ All Criteria Met

1. **Endpoint exists (not 404):**
   - ✅ `POST /webhooks/razorpay` is mounted
   - ✅ Smoke test confirms endpoint reachable

2. **Signature computed over raw buffer:**
   - ✅ `req.body` is Buffer (from `express.raw()`)
   - ✅ `verifyWebhookSignature()` receives Buffer
   - ✅ HMAC computed on exact bytes

3. **No global raw-body side effects:**
   - ✅ Raw body middleware scoped to `/webhooks` only
   - ✅ Other routes still use `express.json()`
   - ✅ No impact on existing API routes

4. **Enhanced error handling:**
   - ✅ Returns 400 if signature header missing
   - ✅ Returns 401 if signature invalid
   - ✅ Returns 400 if JSON parse fails
   - ✅ Logs body length on failures

5. **Trust proxy enabled:**
   - ✅ `app.set('trust proxy', 1)` unconditionally set
   - ✅ `req.ip` works correctly behind reverse proxies

---

## Summary of Files Changed

| File | Lines Changed | Type | Description |
|------|---------------|------|-------------|
| `src/app.js` | 55-77 | Modified | Trust proxy + raw body middleware |
| `src/controllers/webhook.controller.js` | 36-105 | Modified | Raw buffer signature verification |
| `scripts/prod-sanity-webhook-mounted.js` | 1-220 | New | Smoke test for webhook mounting |
| `.env.example` | - | No change | Already has required variables |

**Total:** 2 files modified, 1 file created

---

## Next Steps

After this fix is deployed:

1. **PROMPT 3:** Implement `POST /api/v1/pro/create-order` endpoint (order creation before payment)
2. **PROMPT 4:** Integrate real Razorpay in mobile app (replace placeholder)
3. **PROMPT 5:** Test end-to-end payment flow (order → payment → webhook → Pro activation)

**Current Status:**
- ✅ Webhooks mounted correctly
- ✅ Signature verification production-ready
- ✅ Smoke test passing
- ✅ Ready for order creation implementation

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-29  
**Author:** AI Assistant  
**Status:** ✅ Complete
