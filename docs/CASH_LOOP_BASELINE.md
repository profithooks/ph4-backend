# Cash Loop Baseline - Pro Subscription Purchase Flow Audit

**Date:** 2026-01-29  
**Version:** 1.0  
**Status:** 🔍 Audit Complete - Gaps Identified

---

## Executive Summary

This document provides a comprehensive audit of the Pro subscription purchase flow, identifying what exists, what's missing, and the critical gaps preventing a production-ready payment pipeline.

### Current State: ⚠️ INCOMPLETE

- ✅ **Webhook infrastructure exists** (mounted, signature verification working)
- ✅ **Pro activation endpoint exists** (POST /api/v1/pro/activate)
- ✅ **Entitlement system exists** (trial/free/pro lifecycle)
- ✅ **requirePro middleware exists** (gates Pro-only features)
- ❌ **NO ORDER CREATION ENDPOINT** ← Critical Gap #1
- ❌ **Mobile uses placeholder Razorpay** ← Critical Gap #2
- ❌ **No server-driven order flow** ← Critical Gap #3

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PAYMENT PIPELINE                             │
└─────────────────────────────────────────────────────────────────────┘

Mobile App                          Backend
───────────                         ───────

1. User taps "Go Pro"
   ↓
2. [MISSING] POST /pro/create-order ❌ DOES NOT EXIST
   ← Should return: { orderId, amount, keyId }
   
3. [PLACEHOLDER] Opens Razorpay      ✅ Webhook mounted
   → Currently mocks payment          ✅ Signature verification
   → Should use real orderId          ✅ Pro activation endpoint
   
4. [MOCK] Payment completes          ❌ No real order created
   ← razorpay_payment_id (mock)      ❌ Webhook won't match order
   ← razorpay_order_id (mock)
   ← razorpay_signature (mock)
   
5. POST /pro/activate
   → Sends mock payment details
   → Backend accepts but can't verify ❌ No real payment occurred
   → Sets planStatus = 'pro'
   → Creates Subscription record
   
6. User gets Pro features
   ✅ requirePro allows access
   ✅ Entitlement shows Pro
   ✅ Daily write limit removed
```

---

## File Inventory

### 1. Backend Routes

#### Pro Plan Routes
**File:** `src/routes/pro.routes.js`

```javascript
// Mounted at: /api/v1/pro

✅ POST /activate - Activate Pro after payment
✅ GET /subscription - Get subscription status

❌ MISSING: POST /create-order - Create Razorpay order
❌ MISSING: POST /verify-payment - Verify payment before activation
```

**Mount Location:** `src/app.js` line 113
```javascript
app.use('/api/v1/pro', proRoutes); // ✅ Mounted
```

#### Webhook Routes
**File:** `src/routes/webhook.routes.js`

```javascript
// Mounted at: /webhooks

✅ POST /razorpay - Handle payment webhooks
```

**Mount Location:** `src/app.js` line 153
```javascript
app.use('/webhooks', webhookRoutes); // ✅ Mounted
```

**Raw Body Middleware:** `src/app.js` lines 78-86
```javascript
✅ Applied BEFORE express.json() (correct!)
✅ Stores req.rawBody for signature verification
✅ Webhook signature verification working
```

---

### 2. Backend Controllers

#### Pro Controller
**File:** `src/controllers/pro.controller.js`

**Functions:**

1. **`activatePro`** - POST /api/v1/pro/activate ✅
   - **Input:** `{ providerPaymentId, providerOrderId, providerSignature, planId }`
   - **Process:**
     - ✅ Verifies payment signature
     - ✅ Checks for duplicate payment (idempotency)
     - ✅ Gets plan details (₹299/month)
     - ✅ Calculates expiry date (+30 days)
     - ✅ Creates Subscription record
     - ✅ Updates User.planStatus = 'pro'
   - **Output:** `{ planStatus, planActivatedAt, subscriptionId, expiresAt }`
   - **Logs:** `[Pro] Subscription created`, `[Pro] User upgraded to Pro`
   
   **Issue:** Expects orderId from mobile, but mobile generates fake orderId

2. **`getSubscription`** - GET /api/v1/pro/subscription ✅
   - **Input:** None (authenticated user)
   - **Output:** Subscription status, expiry, days remaining
   - **Works correctly**

**Missing Functions:**
```javascript
❌ createProOrder() - Should create Razorpay order BEFORE checkout
   Input:  { planId, userId }
   Output: { orderId, amount, currency, keyId }
   
❌ verifyPayment() - Should verify payment AFTER checkout
   Input:  { orderId, paymentId, signature }
   Output: { verified: boolean, paymentDetails }
```

#### Webhook Controller
**File:** `src/controllers/webhook.controller.js`

**Functions:**

1. **`handleRazorpayWebhook`** - POST /webhooks/razorpay ✅
   - **Security:**
     - ✅ Verifies signature using `req.rawBody`
     - ✅ Parses JSON after verification
     - ✅ Uses `RAZORPAY_WEBHOOK_SECRET`
   - **Events Supported:**
     - ✅ `payment.captured` (subscription + bill payments)
     - ✅ `subscription.activated`
   - **Routing:**
     - ✅ Checks `notes.type === 'bill_payment'` → `handleBillPaymentCaptured`
     - ✅ Otherwise → `handlePaymentCaptured` (Pro subscription)
   
2. **`handlePaymentCaptured`** - Subscription payment ✅
   - **Process:**
     - ✅ Extracts payment details from webhook
     - ✅ Validates required fields (paymentId, orderId, userId)
     - ✅ Checks idempotency (duplicate detection)
     - ✅ Finds User by userId (from notes)
     - ✅ Updates User.planStatus = 'pro'
     - ✅ Creates Subscription record
     - ✅ Logs all steps
   - **Security:** ✅ Production-ready
   
   **Issue:** Webhook expects `notes.userId`, but if mobile generates fake order, webhook won't trigger

3. **`handleBillPaymentCaptured`** - Bill payment ✅
   - **Process:** Updates Bill, creates Payment record, updates ledger
   - **Works correctly** for bill payments

#### Entitlement Controller
**File:** `src/controllers/entitlement.controller.js`

**Function:** `getEntitlement` - GET /api/v1/auth/me/entitlement ✅

**Process:**
- ✅ Migrates missing trialEndsAt for existing users
- ✅ Resets daily write counter (IST timezone)
- ✅ Checks trial expiry and downgrades to free if needed
- ✅ Calculates permissions (canCreateBills, canCreateCustomerWrites, canViewBills)
- ✅ Calculates limits (customerWritesPerDay, remaining count)
- ✅ Gets Pro subscription expiry info if Pro user
- ✅ Returns comprehensive entitlement contract

**Logs:**
- `[Entitlement] Migrated trial for new user`
- `[Entitlement] Trial expired for user, downgraded to free`

**Plan Status Logic:**
- **trial:** Unlimited writes, can create bills
- **pro:** Unlimited writes, can create bills
- **free:** 10 writes/day, cannot create bills (requirePro blocks)

---

### 3. Backend Services

#### Razorpay Service
**File:** `src/services/razorpay.service.js`

**Functions:**

1. **`verifyPaymentSignature`** ✅
   - **Input:** `(orderId, paymentId, signature, secret)`
   - **Output:** `boolean`
   - **Algorithm:** HMAC SHA256 of `orderId|paymentId`
   - **Used by:** pro.controller.js (activatePro)

2. **`getPlanDetails`** ✅
   - **Input:** `planId` (e.g., 'ph4_pro_monthly')
   - **Output:** `{ id, name, amount: 29900, currency: 'INR', duration: 30 }`
   - **Used by:** pro.controller.js, mobile razorpay.service.js

3. **`calculateExpiryDate`** ✅
   - **Input:** `planId`
   - **Output:** `Date` (+30 days from now)
   - **Used by:** pro.controller.js

4. **`createBillPaymentOrder`** ✅
   - **Input:** Bill details
   - **Output:** Razorpay order for bill payment
   - **Works for:** Bill payments only

5. **`getRazorpayInstance`** ✅
   - **Returns:** Initialized Razorpay SDK instance
   - **Config:** Uses `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`

**Missing Functions:**
```javascript
❌ createProSubscriptionOrder() - Should create order for Pro subscription
   Input:  { userId, planId }
   Output: { orderId, amount, currency, keyId, receipt }
   
   Should:
   - Get plan details
   - Create Razorpay order via SDK
   - Store order metadata (userId in notes)
   - Return order details for checkout
```

#### Razorpay Webhook Utilities
**File:** `src/utils/razorpayWebhook.js`

**Functions:**

1. **`verifyWebhookSignature`** ✅
   - **Input:** `(rawBody, signature, secret)`
   - **Output:** `boolean`
   - **Algorithm:** HMAC SHA256 with timing-safe comparison
   - **Security:** Production-ready

2. **`extractPaymentDetails`** ✅
   - **Input:** Webhook payload
   - **Output:** Structured payment details
   - **Supports:** `payment.captured`, `subscription.activated`

3. **`validatePaymentDetails`** ✅
   - **Input:** Payment details
   - **Output:** `{ valid: boolean, missing: [] }`
   - **Checks:** paymentId, orderId, amount, userId

---

### 4. Backend Models

#### User Model
**File:** `src/models/User.js`

**Plan Status Field:**
```javascript
planStatus: {
  type: String,
  enum: ['trial', 'free', 'pro'],
  default: 'trial',
  index: true
}
```

**Methods:**

1. **`ensureDailyWriteCounter()`** ✅
   - Resets `dailyWriteCount` at IST midnight
   - Uses `getISTDateString()` from timezone.util.js

2. **`canWrite()`** ✅
   - **trial:** Returns `{ allowed: true }` (unlimited)
   - **pro:** Returns `{ allowed: true }` (unlimited)
   - **free:** Checks `dailyWriteCount < 10`
     - If exceeded: `{ allowed: false, reason: 'Daily limit reached', limit: 10, resetAt }`

#### Subscription Model
**File:** `src/models/Subscription.js`

**Schema:**
```javascript
{
  userId: ObjectId,
  planId: 'ph4_pro_monthly',
  provider: 'razorpay' | 'manual',
  status: 'active' | 'cancelled' | 'expired',
  startedAt: Date,
  expiresAt: Date,
  providerPaymentId: String (unique),
  providerOrderId: String,
  providerSignature: String,
  amountPaid: Number,
  currency: 'INR',
  metadata: Mixed
}
```

**Methods:**

1. **`findActiveByUserId(userId)`** ✅
   - Finds active subscription (status=active, expiresAt > now)

2. **`checkAndMarkExpired()`** ✅
   - Marks expired subscriptions as 'expired'

3. **`getExpiryInfo(userId)`** ✅
   - Returns expiry date, days left, isExpiring flag

#### Payment Model
**File:** `src/models/Payment.js`

**Schema:**
```javascript
{
  billId: ObjectId,
  userId: ObjectId,
  businessId: ObjectId,
  provider: 'razorpay' | 'manual',
  providerOrderId: String (unique),
  providerPaymentId: String,
  status: 'pending' | 'captured' | 'failed' | 'refunded',
  amount: Number,
  currency: 'INR',
  method: 'card' | 'netbanking' | 'upi' | 'wallet',
  webhookProcessed: Boolean,
  metadata: Mixed
}
```

**Usage:** Bill payments only (not subscriptions)

---

### 5. Backend Middleware

#### requirePro Middleware
**File:** `src/middleware/requirePro.middleware.js`

**Function:** `requirePro(req, res, next)` ✅

**Logic:**
```javascript
if (req.user.planStatus === 'pro')   → Allow
if (req.user.planStatus === 'trial') → Allow (Pro features included)
if (req.user.planStatus === 'free')  → Block (403 PRO_REQUIRED)
else                                 → Block (403 INVALID_PLAN_STATUS)
```

**Used On:**
- `POST /api/bills` - Create bill
- `PATCH /api/bills/:id/pay` - Add payment
- `PATCH /api/bills/:id/cancel` - Cancel bill
- `PATCH /api/bills/:id/dispute` - Mark disputed
- `PATCH /api/bills/:id/dispute/resolve` - Resolve dispute
- `PATCH /api/bills/:id/recovery/pause` - Pause recovery
- `PATCH /api/bills/:id/recovery/resume` - Resume recovery
- `DELETE /api/bills/:id` - Delete bill

**Logs:**
- `[RequirePro] Pro user {userId} allowed`
- `[RequirePro] Trial user {userId} allowed`
- `[RequirePro] Free user {userId} blocked`

**Response Format:**
```json
{
  "success": false,
  "code": "PRO_REQUIRED",
  "message": "This feature requires a Pro plan",
  "meta": {
    "planStatus": "free",
    "feature": "pro_feature",
    "upgradeUrl": "/pro/upgrade"
  }
}
```

---

### 6. Mobile Implementation

#### Razorpay Service (Mobile)
**File:** `ph4/src/services/razorpay.service.js`

**Status:** ⚠️ PLACEHOLDER IMPLEMENTATION

**Functions:**

1. **`openCheckout(options)`** ❌ MOCK
   - **Current:** Simulates payment with setTimeout(2000ms)
   - **Returns:** Mock payment result
     ```javascript
     {
       razorpay_payment_id: 'pay_mock_123',
       razorpay_order_id: orderId, // Uses passed-in orderId
       razorpay_signature: 'mock_signature_123'
     }
     ```
   - **Should:**
     - Accept real `orderId` from backend
     - Open real Razorpay checkout
     - Return real payment details
   
   **Commented Code Hints:**
   ```javascript
   // Approach 1: react-native-razorpay (requires installation)
   // Approach 2: WebView checkout (custom implementation)
   // Approach 3: External browser (for testing)
   ```

2. **`getPlanDetails(planId)`** ✅
   - Returns: `{ id, name, amount: 29900, currency: 'INR', displayPrice: '₹299' }`
   - **Matches backend:** Yes

3. **`formatAmount(amountInPaise)`** ✅
   - Converts paise to rupees with locale formatting

#### GoProBottomSheet (Mobile)
**File:** `ph4/src/components/sheets/GoProBottomSheet.js`

**Status:** ⚠️ USES PLACEHOLDER ORDER ID

**Flow:**
```javascript
handleUpgrade = async () => {
  // 1. Get plan details
  const plan = RazorpayService.getPlanDetails('ph4_pro_monthly');
  
  // 2. ❌ FAKE ORDER ID - Backend should generate this
  orderId: `order_${Date.now()}`, // Placeholder
  
  // 3. Open Razorpay checkout (currently mocked)
  await RazorpayService.openCheckout({
    orderId,
    amount: plan.amount,
    currency: plan.currency,
    onSuccess: async (result) => {
      // 4. Call backend activation
      await EntitlementAPI.activatePro({
        providerPaymentId: result.razorpay_payment_id,
        providerOrderId: result.razorpay_order_id,
        providerSignature: result.razorpay_signature,
      });
      
      // 5. Refresh entitlement
      onUpgradeSuccess();
    }
  });
}
```

**Issues:**
- ❌ Generates fake orderId locally
- ❌ Backend never sees order creation
- ❌ Webhook won't match fake order
- ❌ Payment can't be verified

**Should Be:**
```javascript
handleUpgrade = async () => {
  // 1. Create order on backend
  const order = await ProAPI.createOrder({ planId: 'ph4_pro_monthly' });
  
  // 2. Open real Razorpay checkout
  await RazorpayService.openCheckout({
    orderId: order.orderId,  // Real order from backend
    amount: order.amount,
    keyId: order.keyId,
    onSuccess: (result) => {
      // 3. Activate Pro (backend verifies payment)
      await ProAPI.activatePro(result);
    }
  });
}
```

---

## Critical Gaps Identified

### Gap #1: No Order Creation Endpoint ❌

**What's Missing:**
```javascript
POST /api/v1/pro/create-order

Request:  { planId: 'ph4_pro_monthly' }
Response: {
  orderId: 'order_MfGaEUx1234567',
  amount: 29900,
  currency: 'INR',
  keyId: 'rzp_live_xxxxxxxxxxxx',
  planDetails: { name, duration }
}
```

**Backend Service Function Missing:**
```javascript
// src/services/razorpay.service.js
async function createProSubscriptionOrder({ userId, planId }) {
  const rzp = getRazorpayInstance();
  const plan = getPlanDetails(planId);
  
  const order = await rzp.orders.create({
    amount: plan.amount,
    currency: plan.currency,
    receipt: `pro_${userId}_${Date.now()}`,
    notes: {
      userId: userId.toString(),
      planId: planId,
      type: 'pro_subscription'
    }
  });
  
  return order;
}
```

**Impact:**
- Mobile generates fake orderId
- No server-side record of order
- Webhook can't match order to user
- Payment verification fails

---

### Gap #2: Mobile Uses Placeholder Razorpay ❌

**Current:** `openCheckout()` mocks payment after 2 seconds

**Should:**
- Install `react-native-razorpay` OR
- Implement WebView-based checkout OR
- Redirect to web checkout page

**Options:**

1. **react-native-razorpay** (Recommended)
   ```bash
   npm install react-native-razorpay
   cd ios && pod install
   ```
   
   ```javascript
   import RazorpayCheckout from 'react-native-razorpay';
   
   RazorpayCheckout.open({
     key: keyId,
     amount: amount,
     currency: currency,
     order_id: orderId,
     name: 'ProfitHooks',
     description: 'Pro Subscription',
     prefill: { name, email, contact }
   })
   .then(onSuccess)
   .catch(onFailure);
   ```

2. **WebView Checkout** (Custom)
   - Create WebView screen
   - Load Razorpay checkout page
   - Listen for success/failure via URL interception

3. **External Browser** (Fallback)
   - Redirect to web checkout on your server
   - Handle callback via deep link

---

### Gap #3: No Server-Driven Order Flow ❌

**Current Flow:**
```
Mobile → [fake orderId] → Razorpay Mock → POST /activate → Pro activated
```

**Issue:** No real payment occurred, but user gets Pro

**Should Be:**
```
1. Mobile  → POST /pro/create-order
2. Backend → Creates Razorpay order → Returns orderId
3. Mobile  → Opens Razorpay checkout with orderId
4. User    → Completes payment
5. Razorpay → Sends webhook → POST /webhooks/razorpay
6. Backend → Verifies payment → Activates Pro
7. Mobile  → Polls /auth/me/entitlement → Shows Pro
```

**Benefits:**
- Server controls order creation
- Payment always verified
- Webhook triggers Pro activation
- Idempotency built-in
- Audit trail complete

---

## Logging & Observability

### Current Logging

**Pro Controller:**
- ✅ `[Pro] Subscription created: {subscriptionId} for user: {userId}`
- ✅ `[Pro] User upgraded to Pro: {userId}`
- ✅ `[Pro] Invalid payment signature for user: {userId}`
- ✅ `[Pro] Duplicate payment attempt: {paymentId}`

**Webhook Controller:**
- ✅ `[Webhook] Received event: {event}`
- ✅ `[Webhook] Invalid signature received`
- ✅ `[Webhook] Payment {paymentId} already processed - idempotent success`
- ✅ `[Webhook] User {userId} upgraded to Pro`

**Entitlement Controller:**
- ✅ `[Entitlement] Migrated trial for new user {userId}: 30 days`
- ✅ `[Entitlement] Trial expired for user {userId}, downgraded to free`

**requirePro Middleware:**
- ✅ `[RequirePro] Pro user {userId} allowed`
- ✅ `[RequirePro] Trial user {userId} allowed`
- ✅ `[RequirePro] Free user {userId} blocked`

### Missing Logging

❌ **Order creation:**
```javascript
logger.info('[Pro] Creating Razorpay order', { userId, planId, requestId });
logger.info('[Pro] Order created', { orderId, userId, amount, requestId });
```

❌ **Payment verification:**
```javascript
logger.info('[Pro] Verifying payment', { orderId, paymentId, userId, requestId });
logger.info('[Pro] Payment verified', { orderId, paymentId, userId, requestId });
```

---

## Security Assessment

### ✅ What's Secure

1. **Webhook Signature Verification**
   - ✅ Raw body preserved for signature
   - ✅ HMAC SHA256 verification
   - ✅ Timing-safe comparison
   - ✅ Secret from environment variable

2. **Payment Signature Verification**
   - ✅ Verifies `orderId|paymentId` signature
   - ✅ Uses Razorpay key secret

3. **Idempotency**
   - ✅ Checks for duplicate payments (by providerPaymentId)
   - ✅ Webhook checks if already processed

4. **Entitlement**
   - ✅ Server is source of truth (req.user.planStatus)
   - ✅ requirePro middleware enforces Pro-only access
   - ✅ Trial expiry handled server-side

### ⚠️ Security Gaps

1. **No Order Validation**
   - ❌ Mobile can pass any orderId to /activate
   - ❌ Backend doesn't verify order exists in Razorpay
   - ❌ Risk: User could activate Pro without paying

2. **Mock Payment Accepted**
   - ❌ Backend accepts mock payment IDs
   - ❌ No verification that payment actually occurred
   - ❌ Risk: Anyone can activate Pro with fake credentials

3. **No Rate Limiting on /activate**
   - ❌ User could spam /activate with fake payments
   - ❌ Should add rate limiting

---

## Environment Variables

### Required

```bash
# Razorpay Credentials (REQUIRED)
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_key_secret_here

# Webhook Secret (REQUIRED for production)
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
```

### Status

- ✅ Documented in `.env.example`
- ✅ Used in `src/config/env.js`
- ✅ Loaded by controllers and services

---

## Next Steps (No Code Changes Yet)

### Phase 1: Backend Order Creation

1. Add `POST /api/v1/pro/create-order` endpoint
2. Implement `createProSubscriptionOrder()` in razorpay.service.js
3. Store order metadata (userId, planId) in Razorpay notes
4. Return orderId, amount, keyId to mobile

### Phase 2: Mobile Real Integration

1. Create `src/api/pro.api.js` with:
   - `createOrder(planId)` → calls backend
   - `activatePro(paymentDetails)` → existing
2. Replace placeholder Razorpay with:
   - Option A: Install react-native-razorpay
   - Option B: WebView checkout
3. Update GoProBottomSheet to:
   - Call `ProAPI.createOrder()` first
   - Pass real orderId to Razorpay
   - Handle real payment result

### Phase 3: Production Hardening

1. Add payment verification endpoint (optional)
2. Add rate limiting to /activate
3. Add order validation (check order exists in Razorpay)
4. Add expiry check (order should be recent)
5. Add comprehensive logging
6. Add monitoring alerts

---

## Appendix: Full Route Map

### Protected Routes (require auth)

```
GET  /api/v1/auth/me/entitlement    → getEntitlement (all users)
POST /api/v1/pro/activate            → activatePro (all users)
GET  /api/v1/pro/subscription        → getSubscription (all users)

❌ MISSING: POST /api/v1/pro/create-order → createProOrder (all users)
```

### Pro-Only Routes (requirePro)

```
POST   /api/bills                     → createBill
PATCH  /api/bills/:id/pay             → addBillPayment
PATCH  /api/bills/:id/cancel          → cancelBill
PATCH  /api/bills/:id/dispute         → markBillDisputed
PATCH  /api/bills/:id/dispute/resolve → resolveBillDispute
PATCH  /api/bills/:id/recovery/pause  → pauseBillRecovery
PATCH  /api/bills/:id/recovery/resume → resumeBillRecovery
DELETE /api/bills/:id                 → deleteBill
```

### Public Routes (no auth)

```
POST /webhooks/razorpay               → handleRazorpayWebhook
GET  /public/b/:token                 → getPublicBill (HTML)
GET  /public/b/:token.json            → getPublicBillJson
POST /public/b/:token/pay/create      → createPublicBillPayment
```

---

**Document Status:** ✅ Complete  
**Audit Date:** 2026-01-29  
**Critical Gaps:** 3 identified  
**Ready for Implementation:** Yes (Phase 1 backend order creation)
