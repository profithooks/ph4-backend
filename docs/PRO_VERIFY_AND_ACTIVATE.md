# Pro Verify and Activate - Server-Truth Activation

**Date:** 2026-01-29  
**Version:** 1.0  
**Status:** ✅ Complete - Ready for Mobile Integration

---

## Summary

Implemented server-driven Pro subscription verification and activation that works **without webhook dependency**. Mobile app can now verify payment and activate Pro immediately after Razorpay checkout completes.

**Key Features:**
- ✅ Payment signature verification (HMAC SHA256)
- ✅ Pro activation without webhook
- ✅ Idempotent (duplicate requests safe)
- ✅ requirePro gates lift immediately
- ✅ Audit logging (PRO_PURCHASED)
- ✅ Server is source of truth

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│          SERVER-TRUTH ACTIVATION FLOW                       │
└─────────────────────────────────────────────────────────────┘

Mobile App                          Backend
───────────                         ───────

1. POST /api/v1/pro/order
   ← { orderId, amount, keyId }

2. Open Razorpay checkout
   → User completes payment

3. Razorpay returns:
   { razorpay_payment_id,
     razorpay_order_id,
     razorpay_signature }

4. POST /api/v1/pro/verify           ✅ Look up PaymentIntent
   → { planId, orderId,              ✅ Verify signature
       paymentId, signature }        ✅ Mark intent as paid
                                     ✅ Create Subscription
                                     ✅ Update user.planStatus = 'pro'
                                     ✅ Log audit event
   ← { ok: true, planStatus,
       endsAt, entitlementSnapshot }

5. requirePro gates lift              ✅ Immediate access
   → User can create bills
   → User has Pro features
```

**No Webhook Dependency:**
- Mobile calls /verify directly after payment
- Pro activates immediately
- Webhook is optional (backup/confirmation only)

---

## New API Endpoint

### POST /api/v1/pro/verify

**Description:** Verify Razorpay payment and activate Pro plan

**Auth:** Required (Bearer token)

**Request:**
```bash
POST /api/v1/pro/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "planId": "monthly",
  "orderId": "order_MfGaEUx1234567",
  "paymentId": "pay_ABC123xyz456789",
  "signature": "5ea9a7fe40051583fe5bc9caf4f01dd3824c1ca2977d072dc25cbf15106f2fa2"
}
```

**Request Fields:**
- `planId` - Selected plan ID (monthly, quarterly, yearly)
- `orderId` - Razorpay order ID (from /pro/order response)
- `paymentId` - Razorpay payment ID (from Razorpay checkout response)
- `signature` - Razorpay signature (from Razorpay checkout response)

**Response:** 200 OK
```json
{
  "ok": true,
  "data": {
    "planStatus": "pro",
    "endsAt": "2026-02-28T12:00:00.000Z",
    "subscriptionId": "65b9c1234567890abcdef123",
    "entitlementSnapshot": {
      "planStatus": "pro",
      "planActivatedAt": "2026-01-29T12:00:00.000Z",
      "trialEndsAt": "2026-02-28T12:00:00.000Z"
    },
    "alreadyProcessed": false
  }
}
```

**Response Fields:**
- `ok` - true if verification succeeded
- `planStatus` - Updated plan status ("pro")
- `endsAt` - Subscription expiry date
- `subscriptionId` - Created subscription ID
- `entitlementSnapshot` - Full entitlement state (for offline caching)
- `alreadyProcessed` - true if already verified (idempotency)

**Error Responses:**

400 Bad Request - Missing fields:
```json
{
  "success": false,
  "code": "MISSING_REQUIRED_FIELDS",
  "message": "planId, orderId, paymentId, and signature are required"
}
```

404 Not Found - Intent not found:
```json
{
  "success": false,
  "code": "INTENT_NOT_FOUND",
  "message": "Payment intent not found"
}
```

400 Bad Request - Invalid signature:
```json
{
  "success": false,
  "code": "INVALID_SIGNATURE",
  "message": "Invalid payment signature"
}
```

500 Internal Server Error - Activation failed:
```json
{
  "success": false,
  "code": "ACTIVATION_FAILED",
  "message": "Failed to activate Pro plan"
}
```

---

## Implementation Details

### Step 1: Look up PaymentIntent

```javascript
const paymentIntent = await ProPaymentIntent.findOne({
  providerOrderId: orderId,
  userId,
});

if (!paymentIntent) {
  return 404 INTENT_NOT_FOUND;
}
```

**Why:** Ensures the order was created by this user via /pro/order.

---

### Step 2: Check Idempotency

```javascript
if (paymentIntent.status === 'paid') {
  // Already processed - return existing subscription
  const subscription = await Subscription.findOne({
    userId,
    providerOrderId: orderId,
  });
  
  return {
    ok: true,
    planStatus: 'pro',
    endsAt: subscription.expiresAt,
    alreadyProcessed: true,
  };
}
```

**Why:** Safe to call /verify multiple times with same payment.

---

### Step 3: Verify Razorpay Signature

```javascript
// Razorpay signature algorithm:
// signature = HMAC_SHA256(orderId + '|' + paymentId, RAZORPAY_KEY_SECRET)

const isValidSignature = razorpayService.verifyPaymentSignature(
  orderId,
  paymentId,
  signature,
  razorpayKeySecret
);

if (!isValidSignature) {
  return 400 INVALID_SIGNATURE;
}
```

**Security:**
- Uses HMAC SHA256
- Secret is server-side only
- Client cannot forge signatures
- Protects against tampering

**Implementation:**
```javascript
// src/services/razorpay.service.js
const verifyPaymentSignature = (orderId, paymentId, signature, secret) => {
  const body = orderId + '|' + paymentId;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  
  return expectedSignature === signature;
};
```

---

### Step 4: Update PaymentIntent

```javascript
paymentIntent.status = 'paid';
paymentIntent.providerPaymentId = paymentId;
paymentIntent.providerSignature = signature;
paymentIntent.paidAt = new Date();
await paymentIntent.save();
```

**Why:** Marks order as paid, enables idempotency.

---

### Step 5: Create or Update Subscription

```javascript
let subscription = await Subscription.findOne({
  userId,
  providerOrderId: orderId,
});

if (subscription) {
  // Update existing
  subscription.status = 'active';
  subscription.startedAt = startedAt;
  subscription.expiresAt = expiresAt;
  subscription.providerPaymentId = paymentId;
  await subscription.save();
} else {
  // Create new
  subscription = await Subscription.create({
    userId,
    planId,
    provider: 'razorpay',
    status: 'active',
    startedAt,
    expiresAt,
    providerPaymentId: paymentId,
    providerOrderId: orderId,
    amountPaid: paymentIntent.amount,
    currency: paymentIntent.currency,
    metadata: {
      activatedVia: 'verify_endpoint',
      requestId,
    },
  });
}
```

**Why:** Idempotent - handles both first activation and re-verification.

---

### Step 6: Update User Entitlement

```javascript
req.user.planStatus = 'pro';
req.user.planActivatedAt = startedAt;
await req.user.save();
```

**Critical:** This is what requirePro middleware checks!

**requirePro logic:**
```javascript
// src/middleware/requirePro.middleware.js
if (req.user.planStatus === 'pro') {
  return next(); // ✅ Allow access
}

if (req.user.planStatus === 'free') {
  return 403 PRO_REQUIRED; // ❌ Block access
}
```

**Result:** Gates lift immediately after /verify succeeds.

---

### Step 7: Log Audit Event

```javascript
await AuditEvent.create({
  actorUserId: userId,
  actorRole: 'OWNER',
  action: 'PRO_PURCHASED',
  entityType: 'SUBSCRIPTION',
  entityId: subscription._id,
  businessId,
  metadata: {
    planId,
    planName: planDetails.name,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    duration: planDetails.duration,
    orderIdPrefix: orderId.substring(0, 16),
    paymentIdPrefix: paymentId.substring(0, 16),
    expiresAt: expiresAt.toISOString(),
    requestId,
  },
});
```

**Why:** Immutable audit trail for compliance and debugging.

---

### Step 8: Return Entitlement Snapshot

```javascript
res.status(200).json({
  ok: true,
  data: {
    planStatus: req.user.planStatus,
    endsAt: subscription.expiresAt,
    subscriptionId: subscription._id,
    entitlementSnapshot: {
      planStatus: req.user.planStatus,
      planActivatedAt: req.user.planActivatedAt,
      trialEndsAt: req.user.trialEndsAt,
    },
    alreadyProcessed: false,
  },
});
```

**Why:** Mobile can cache full entitlement state for offline-first UX.

---

## Security

### Signature Verification Algorithm

**Razorpay signature:**
```
signature = HMAC_SHA256(orderId + '|' + paymentId, RAZORPAY_KEY_SECRET)
```

**Our verification:**
```javascript
const body = orderId + '|' + paymentId;
const expectedSignature = crypto
  .createHmac('sha256', RAZORPAY_KEY_SECRET)
  .update(body)
  .digest('hex');

return expectedSignature === signature;
```

**Security guarantees:**
- ✅ Client cannot forge signatures (secret is server-only)
- ✅ Tampering detected (HMAC includes orderId + paymentId)
- ✅ Replay attacks prevented (orderId is unique)
- ✅ Man-in-the-middle attacks prevented (HTTPS + signature)

---

### Idempotency

**Scenario:** Mobile calls /verify multiple times

**Without Idempotency:**
- Multiple subscriptions created ❌
- User charged multiple times ❌
- Duplicate audit events ❌

**With Idempotency:**
```javascript
if (paymentIntent.status === 'paid') {
  // Already processed
  return { ok: true, alreadyProcessed: true };
}
```

**Result:** Safe to retry, no duplicates.

---

### Input Validation

**All fields required:**
```javascript
if (!planId || !orderId || !paymentId || !signature) {
  return 400 MISSING_REQUIRED_FIELDS;
}
```

**PaymentIntent must exist:**
```javascript
if (!paymentIntent) {
  return 404 INTENT_NOT_FOUND;
}
```

**PaymentIntent must belong to user:**
```javascript
const paymentIntent = await ProPaymentIntent.findOne({
  providerOrderId: orderId,
  userId, // ← User must own this order
});
```

**Result:** No unauthorized activation.

---

## Testing

### Unit Test: Signature Verification

**Script:** `scripts/test-pro-verify-signature.js`

**Tests:**
1. Valid signature acceptance ✅
2. Invalid signature rejection ✅
3. Tampered orderId rejection ✅
4. Tampered paymentId rejection ✅
5. Wrong secret rejection ✅
6. Empty signature rejection ✅
7. Signature independence ✅

**Run:**
```bash
node scripts/test-pro-verify-signature.js
```

**Expected Output:**
```
===========================================
Unit Test: Pro Payment Signature Verification
===========================================

[Test 1] Valid signature acceptance
✅ PASS: Valid signature accepted

[Test 2] Invalid signature rejection
✅ PASS: Invalid signature rejected

[Test 3] Tampered orderId rejection
✅ PASS: Tampered orderId rejected

...

✅ ALL TESTS PASSED

Signature verification logic is secure and working correctly.
```

---

### Manual Testing with curl

**Step 1: Login**
```bash
curl -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999999","password":"yourpassword"}'
```

Extract `token` from response.

**Step 2: Create Order**
```bash
curl -X POST http://localhost:5055/api/v1/pro/order \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"planId":"monthly"}'
```

Extract `orderId` from response.

**Step 3: Generate Test Signature**

Use Node.js REPL:
```javascript
const crypto = require('crypto');

const orderId = 'order_MfGaEUx1234567'; // From step 2
const paymentId = 'pay_TEST_' + Date.now(); // Generate test payment ID
const secret = 'your_razorpay_key_secret'; // From .env

const body = orderId + '|' + paymentId;
const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

console.log('Payment ID:', paymentId);
console.log('Signature:', signature);
```

**Step 4: Verify Payment**
```bash
curl -X POST http://localhost:5055/api/v1/pro/verify \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "monthly",
    "orderId": "order_MfGaEUx1234567",
    "paymentId": "pay_TEST_1706524800000",
    "signature": "5ea9a7fe40051583fe5bc9caf4f01dd3824c1ca2977d072dc25cbf15106f2fa2"
  }'
```

**Expected Response:**
```json
{
  "ok": true,
  "data": {
    "planStatus": "pro",
    "endsAt": "2026-02-28T12:00:00.000Z",
    "subscriptionId": "65b9c1234567890abcdef123",
    "entitlementSnapshot": {
      "planStatus": "pro",
      "planActivatedAt": "2026-01-29T12:00:00.000Z"
    },
    "alreadyProcessed": false
  }
}
```

**Step 5: Verify requirePro Gates Lift**
```bash
# Try creating a bill (requirePro endpoint)
curl -X POST http://localhost:5055/api/bills \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"...","billNo":"TEST-001","grandTotal":100,"items":[]}'
```

**Before /verify:** 403 PRO_REQUIRED  
**After /verify:** 200 OK (or 400 validation error, but NOT 403)

---

## Mobile Integration

### Step 1: Create Order

```javascript
// Already implemented in PROMPT 3
const order = await ProAPI.createOrder('monthly');
// Returns: { orderId, amount, keyId, ... }
```

---

### Step 2: Open Razorpay Checkout

```javascript
import RazorpayCheckout from 'react-native-razorpay';

const result = await RazorpayCheckout.open({
  key: order.keyId,
  amount: order.amount,
  currency: order.currency,
  order_id: order.orderId,
  name: 'ProfitHooks',
  description: 'Pro Subscription',
  prefill: {
    name: user.name,
    email: user.email,
    contact: user.phone,
  },
});

// Result contains:
// {
//   razorpay_payment_id: 'pay_ABC123...',
//   razorpay_order_id: 'order_MfGaEUx...',
//   razorpay_signature: '5ea9a7fe...'
// }
```

---

### Step 3: Verify and Activate Pro

```javascript
// src/api/pro.api.js
export const verifyAndActivatePro = async ({
  planId,
  orderId,
  paymentId,
  signature,
}) => {
  const response = await fetch(`${API_URL}/api/v1/pro/verify`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      planId,
      orderId,
      paymentId,
      signature,
    }),
  });
  
  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(data.message || 'Verification failed');
  }
  
  return data.data;
};
```

**Usage:**
```javascript
// In GoProBottomSheet or payment success handler
try {
  // Open Razorpay
  const result = await RazorpayCheckout.open(options);
  
  // Verify and activate Pro
  const activation = await ProAPI.verifyAndActivatePro({
    planId: order.planId,
    orderId: result.razorpay_order_id,
    paymentId: result.razorpay_payment_id,
    signature: result.razorpay_signature,
  });
  
  // Update local state
  updateEntitlement(activation.entitlementSnapshot);
  
  // Show success
  showSuccess('Welcome to Pro!');
  
  // Navigate to Pro features
  navigation.navigate('CreateBill');
} catch (error) {
  showError(error.message);
}
```

---

### Step 4: Handle Idempotency

```javascript
// If network fails after /verify succeeds, retry is safe
const verifyWithRetry = async (paymentDetails, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await ProAPI.verifyAndActivatePro(paymentDetails);
      
      if (result.alreadyProcessed) {
        console.log('Payment already processed (idempotent)');
      }
      
      return result;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};
```

---

## Logging

### Backend Logs

**All operations logged with requestId, userId, businessId:**

```javascript
logger.info('[Pro] Verifying payment', {
  requestId,
  userId,
  businessId,
  planId,
  orderId,
  paymentId,
});

logger.info('[Pro] Payment signature verified', {
  requestId,
  userId,
  orderId,
  paymentId,
});

logger.info('[Pro] Payment intent marked as paid', {
  requestId,
  userId,
  intentId,
  orderId,
  paymentId,
});

logger.info('[Pro] Subscription created', {
  requestId,
  userId,
  subscriptionId,
  orderId,
  planId,
});

logger.info('[Pro] User upgraded to Pro', {
  requestId,
  userId,
  planStatus: 'pro',
  planActivatedAt,
});

logger.info('[Pro] Audit event created', {
  requestId,
  userId,
  action: 'PRO_PURCHASED',
  subscriptionId,
});
```

**Grep for verification requests:**
```bash
grep "Verifying payment" logs.txt
grep "Payment signature verified" logs.txt
grep "User upgraded to Pro" logs.txt
```

---

## Monitoring

### Key Metrics

1. **Verification success rate**
   ```bash
   grep "Payment signature verified" logs.txt | wc -l
   grep "Invalid payment signature" logs.txt | wc -l
   ```
   Target: >99% success rate

2. **Verification latency**
   ```javascript
   // Track in logs
   const startTime = Date.now();
   // ... verification logic ...
   const duration = Date.now() - startTime;
   logger.info('[Pro] Verification completed', { duration });
   ```
   Target: <500ms

3. **Idempotency hit rate**
   ```bash
   grep "alreadyProcessed: true" logs.txt | wc -l
   ```
   Monitor: High rate may indicate retry issues

4. **Audit events**
   ```javascript
   db.auditevents.countDocuments({ action: 'PRO_PURCHASED' });
   ```
   Should match subscription count

---

### Alerts

**Set up alerts for:**
- High signature verification failure rate (>5%)
- Verification latency >1s
- Missing audit events (subscription created but no audit)
- PaymentIntent stuck in 'created' status >24h

---

## Comparison: Webhook vs Verify Endpoint

| Feature | Webhook | Verify Endpoint |
|---------|---------|----------------|
| **Activation time** | Async (webhook delay) | Immediate |
| **Mobile experience** | User waits | Instant feedback |
| **Network dependency** | High (webhook + mobile) | Low (mobile only) |
| **Retry logic** | Razorpay retries | Mobile controls |
| **Idempotency** | Built-in | Built-in |
| **Security** | Signature verification | Signature verification |
| **Audit logging** | Yes | Yes |
| **Mobile calls** | 0 (automatic) | 1 (/verify) |
| **Best for** | Backup/confirmation | Primary activation |

**Recommendation:**
- **Primary:** Use /verify endpoint (this implementation)
- **Backup:** Webhook (already implemented in PROMPT 2)

**Result:** Both paths work, double confirmation for reliability.

---

## Acceptance Criteria

| Criteria | Status |
|----------|--------|
| Pro activation works without webhook | ✅ PASS |
| requirePro gates lift immediately | ✅ PASS |
| Signature verification secure | ✅ PASS (7/7 tests) |
| Idempotency working | ✅ PASS |
| Audit event created | ✅ PASS |
| User.planStatus updated | ✅ PASS |
| Subscription created | ✅ PASS |
| Logging comprehensive | ✅ PASS |

---

## Files Changed

| File | Status | Description |
|------|--------|-------------|
| `src/models/AuditEvent.js` | Modified | Added PRO_PURCHASED action |
| `src/controllers/pro.controller.js` | Modified | Added verifyAndActivatePro |
| `src/routes/pro.routes.js` | Modified | Added /verify route |
| `scripts/test-pro-verify-signature.js` | Created | Signature verification unit test |
| `scripts/test-pro-verify-http.js` | Created | HTTP endpoint test |
| `docs/PRO_VERIFY_AND_ACTIVATE.md` | Created | This documentation |

**Total:** 3 modified files, 2 new scripts, 1 documentation

---

## Next Steps

**Current Status:**
- ✅ Webhooks mounted (PROMPT 2)
- ✅ Order creation (PROMPT 3)
- ✅ Payment verification (PROMPT 4)
- ❌ Mobile uses placeholder Razorpay

**Next Prompts:**
- **PROMPT 5:** Replace mobile placeholder with real Razorpay integration
- **PROMPT 6:** Test end-to-end payment flow
- **PROMPT 7:** Production deployment

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-29  
**Status:** ✅ Complete - Ready for Mobile Integration
