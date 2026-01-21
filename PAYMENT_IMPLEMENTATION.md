# Payment & Pro Plan Activation Implementation

## Overview

PH4 now supports paid Pro subscriptions via Razorpay payment integration. This implementation follows the minimal, safe, and reversible approach outlined in Cursor Prompt #6.

## Backend Changes

### 1. New Subscription Model

**File:** `src/models/Subscription.js`

Tracks Pro plan subscriptions with minimal fields:
- userId (reference to User)
- planId ('ph4_pro_monthly')
- provider ('razorpay')
- status ('active' | 'cancelled' | 'expired')
- startedAt, expiresAt (Date)
- providerPaymentId, providerOrderId, providerSignature
- amountPaid, currency
- metadata (raw provider payload for auditing)

**Key Methods:**
- `findActiveByUserId(userId)` - Find active subscription for a user
- `checkAndMarkExpired()` - Check if subscription is expired and mark it

### 2. Razorpay Service

**File:** `src/services/razorpay.service.js`

Handles payment verification and plan management:
- `verifyPaymentSignature(orderId, paymentId, signature, secret)` - Verify Razorpay signature
- `calculateExpiryDate(planId)` - Calculate subscription expiry (30 days for monthly)
- `getPlanDetails(planId)` - Get plan details (amount, currency, duration)

**Plan Details:**
- Plan ID: `ph4_pro_monthly`
- Amount: ₹299 (29900 paise)
- Duration: 30 days

### 3. Pro Activation Endpoint

**File:** `src/controllers/pro.controller.js`

**Endpoint:** `POST /api/v1/pro/activate`

**Request Body:**
```json
{
  "providerPaymentId": "pay_xxx",
  "providerOrderId": "order_xxx",
  "providerSignature": "signature_xxx",
  "planId": "ph4_pro_monthly"
}
```

**Flow:**
1. Verify payment signature (if Razorpay secret available)
2. Check for duplicate payment
3. Get plan details
4. Calculate expiry date (30 days)
5. Create Subscription record
6. Update User planStatus to 'pro'
7. Return updated entitlement

**Response:**
```json
{
  "success": true,
  "message": "Pro plan activated successfully",
  "data": {
    "planStatus": "pro",
    "planActivatedAt": "2026-01-21T10:00:00Z",
    "subscriptionId": "sub_xxx",
    "expiresAt": "2026-02-20T10:00:00Z"
  }
}
```

### 4. Subscription Status Endpoint

**Endpoint:** `GET /api/v1/pro/subscription`

Returns current subscription details for authenticated user.

### 5. Subscription Expiry Middleware

**File:** `src/middleware/trialExpiry.middleware.js`

Added `checkSubscriptionExpiry` middleware:
- Checks Pro users for active subscription
- If expired or missing, silently downgrades to free
- No notifications, no events

### 6. Environment Variables

**File:** `env.example` (updated)

Added Razorpay configuration:
```
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
```

### 7. Routes

**File:** `src/app.js` (updated)

Mounted Pro routes at `/api/v1/pro`:
- POST `/api/v1/pro/activate`
- GET `/api/v1/pro/subscription`

All routes require authentication and trial expiry check.

## Frontend Changes

### 1. Payment Service

**File:** `src/services/razorpay.service.js`

Handles Razorpay checkout integration:
- `openCheckout(options)` - Open Razorpay payment flow
- `getPlanDetails(planId)` - Get plan details
- `formatAmount(amountInPaise)` - Format amount for display

**Implementation Note:**
Current implementation uses a **mock payment flow** for development. In production, you need to:

1. **Option A:** Install `react-native-razorpay` package (requires native module setup)
2. **Option B:** Use WebView-based checkout
3. **Option C:** Redirect to web checkout page on your server

The mock flow simulates a successful payment after 2 seconds.

### 2. Entitlement API

**File:** `src/api/entitlement.api.js` (updated)

Added new API functions:
- `activatePro(paymentDetails)` - Activate Pro plan after payment
- `getSubscription()` - Get current subscription status

### 3. Go Pro Bottom Sheet

**File:** `src/components/sheets/GoProBottomSheet.js` (updated)

Enhanced with payment integration:
- Shows pricing: "₹299 / month"
- "Upgrade to Pro" button triggers payment
- Loading state during payment processing
- Calls `activatePro` API after successful payment
- Triggers `onUpgradeSuccess` to refresh entitlement
- Handles payment failures silently

**Payment Flow:**
1. User taps "Upgrade to Pro"
2. Opens Razorpay checkout (mock for now)
3. On success: calls `/api/v1/pro/activate`
4. Refreshes entitlement
5. Closes sheet
6. User can now use unlimited writes

### 4. Entitlement Context

**File:** `src/state/EntitlementContext.js` (no changes needed)

Already includes `onUpgradeSuccess` hook:
- Refetches entitlement after upgrade
- Silent transition detection
- Ready for payment integration

## What We Are NOT Doing (on purpose)

Following the minimal approach, we intentionally excluded:
- ❌ Invoices
- ❌ GST logic
- ❌ Email notifications
- ❌ Refunds
- ❌ Webhooks (polling approach initially)
- ❌ Yearly plans
- ❌ Coupons

These features can be added later based on traction.

## Payment Philosophy

> "If users pay for PH4, it's because the app **earned it**, not because it asked."

Key principles:
- **Silent upgrades** - No celebration screens, no confetti
- **Silent downgrades** - No guilt trips on expiry
- **No pressure** - Only show Go Pro when user hits limit or taps manually
- **Reversible** - Payment failure never breaks the app

## Testing

### Backend Testing

1. **Test Pro activation:**
```bash
# After getting mock payment details from frontend
curl -X POST http://localhost:5055/api/v1/pro/activate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "providerPaymentId": "pay_mock_xxx",
    "providerOrderId": "order_mock_xxx",
    "providerSignature": "mock_signature_xxx",
    "planId": "ph4_pro_monthly"
  }'
```

2. **Test subscription status:**
```bash
curl -X GET http://localhost:5055/api/v1/pro/subscription \
  -H "Authorization: Bearer YOUR_TOKEN"
```

3. **Test subscription expiry:**
- Manually set `expiresAt` to past date in DB
- Make any authenticated request
- User should be downgraded to free

### Frontend Testing

1. **Free user hits write limit:**
- Create 10 actions (Given/Taken/Follow-up/Recovery)
- 11th action should show Go Pro sheet
- Tap "Upgrade to Pro"
- Mock payment completes after 2 seconds
- Sheet closes, user can now make unlimited writes

2. **Manual Go Pro:**
- Tap "Go Pro" button in Today header
- Sheet shows pricing
- Complete payment flow
- Verify Pro status in entitlement

3. **Pro user:**
- Should see no limits
- Should see no trial/free text
- Bills entry should work
- All writes unlimited

## Production Checklist

Before going live:

### Backend
- [ ] Add Razorpay keys to production env
- [ ] Test signature verification with real payments
- [ ] Set up monitoring for subscription expiry
- [ ] Add logging for all payment events
- [ ] Test duplicate payment handling

### Frontend
- [ ] Replace mock payment with real Razorpay integration
- [ ] Test payment success flow
- [ ] Test payment failure/cancellation flow
- [ ] Test network failure during payment
- [ ] Verify entitlement refresh after upgrade

### Security
- [ ] Verify payment signature validation works
- [ ] Test for duplicate payment prevention
- [ ] Ensure no client-side plan status manipulation
- [ ] Verify subscription expiry is server-authoritative

### UX
- [ ] Verify silent upgrade (no celebration)
- [ ] Verify silent downgrade (no guilt)
- [ ] Verify payment failure doesn't break app
- [ ] Verify Go Pro sheet is calm and clear

## Next Steps

After this implementation is tested and live:

1. **Monitor traction** - Collect data on upgrade conversion
2. **Add webhooks** - For real-time payment status updates (optional)
3. **Add yearly plan** - If monthly shows traction
4. **Add invoices** - If users request them
5. **Add GST** - If legally required

## Files Changed

### Backend
- ✅ `src/models/Subscription.js` (NEW)
- ✅ `src/services/razorpay.service.js` (NEW)
- ✅ `src/controllers/pro.controller.js` (NEW)
- ✅ `src/routes/pro.routes.js` (NEW)
- ✅ `src/middleware/trialExpiry.middleware.js` (UPDATED - added subscription expiry)
- ✅ `src/config/env.js` (UPDATED - added Razorpay keys)
- ✅ `src/app.js` (UPDATED - mounted pro routes)
- ✅ `env.example` (UPDATED - added Razorpay keys)

### Frontend
- ✅ `src/services/razorpay.service.js` (NEW)
- ✅ `src/api/entitlement.api.js` (UPDATED - added activatePro and getSubscription)
- ✅ `src/components/sheets/GoProBottomSheet.js` (UPDATED - added payment flow)
- ⏭️ `src/state/EntitlementContext.js` (NO CHANGE - already ready)

## Implementation Status

✅ **COMPLETE** - Payment infrastructure is ready

Current state:
- Backend fully functional
- Frontend uses mock payment (replace with real Razorpay in production)
- Silent upgrade/downgrade flows working
- Entitlement system integrated

**Ready for production after replacing mock payment with real Razorpay checkout.**

---

**Execution ends here unless you say otherwise.**
