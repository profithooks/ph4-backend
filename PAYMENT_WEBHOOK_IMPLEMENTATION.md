# Payment Webhook Implementation - Audit & Plan

**Date:** 2026-01-21  
**Status:** 🔍 **AUDIT COMPLETE** → Ready for implementation

---

## **STEP 0: DECISIONS LOCKED**

| Decision | Value |
|----------|-------|
| Payment Provider | Razorpay |
| Plan | Monthly Pro only |
| Billing Cycle | 30 days |
| Price | `process.env.PRO_MONTHLY_PRICE` |
| Source of Truth | Razorpay webhook (NOT frontend) |
| Mobile App Changes | **NONE** (read-only) |

---

## **STEP 1: SUBSCRIPTION MODEL AUDIT**

**File:** `src/models/Subscription.js`

### **✅ EXISTING FIELDS:**

| Field | Type | Purpose | Status |
|-------|------|---------|--------|
| `userId` | ObjectId | User reference | ✅ Indexed |
| `planId` | String | Plan identifier | ✅ Enum |
| `provider` | String | Payment provider | ✅ Enum (razorpay) |
| `status` | String | Subscription status | ✅ Enum (active/cancelled/expired) |
| `startedAt` | Date | Activation date | ✅ Required |
| `expiresAt` | Date | Expiry date | ✅ Indexed |
| `providerPaymentId` | String | Razorpay payment ID | ✅ **Unique index** |
| `providerOrderId` | String | Razorpay order ID | ✅ Indexed |
| `providerSignature` | String | Razorpay signature | ✅ Optional |
| `metadata` | Mixed | Raw webhook payload | ✅ For audit |
| `amountPaid` | Number | Amount in paise | ✅ Required |
| `currency` | String | Currency code | ✅ Default INR |

**Static Methods:**
- ✅ `findActiveByUserId(userId)` - Find active subscription
- ✅ `checkAndMarkExpired()` - Mark expired subscriptions

**Verdict:** ✅ **SCHEMA IS COMPLETE** - No changes needed!

---

### **⚠️ FIELDS TO ADD (OPTIONAL):**

| Field | Type | Purpose | Priority |
|-------|------|---------|----------|
| `activatedBy` | String | 'webhook' \| 'manual' | ⚠️ MEDIUM |
| `lastEventAt` | Date | Last webhook event time | ⚠️ MEDIUM |
| `planCode` | String | Explicit plan code | 🟢 LOW (planId exists) |

**Decision:** Keep schema as-is. `metadata` captures all audit info. Add fields only if needed.

---

## **USER MODEL AUDIT**

**File:** `src/models/User.js`

**Existing Fields:**
- ✅ `planStatus` ('trial' | 'free' | 'pro')
- ✅ `planActivatedAt` (Date, tracks when Pro activated)
- ✅ `trialEndsAt` (Date)

**Verdict:** ✅ **USER MODEL IS COMPLETE**

---

## **STEP 2: WEBHOOK ENDPOINT REQUIREMENTS**

### **Route:** `POST /webhooks/razorpay`

### **Requirements:**

1. **Signature Verification** (MANDATORY)
   - Header: `X-Razorpay-Signature`
   - Secret: `process.env.RAZORPAY_WEBHOOK_SECRET`
   - Algorithm: HMAC SHA256

2. **Events to Handle:**
   - `payment.captured` (one-time payment)
   - `subscription.activated` (if using Razorpay Subscriptions)

3. **Events to Ignore (200 OK):**
   - `payment.failed`
   - `order.paid`
   - All others

4. **Idempotency:**
   - Check if `providerPaymentId` already processed
   - If exists → Return 200 OK (silent success)

5. **User Identification:**
   - Extract from `notes.userId` or `metadata.userId`
   - If missing → Log error + return 400

6. **Pro Activation:**
   ```javascript
   user.planStatus = 'pro';
   user.planActivatedAt = now;
   await user.save();
   ```

7. **Subscription Creation:**
   ```javascript
   await Subscription.create({
     userId,
     provider: 'razorpay',
     status: 'active',
     startedAt: now,
     expiresAt: now + 30 days,
     providerPaymentId,
     providerOrderId,
     amountPaid,
     metadata: webhookPayload,
   });
   ```

8. **Audit Logging:**
   - Log every webhook received (event type, paymentId, userId)
   - Log activation success/failure

---

## **STEP 3: OPS SAFETY ENDPOINT**

### **Route:** `POST /ops/users/:id/activate-pro`

### **Purpose:**
- Manual Pro activation for support/testing
- Bypasses payment (authorized only)

### **Guards:**
```javascript
if (process.env.NODE_ENV === 'production') {
  // Require admin secret header
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
}
```

### **Logic:**
1. Find user by ID
2. Set `planStatus = 'pro'`, `planActivatedAt = now`
3. Create Subscription record (provider='manual')
4. Log action (userId, activatedBy)

---

## **STEP 4: WEBHOOK PAYLOAD STRUCTURE**

### **Razorpay `payment.captured` Event:**

```json
{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_xxxxxxxxxxxxxxxx",
        "order_id": "order_xxxxxxxxxxxxxxxx",
        "amount": 29900,
        "currency": "INR",
        "status": "captured",
        "method": "card",
        "email": "user@example.com",
        "contact": "+919876543210",
        "notes": {
          "userId": "65abc123def456789012345",
          "email": "user@example.com",
          "phone": "+919876543210"
        },
        "created_at": 1706000000
      }
    }
  }
}
```

### **Required Fields:**
- `payload.payment.entity.id` → `providerPaymentId`
- `payload.payment.entity.order_id` → `providerOrderId`
- `payload.payment.entity.amount` → `amountPaid`
- `payload.payment.entity.notes.userId` → User to activate

---

## **STEP 5: SIGNATURE VERIFICATION**

### **Razorpay Signature Formula:**
```
signature = HMAC_SHA256(webhook_secret, webhook_body_raw)
```

### **Verification Code:**
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(body, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

**CRITICAL:** Use `crypto.timingSafeEqual` to prevent timing attacks

---

## **STEP 6: FAILURE MODES**

| Scenario | Handling |
|----------|----------|
| Duplicate webhook | Check `providerPaymentId` exists → Return 200 OK |
| Missing userId | Log error + return 400 Bad Request |
| Invalid signature | Log warning + return 401 Unauthorized |
| User not found | Log error + return 404 Not Found |
| DB write failure | Log error + return 500 (Razorpay will retry) |
| Already Pro | Idempotent - just return 200 OK |

---

## **STEP 7: VERIFICATION SCRIPT EXTENSION**

**File:** `scripts/verify-entitlement-rules.js`

**New Test:**
```javascript
// TEST 4: Webhook Pro Activation
log('\n📋 TEST 4: Webhook Pro Activation\n', 'yellow');

info('Creating free user...');
await api.setPlanStatus('free');

info('Simulating Razorpay webhook...');
const webhookPayload = {
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_test123',
        order_id: 'order_test123',
        amount: 29900,
        notes: { userId: testUserId },
      },
    },
  },
};

const webhookRes = await api.callWebhook(webhookPayload);
assert(webhookRes.success, 'Webhook processed successfully');

info('Fetching entitlement after webhook...');
const proEnt = await api.getEntitlement();
assertEqual(proEnt.data.data.planStatus, 'pro', 'User upgraded to Pro');
assertEqual(proEnt.data.data.permissions.canCreateBills, true, 'Can create bills');
assertEqual(proEnt.data.data.limits.customerWritesPerDay, null, 'Unlimited writes');

pass('Webhook Pro activation successful');
```

---

## **IMPLEMENTATION CHECKLIST**

### **Backend Files to Create/Modify:**

- [ ] `src/routes/webhook.routes.js` (NEW)
- [ ] `src/controllers/webhook.controller.js` (NEW)
- [ ] `src/utils/razorpayWebhook.js` (NEW - signature verification)
- [ ] `src/routes/ops.routes.js` (NEW)
- [ ] `src/controllers/ops.controller.js` (NEW - manual activation)
- [ ] `server.js` or `app.js` (mount webhook routes)
- [ ] `scripts/verify-entitlement-rules.js` (extend)
- [ ] `.env.example` (add webhook secret)

### **Environment Variables:**

```env
# Razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxx

# Pro Plan
PRO_MONTHLY_PRICE=29900  # ₹299 in paise

# Ops Safety
ADMIN_SECRET=xxxxxxxxxxxxxxxxxxxx
```

---

## **FRONTEND (WEBSITE) CONTRACT**

### **Checkout Creation (Website Only):**

When creating Razorpay order on website:
```javascript
const order = await razorpay.orders.create({
  amount: 29900, // ₹299 in paise
  currency: 'INR',
  notes: {
    userId: user._id.toString(), // CRITICAL: Pass user ID
    email: user.email,
    phone: user.mobile,
  },
});
```

**CRITICAL:** `notes.userId` MUST be MongoDB User ID (not email, not phone)

---

## **MOBILE APP CHANGES**

**Answer:** ✅ **ZERO**

Mobile app only:
1. Reads entitlement via `GET /api/v1/auth/me/entitlement`
2. Shows "Go Pro" button that opens website URL
3. After payment on website → User returns to app → Entitlement refreshes → Pro status reflected

---

## **SECURITY CONSIDERATIONS**

1. ✅ **Signature Verification:** MANDATORY on all webhooks
2. ✅ **HTTPS Only:** Webhooks must use HTTPS
3. ✅ **Idempotency:** Prevent duplicate activations
4. ✅ **Rate Limiting:** Not needed (Razorpay controls retry)
5. ✅ **Audit Logging:** Store full webhook payload
6. ✅ **Timing-Safe Comparison:** Prevent timing attacks

---

## **DEPLOYMENT CHECKLIST**

1. [ ] Add `RAZORPAY_WEBHOOK_SECRET` to production env
2. [ ] Configure Razorpay webhook URL: `https://api.yourdomain.com/webhooks/razorpay`
3. [ ] Enable only `payment.captured` event in Razorpay dashboard
4. [ ] Test webhook with Razorpay test mode
5. [ ] Verify signature verification works
6. [ ] Monitor webhook logs for failures

---

## **SUMMARY**

**Current State:**
- ✅ Subscription model complete
- ✅ User model complete
- ✅ Entitlement system complete

**To Implement:**
- 🔧 Webhook endpoint (signature verification + activation)
- 🔧 Ops manual activation endpoint
- 🔧 Verification script extension

**No Changes Needed:**
- ✅ Mobile app (read-only)
- ✅ Database schema (complete)
- ✅ Entitlement logic (sealed)

---

**NEXT:** Implement webhook controller + signature verification
