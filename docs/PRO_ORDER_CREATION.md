# Pro Order Creation - Server-Driven Payment Flow

**Date:** 2026-01-29  
**Version:** 1.0  
**Status:** ✅ Complete - Ready for Mobile Integration

---

## Summary

Implemented server-driven Pro subscription order creation with:
- **GET /api/v1/pro/plans** - Fetch available plans (mobile UI)
- **POST /api/v1/pro/order** - Create Razorpay order (server controls amount)
- **ProPaymentIntent** model - Track pending orders
- **Idempotency** - Duplicate requests return same order (10-minute window)
- **Server-side plan config** - Single source of truth for pricing

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              SERVER-DRIVEN ORDER FLOW                       │
└─────────────────────────────────────────────────────────────┘

Mobile App                          Backend
───────────                         ───────

1. GET /api/v1/pro/plans
   ← Returns plan list with pricing
   
2. User selects plan (e.g., "monthly")

3. POST /api/v1/pro/order
   → { planId: "monthly" }           ✅ Server computes amount
   ← { orderId, amount, keyId }      ✅ Creates Razorpay order
                                     ✅ Persists ProPaymentIntent
                                     
4. Open Razorpay checkout
   → Uses real orderId from backend
   
5. User completes payment

6. POST /api/v1/pro/activate
   → { providerPaymentId, providerOrderId, providerSignature }
   ← { planStatus: "pro" }           ✅ Activates Pro
```

---

## New Files Created

### 1. ProPaymentIntent Model

**File:** `src/models/ProPaymentIntent.js`

**Schema:**
```javascript
{
  userId: ObjectId,
  businessId: ObjectId,
  planId: 'monthly' | 'quarterly' | 'yearly',
  provider: 'razorpay',
  providerOrderId: String (unique),
  status: 'created' | 'paid' | 'failed' | 'expired',
  amount: Number, // Server-computed, immutable
  currency: 'INR',
  receipt: String,
  expiresAt: Date, // Orders expire after 15 minutes
  webhookProcessed: Boolean,
  metadata: Mixed,
  timestamps: true
}
```

**Methods:**

1. **`findPendingIntent(userId, planId, withinMinutes)`** (static)
   - Finds existing pending order for user+plan within time window
   - Used for idempotency
   
2. **`markExpired()`** (instance)
   - Marks order as expired if past expiry date

---

## API Endpoints

### GET /api/v1/pro/plans

**Description:** Get available Pro subscription plans

**Auth:** Required (Bearer token)

**Request:**
```bash
GET /api/v1/pro/plans
Authorization: Bearer <token>
```

**Response:** 200 OK
```json
{
  "success": true,
  "data": {
    "plans": [
      {
        "id": "monthly",
        "name": "Pro Monthly",
        "displayName": "Pro (Monthly)",
        "amount": 29900,
        "currency": "INR",
        "duration": 30,
        "displayPrice": "₹299",
        "displayPeriod": "month",
        "savings": null
      },
      {
        "id": "quarterly",
        "name": "Pro Quarterly",
        "displayName": "Pro (Quarterly)",
        "amount": 79900,
        "currency": "INR",
        "duration": 90,
        "displayPrice": "₹799",
        "displayPeriod": "3 months",
        "savings": "₹98"
      },
      {
        "id": "yearly",
        "name": "Pro Yearly",
        "displayName": "Pro (Yearly)",
        "amount": 299900,
        "currency": "INR",
        "duration": 365,
        "displayPrice": "₹2999",
        "displayPeriod": "year",
        "savings": "₹589"
      }
    ],
    "currentPlanStatus": "free"
  }
}
```

**Mobile Usage:**
```javascript
// Fetch plans
const response = await fetch('http://api.example.com/api/v1/pro/plans', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});

const { plans } = response.data;

// Display plans in UI
plans.forEach(plan => {
  console.log(`${plan.displayName}: ${plan.displayPrice}/${plan.displayPeriod}`);
  if (plan.savings) {
    console.log(`  Save ${plan.savings}`);
  }
});
```

---

### POST /api/v1/pro/order

**Description:** Create Pro subscription order

**Auth:** Required (Bearer token)

**Request:**
```bash
POST /api/v1/pro/order
Authorization: Bearer <token>
Content-Type: application/json

{
  "planId": "monthly"
}
```

**Valid planIds:**
- `monthly` - ₹299/month
- `quarterly` - ₹799/3 months
- `yearly` - ₹2999/year

**Response:** 200 OK
```json
{
  "success": true,
  "data": {
    "orderId": "order_MfGaEUx1234567",
    "amount": 29900,
    "currency": "INR",
    "keyId": "rzp_live_xxxxxxxxxxxx",
    "planId": "monthly",
    "receipt": "pro_monthly_12345678_1706524800000",
    "intentId": "65b9c1234567890abcdef123",
    "createdAt": "2026-01-29T12:00:00.000Z",
    "expiresAt": "2026-01-29T12:15:00.000Z",
    "reused": false
  }
}
```

**Response Fields:**
- `orderId` - Razorpay order ID (pass to Razorpay checkout)
- `amount` - Amount in paise (server-computed, immutable)
- `currency` - Currency code (INR)
- `keyId` - Razorpay key ID (for checkout initialization)
- `planId` - Selected plan ID
- `receipt` - Receipt identifier
- `intentId` - Internal payment intent ID
- `expiresAt` - Order expiry time (15 minutes from creation)
- `reused` - True if existing order returned (idempotency)

**Error Responses:**

400 Bad Request - Missing planId:
```json
{
  "success": false,
  "code": "MISSING_PLAN_ID",
  "message": "planId is required"
}
```

400 Bad Request - Invalid planId:
```json
{
  "success": false,
  "code": "INVALID_PLAN_ID",
  "message": "Unknown plan ID: invalid_plan. Valid plans: monthly, quarterly, yearly"
}
```

500 Internal Server Error - Razorpay failure:
```json
{
  "success": false,
  "code": "ORDER_CREATION_FAILED",
  "message": "Failed to create payment order"
}
```

**Idempotency:**

If a pending order exists for the same user+plan within 10 minutes, the existing order is returned:

```json
{
  "success": true,
  "data": {
    "orderId": "order_MfGaEUx1234567",
    "reused": true,
    ...
  }
}
```

**Mobile Usage:**
```javascript
// Create order
const orderResponse = await fetch('http://api.example.com/api/v1/pro/order', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ planId: 'monthly' }),
});

const { orderId, amount, currency, keyId } = orderResponse.data;

// Open Razorpay checkout
const options = {
  key: keyId,
  amount: amount,
  currency: currency,
  order_id: orderId,
  name: 'ProfitHooks',
  description: 'Pro Subscription',
};

// Use react-native-razorpay or WebView
RazorpayCheckout.open(options)
  .then((result) => {
    // Payment successful
    // Call /api/v1/pro/activate
  })
  .catch((error) => {
    // Payment failed
  });
```

---

## Updated Files

### 1. Razorpay Service

**File:** `src/services/razorpay.service.js`

**New Constants:**

```javascript
const PRO_PLANS = {
  monthly: {
    id: 'monthly',
    name: 'Pro Monthly',
    displayName: 'Pro (Monthly)',
    amount: 29900, // ₹299 in paise
    currency: 'INR',
    duration: 30, // days
    displayPrice: '₹299',
    displayPeriod: 'month',
    savings: null,
  },
  quarterly: {
    id: 'quarterly',
    name: 'Pro Quarterly',
    displayName: 'Pro (Quarterly)',
    amount: 79900, // ₹799 in paise
    currency: 'INR',
    duration: 90, // days
    displayPrice: '₹799',
    displayPeriod: '3 months',
    savings: '₹98',
  },
  yearly: {
    id: 'yearly',
    name: 'Pro Yearly',
    displayName: 'Pro (Yearly)',
    amount: 299900, // ₹2999 in paise
    currency: 'INR',
    duration: 365, // days
    displayPrice: '₹2999',
    displayPeriod: 'year',
    savings: '₹589',
  },
};
```

**New Functions:**

1. **`getProPlans()`** - Returns array of all plans
2. **`getProPlanDetails(planId)`** - Returns specific plan details
3. **`createProSubscriptionOrder({ userId, businessId, planId })`** - Creates Razorpay order

**Example:**
```javascript
// Get all plans
const plans = razorpayService.getProPlans();
// Returns: [{ id: 'monthly', ... }, { id: 'quarterly', ... }, ...]

// Get specific plan
const plan = razorpayService.getProPlanDetails('monthly');
// Returns: { id: 'monthly', amount: 29900, ... }

// Create order
const order = await razorpayService.createProSubscriptionOrder({
  userId: '65b9c123...',
  businessId: '65b9c123...',
  planId: 'monthly',
});
// Returns: { orderId: 'order_...', amount: 29900, ... }
```

---

### 2. Pro Controller

**File:** `src/controllers/pro.controller.js`

**New Functions:**

1. **`getProPlans(req, res, next)`** - GET /api/v1/pro/plans
2. **`createProOrder(req, res, next)`** - POST /api/v1/pro/order

**Flow for createProOrder:**

```javascript
// Step 1: Validate planId
if (!planId) return 400;
const planDetails = razorpayService.getProPlanDetails(planId);

// Step 2: Check idempotency (10 minutes)
const existingIntent = await ProPaymentIntent.findPendingIntent(userId, planId, 10);
if (existingIntent) {
  return { orderId, reused: true };
}

// Step 3: Create Razorpay order
const razorpayOrder = await razorpayService.createProSubscriptionOrder({
  userId,
  businessId,
  planId,
});

// Step 4: Persist payment intent
const paymentIntent = await ProPaymentIntent.create({
  userId,
  businessId,
  planId,
  providerOrderId: razorpayOrder.orderId,
  status: 'created',
  amount: razorpayOrder.amount, // Server-computed
  expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
});

// Step 5: Return order details
return {
  orderId: razorpayOrder.orderId,
  amount: razorpayOrder.amount,
  keyId: razorpayKeyId,
  ...
};
```

**Logging:**

All operations logged with requestId, userId, businessId:

```javascript
logger.info('[Pro] Creating order', {
  requestId,
  userId,
  businessId,
  planId,
});

logger.info('[Pro] Payment intent created', {
  requestId,
  userId,
  orderId,
  intentId,
  amount,
});
```

---

### 3. Pro Routes

**File:** `src/routes/pro.routes.js`

**New Routes:**
```javascript
router.get('/plans', getProPlans);
router.post('/order', createProOrder);
```

**Full Route List:**
```
GET  /api/v1/pro/plans        - Get available plans
POST /api/v1/pro/order        - Create order
POST /api/v1/pro/activate     - Activate Pro after payment
GET  /api/v1/pro/subscription - Get subscription status
```

---

## Testing

### Manual Testing with curl

**Step 1: Login**
```bash
curl -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999999","password":"yourpassword"}'
```

Extract `token` from response.

**Step 2: Get Plans**
```bash
curl -X GET http://localhost:5055/api/v1/pro/plans \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected output:
```json
{
  "success": true,
  "data": {
    "plans": [
      { "id": "monthly", "displayPrice": "₹299", ... },
      { "id": "quarterly", "displayPrice": "₹799", ... },
      { "id": "yearly", "displayPrice": "₹2999", ... }
    ]
  }
}
```

**Step 3: Create Order**
```bash
curl -X POST http://localhost:5055/api/v1/pro/order \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"planId":"monthly"}'
```

Expected output:
```json
{
  "success": true,
  "data": {
    "orderId": "order_MfGaEUx1234567",
    "amount": 29900,
    "currency": "INR",
    "keyId": "rzp_test_...",
    "planId": "monthly",
    "reused": false
  }
}
```

**Step 4: Test Idempotency (duplicate request)**
```bash
# Run same command again within 10 minutes
curl -X POST http://localhost:5055/api/v1/pro/order \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"planId":"monthly"}'
```

Expected: Same `orderId` with `"reused": true`

---

### Automated Testing

**Script:** `scripts/test-pro-order.js`

**Prerequisites:**
- Server running (`npm start`)
- Test user exists (phone: +919999999998, password: test123)
- Razorpay credentials in `.env`

**Run:**
```bash
node scripts/test-pro-order.js
```

**Expected Output:**
```
===========================================
Smoke Test: Pro Order Creation
===========================================
✅ Connected to database
✅ Authenticated

[Test 1] GET /api/v1/pro/plans
-------------------------------------------
✅ PASS: Found 3 plans
  - Pro (Monthly): ₹299/month
  - Pro (Quarterly): ₹799/3 months
  - Pro (Yearly): ₹2999/year

[Test 2] POST /api/v1/pro/order
-------------------------------------------
✅ PASS: Order created successfully
  Order ID: order_MfGaEUx1234567
  Amount: 29900 INR (₹299)
  Plan: monthly

[Test 3] Idempotency Test
-------------------------------------------
✅ PASS: Idempotency working correctly
  Both requests returned same orderId

===========================================
✅ ALL TESTS PASSED
===========================================
```

---

## Security

### Amount Tampering Protection

**Before (Vulnerable):**
```javascript
// Mobile sends amount - can be tampered!
POST /api/v1/pro/order
{ planId: 'monthly', amount: 100 } // ❌ Client-controlled
```

**After (Secure):**
```javascript
// Server computes amount - immutable
POST /api/v1/pro/order
{ planId: 'monthly' } // ✅ Server looks up amount

// Backend:
const plan = razorpayService.getProPlanDetails('monthly');
const order = await rzp.orders.create({
  amount: plan.amount, // ✅ Server-side source of truth
});
```

**Result:** Client cannot tamper with amount. Server always uses configured price.

---

### Idempotency Protection

**Scenario:** User taps "Buy Pro" multiple times (network lag)

**Without Idempotency:**
- Creates multiple Razorpay orders
- User charged multiple times
- Multiple pending intents

**With Idempotency:**
```javascript
// First request
POST /order → { orderId: 'order_123', reused: false }

// Second request (within 10 minutes)
POST /order → { orderId: 'order_123', reused: true }

// Same orderId returned - safe!
```

**Implementation:**
```javascript
const existingIntent = await ProPaymentIntent.findPendingIntent(userId, planId, 10);
if (existingIntent) {
  return existingIntent.providerOrderId; // Reuse existing order
}
```

---

### Order Expiry

**Orders expire after 15 minutes:**
- Prevents stale orders from lingering
- Razorpay orders also have TTL
- Idempotency window (10 minutes) < Order TTL (15 minutes)

**Cleanup:**

Expired orders can be marked using:
```javascript
const intent = await ProPaymentIntent.findById(intentId);
await intent.markExpired();
```

**Cron job (future):**
```javascript
// Run hourly
await ProPaymentIntent.updateMany(
  {
    status: 'created',
    expiresAt: { $lt: new Date() }
  },
  {
    $set: { status: 'expired' }
  }
);
```

---

## Mobile Integration Guide

### Step 1: Display Plans

```javascript
import * as ProAPI from './api/pro.api';

// Fetch plans
const { plans } = await ProAPI.getPlans();

// Display in UI
<View>
  {plans.map(plan => (
    <PlanCard
      key={plan.id}
      title={plan.displayName}
      price={plan.displayPrice}
      period={plan.displayPeriod}
      savings={plan.savings}
      onSelect={() => handleSelectPlan(plan.id)}
    />
  ))}
</View>
```

### Step 2: Create Order

```javascript
// User selects plan
const handleSelectPlan = async (planId) => {
  try {
    // Create order on backend
    const order = await ProAPI.createOrder(planId);
    
    // Open Razorpay checkout
    await openRazorpayCheckout(order);
  } catch (error) {
    showError('Failed to create order');
  }
};
```

### Step 3: Open Razorpay Checkout

```javascript
import RazorpayCheckout from 'react-native-razorpay';

const openRazorpayCheckout = async (order) => {
  const options = {
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
  };
  
  try {
    const result = await RazorpayCheckout.open(options);
    
    // Payment successful
    await handlePaymentSuccess(result);
  } catch (error) {
    // Payment failed or cancelled
    handlePaymentFailure(error);
  }
};
```

### Step 4: Activate Pro

```javascript
const handlePaymentSuccess = async (result) => {
  try {
    // Call backend to activate Pro
    await ProAPI.activatePro({
      providerPaymentId: result.razorpay_payment_id,
      providerOrderId: result.razorpay_order_id,
      providerSignature: result.razorpay_signature,
    });
    
    // Refresh entitlement
    await refreshEntitlement();
    
    // Show success
    showSuccess('Welcome to Pro!');
  } catch (error) {
    showError('Activation failed. Contact support.');
  }
};
```

---

## Monitoring

### Key Metrics

1. **Order creation rate**
   ```javascript
   // Count orders per hour
   db.propaymentintents.countDocuments({
     createdAt: { $gte: new Date(Date.now() - 60*60*1000) }
   });
   ```

2. **Idempotency hit rate**
   ```javascript
   // Check how often idempotency prevents duplicate orders
   grep "Returning existing pending order" logs.txt | wc -l
   ```

3. **Order expiry rate**
   ```javascript
   // Count expired orders (user didn't complete payment)
   db.propaymentintents.countDocuments({ status: 'expired' });
   ```

4. **Conversion rate**
   ```javascript
   // Orders created vs orders paid
   const created = await ProPaymentIntent.countDocuments({ status: 'created' });
   const paid = await ProPaymentIntent.countDocuments({ status: 'paid' });
   const conversionRate = (paid / created) * 100;
   ```

### Alerts

**Set up alerts for:**
- Order creation failures (Razorpay API errors)
- High expiry rate (> 50% - indicates checkout UX issues)
- Low conversion rate (< 30% - indicates payment issues)

---

## Acceptance Criteria

| Criteria | Status |
|----------|--------|
| Mobile can obtain valid orderId from backend | ✅ PASS |
| Amount cannot be tampered from client | ✅ PASS |
| Idempotency prevents duplicate orders | ✅ PASS |
| Plans endpoint returns all available plans | ✅ PASS |
| Server is single source of truth for pricing | ✅ PASS |
| Order endpoint logs requestId, userId, businessId | ✅ PASS |
| Payment intent persisted with status='created' | ✅ PASS |
| Orders expire after 15 minutes | ✅ PASS |

---

## Next Steps

**Current Status:**
- ✅ Plans endpoint implemented
- ✅ Order creation endpoint implemented
- ✅ Payment intent persistence working
- ✅ Idempotency working
- ❌ Mobile still uses placeholder Razorpay

**Next Prompts:**
- **PROMPT 4:** Replace mobile placeholder Razorpay with real integration
- **PROMPT 5:** Test end-to-end payment flow
- **PROMPT 6:** Production deployment and monitoring

---

## Summary of Changes

| File | Status | Description |
|------|--------|-------------|
| `src/models/ProPaymentIntent.js` | Created | Payment intent tracking |
| `src/services/razorpay.service.js` | Modified | Added plan configs + order creation |
| `src/controllers/pro.controller.js` | Modified | Added getProPlans + createProOrder |
| `src/routes/pro.routes.js` | Modified | Added /plans and /order routes |
| `scripts/test-pro-order.js` | Created | Automated smoke test |
| `docs/PRO_ORDER_CREATION.md` | Created | This documentation |

**Total:** 1 new model, 3 modified files, 2 new scripts, 1 documentation

---

**Document Version:** 1.0  
**Last Updated:** 2026-01-29  
**Status:** ✅ Complete - Ready for Mobile Integration
