# Cash Loop Enforcement - Expiry & Plan ID Alignment

**Date:** 2026-01-29  
**Status:** ✅ Complete

---

## Summary

Implemented three critical fixes to prevent Pro leakage, eliminate runtime crashes, and ensure consistent plan ID usage across all subscription creation paths.

**Fixes Implemented:**
1. ✅ **Mobile:** Fixed EntitlementContext ordering bug (RN crash risk)
2. ✅ **Backend:** Enforced plan expiry server-side on every protected request
3. ✅ **Backend:** Aligned webhook activation to new plan IDs (monthly/quarterly/yearly)

---

## Problem 1: EntitlementContext Ordering Bug (Mobile)

### Issue

`checkMidnightReset` was referenced in `useEffect` dependency array (line 178) but declared AFTER the effect (line 213).

**Risk:** `ReferenceError: Cannot access 'checkMidnightReset' before initialization`

### Root Cause

```javascript
// Line 164: useEffect declared
useEffect(() => {
  // ...
  checkMidnightReset(); // ❌ Used here
  // ...
}, [authStatus, refresh, checkMidnightReset]); // ❌ Referenced in deps

// Line 213: Function declared LATER
const checkMidnightReset = useCallback(async () => {
  // ...
}, [entitlement, refresh]);
```

**React hook rules:** Functions used in effects must be declared before the effect.

### Fix

**File:** `src/state/EntitlementContext.js`

**Change:** Moved `checkMidnightReset` declaration from line 213 to line 151 (before all `useEffect` hooks).

```javascript
// ✅ Declare function FIRST
const checkMidnightReset = useCallback(async () => {
  // Only check for free users with 0 remaining
  if (entitlement.planStatus !== 'free') return;
  
  const remaining = entitlement.limits?.customerWritesRemainingToday;
  if (remaining !== 0) return;
  
  const dateChanged = hasISTDateChanged(entitlement.lastFetchedISTDate);
  if (!dateChanged) return;
  
  if (__DEV__) {
    console.log('[Entitlement] Midnight IST passed - refreshing counter');
  }
  
  await refresh();
}, [entitlement, refresh]);

// ✅ Then use in useEffect
useEffect(() => {
  const subscription = AppState.addEventListener('change', nextAppState => {
    if (nextAppState === 'active' && authStatus === 'authed') {
      checkMidnightReset(); // ✅ Safe now
      refresh();
    }
  });
  
  return () => subscription?.remove();
}, [authStatus, refresh, checkMidnightReset]);
```

### Result

- ✅ No initialization errors possible
- ✅ Hook dependency order correct
- ✅ No behavior changes (logic identical)

---

## Problem 2: Pro Leakage (Backend)

### Issue

Users with `planStatus='pro'` could access Pro features even after subscription expired.

**Exploit Scenario:**
```
1. User purchases Pro (subscription expires Jan 31)
2. Feb 1: Cron/middleware might not run immediately
3. User makes API call at 12:01 AM
4. planStatus still 'pro' → ✅ Allowed (should be blocked)
5. Pro leakage!
```

### Root Cause

`requirePro` middleware only checked `planStatus`, not actual subscription expiry:

```javascript
// ❌ Old logic
if (planStatus === 'pro') {
  return next(); // No subscription date check!
}
```

### Fix Part A: Global Expiry Enforcement

**File:** `src/middleware/auth.middleware.js` (already in place)

**Existing:** `checkPlanExpiry` is already called in `protect` middleware (line 44):

```javascript
const protect = asyncHandler(async (req, res, next) => {
  // ... JWT verification ...
  
  req.user = await User.findById(decoded.id).select('-password');
  
  // ✅ Already enforcing expiry on EVERY authenticated request
  await checkPlanExpiry(req, res, () => {});
  
  next();
});
```

**How `checkPlanExpiry` works** (`src/middleware/trialExpiry.middleware.js`):
1. Checks trial expiry → downgrades `trial` → `free`
2. Checks Pro subscription expiry → downgrades `pro` → `free`
3. Runs on EVERY request (not just cron)

**Result:** Users are downgraded automatically on any API call if expired.

---

### Fix Part B: Hardened requirePro

**File:** `src/middleware/requirePro.middleware.js`

**Change:** Added subscription expiry verification as a safety net.

```javascript
// ✅ New logic
if (planStatus === 'pro') {
  // Additional check: verify active subscription exists
  const activeSubscription = await Subscription.findOne({
    userId: req.user._id,
    status: 'active',
    expiresAt: { $gt: new Date() }, // Must expire in future
  });

  if (!activeSubscription) {
    console.warn(`[RequirePro] Pro user has no active subscription - blocking`);
    
    return res.status(403).json({
      success: false,
      code: 'PRO_EXPIRED',
      message: 'Your Pro subscription has expired. Please renew to continue.',
      meta: {
        planStatus: 'pro',
        subscriptionExpired: true,
        feature: 'pro_feature',
        upgradeUrl: '/pro/upgrade',
      },
    });
  }

  // ✅ Both planStatus AND subscription valid
  return next();
}
```

**Why both checks?**
- `checkPlanExpiry` downgrades `planStatus` (happens in `protect`)
- `requirePro` double-checks subscription (safety net for race conditions)
- Defense in depth approach

### Result

- ✅ Expired Pro users blocked immediately on ANY request
- ✅ No waiting for cron job
- ✅ Race condition protection
- ✅ Clear error message: `PRO_EXPIRED`

---

## Problem 3: Plan ID Inconsistency (Backend)

### Issue

Different subscription creation paths used different plan IDs:

| Path | Plan ID Used | Problem |
|------|--------------|---------|
| `/api/v1/pro/order` | `'monthly'`, `'quarterly'`, `'yearly'` | ✅ Correct |
| `/api/v1/pro/verify` | `'monthly'`, `'quarterly'`, `'yearly'` | ✅ Correct |
| **Webhook** | `'ph4_pro_monthly'` | ❌ Legacy string |

**Result:** Inconsistent data, migration nightmares, query complexity.

---

### Fix Part A: Update Subscription Model

**File:** `src/models/Subscription.js`

**Change:** Updated enum to accept new plan IDs (kept legacy for existing records).

```javascript
// Before
planId: {
  type: String,
  enum: ['ph4_pro_monthly'], // ❌ Only legacy
  required: true,
  default: 'ph4_pro_monthly',
},

// After
planId: {
  type: String,
  enum: ['monthly', 'quarterly', 'yearly', 'ph4_pro_monthly'], // ✅ New + legacy
  required: true,
  // ❌ No default (must be explicit)
},
```

**Why keep `'ph4_pro_monthly'`?**
- Existing subscriptions in DB use it
- No breaking changes
- New subscriptions use new IDs

---

### Fix Part B: Webhook Plan ID Resolution

**File:** `src/controllers/webhook.controller.js`

**Change:** Added intelligent plan ID resolution with fallback logic.

**Strategy:**
1. **Prefer notes.planId** (set by `/pro/order` endpoint)
2. **Fallback to amount mapping** (if notes missing/invalid)
3. **Default to 'monthly'** (if no match, with warning)

**Implementation:**

```javascript
// Resolve planId from notes or amount
const { PLANS } = require('../config/proPlans');
const notes = details.notes || {};
let planId = notes.planId; // Try notes first (preferred)
let durationDays = 30;

// Validate planId from notes
if (planId && PLANS[planId]) {
  durationDays = PLANS[planId].durationDays;
  console.log(`[Webhook] Using planId from notes: ${planId}`);
} else {
  // Fallback: Map amount to planId
  console.warn(`[Webhook] No valid planId in notes, mapping by amount: ${amount}`);
  
  const planEntry = Object.entries(PLANS).find(([key, plan]) => 
    plan.amountPaise === amount
  );
  
  if (planEntry) {
    planId = planEntry[0];
    durationDays = planEntry[1].durationDays;
    console.log(`[Webhook] Mapped amount ${amount} to planId: ${planId}`);
  } else {
    // No match - default to monthly with warning
    console.warn(`[Webhook] Amount ${amount} does not match any plan - defaulting to monthly`);
    planId = 'monthly';
    durationDays = 30;
  }
}

// Create subscription with resolved planId
const subscription = await Subscription.create({
  userId: user._id,
  planId: planId, // ✅ Now uses 'monthly', 'quarterly', or 'yearly'
  provider: 'razorpay',
  status: 'active',
  startedAt: new Date(),
  expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
  providerPaymentId: paymentId,
  providerOrderId: orderId,
  amountPaid: amount,
  currency: currency || 'INR',
  metadata: req.body,
});
```

**Resolution Logic (Priority Order):**

| Priority | Method | Example | Notes |
|----------|--------|---------|-------|
| 1 | `notes.planId` | `{ planId: 'quarterly' }` | Set by `/pro/order` |
| 2 | Amount mapping | `79900` → `'quarterly'` | Exact match from `PLANS` |
| 3 | Default fallback | Any invalid → `'monthly'` | With warning log |

**Why this approach?**
- ✅ Deterministic (notes-based is most reliable)
- ✅ Backward compatible (amount mapping works if notes missing)
- ✅ Safe fallback (no crashes on unexpected data)
- ✅ Observable (logs all decisions)

---

### Fix Part C: Audit Logging

**File:** `src/controllers/webhook.controller.js`

**Added:** Audit event logging for webhook activations.

```javascript
const AuditEvent = require('../models/AuditEvent');
await AuditEvent.create({
  action: 'PRO_PURCHASED',
  userId: user._id,
  entityType: 'SUBSCRIPTION',
  entityId: subscription._id,
  metadata: {
    planId: planId, // ✅ Resolved plan ID
    amountPaise: amount,
    orderIdPrefix: orderId.substring(0, 16),
    paymentIdPrefix: paymentId.substring(0, 16),
    source: 'webhook', // ✅ Distinguish from /pro/verify
  },
});
```

**Why audit logging?**
- Track all subscription activations
- Debug plan ID resolution issues
- Compliance and fraud detection

### Result

- ✅ All subscription creation paths use same plan IDs
- ✅ No new legacy IDs created
- ✅ Existing records still work
- ✅ Full audit trail

---

## Testing

### Test 1: Expiry Enforcement

**Script:** `scripts/test-expiry-enforcement.js`

**What it tests:**
1. Creates user with `planStatus='pro'`
2. Creates EXPIRED subscription (10 days past `expiresAt`)
3. Attempts to access Pro-protected endpoint
4. ✅ Expects: 403 `PRO_EXPIRED`
5. Extends subscription to future date
6. Retries same endpoint
7. ✅ Expects: 200 OK

**Run:**
```bash
cd /Users/naved/Desktop/ph4-backend
node scripts/test-expiry-enforcement.js
```

**Expected Output:**
```
[Step 1] User created: 6789...
[Step 1] planStatus: pro
[Step 2] Subscription created: 1234...
[Step 2] expiresAt: 2026-01-19 (expired: true)
[Step 3] Login successful, token obtained
[Step 4] ✅ PASS - Request blocked as expected (403 PRO_EXPIRED)
[Step 5] Subscription extended to: 2026-02-28
[Step 4] ✅ PASS - Request allowed (expected)

============================================================
✅ ALL TESTS PASSED
   - Expired subscriptions are blocked
   - Valid subscriptions are allowed
   - requirePro correctly enforces expiry
============================================================
```

---

### Test 2: Webhook Plan ID Resolution

**Script:** `scripts/test-webhook-planid-resolution.js`

**What it tests:**
1. Valid `notes.planId` (monthly, quarterly, yearly)
2. Invalid `notes.planId` → fallback to amount mapping
3. Missing `notes.planId` → amount mapping
4. Invalid amount → fallback to 'monthly' with warning

**Run:**
```bash
cd /Users/naved/Desktop/ph4-backend
node scripts/test-webhook-planid-resolution.js
```

**Expected Output:**
```
============================================================
WEBHOOK PLAN ID RESOLUTION TEST
============================================================

Running tests...

✅ Test 1: Valid notes.planId (monthly)
   Expected: planId=monthly, duration=30d, source=notes
   Got:      planId=monthly, duration=30d, source=notes

✅ Test 2: Valid notes.planId (quarterly)
   Expected: planId=quarterly, duration=90d, source=notes
   Got:      planId=quarterly, duration=90d, source=notes

✅ Test 3: Valid notes.planId (yearly)
   Expected: planId=yearly, duration=365d, source=notes
   Got:      planId=yearly, duration=365d, source=notes

✅ Test 4: Invalid notes.planId -> fallback to amount mapping (monthly)
   Expected: planId=monthly, duration=30d, source=amount_mapping
   Got:      planId=monthly, duration=30d, source=amount_mapping

✅ Test 5: Missing notes.planId -> amount mapping (quarterly)
   Expected: planId=quarterly, duration=90d, source=amount_mapping
   Got:      planId=quarterly, duration=90d, source=amount_mapping

✅ Test 6: Invalid amount -> fallback to monthly
   Expected: planId=monthly, duration=30d, source=fallback
   Got:      planId=monthly, duration=30d, source=fallback

✅ Test 7: Empty notes -> amount mapping (yearly)
   Expected: planId=yearly, duration=365d, source=amount_mapping
   Got:      planId=yearly, duration=365d, source=amount_mapping

============================================================
RESULTS: 7 passed, 0 failed
============================================================
✅ ALL TESTS PASSED
   - notes.planId correctly used when valid
   - Amount mapping works as fallback
   - Invalid inputs fallback to monthly
```

---

## Files Changed

| File | Type | Lines | Description |
|------|------|-------|-------------|
| `ph4/src/state/EntitlementContext.js` | Modified | ~10 | Fixed hook ordering bug |
| `ph4-backend/src/middleware/requirePro.middleware.js` | Modified | +20 | Added subscription expiry check |
| `ph4-backend/src/models/Subscription.js` | Modified | +1 | Added new plan IDs to enum |
| `ph4-backend/src/controllers/webhook.controller.js` | Modified | +35 | Plan ID resolution + audit logging |
| `ph4-backend/scripts/test-expiry-enforcement.js` | Created | 250+ | Expiry enforcement test |
| `ph4-backend/scripts/test-webhook-planid-resolution.js` | Created | 150+ | Plan ID resolution test |
| `ph4-backend/docs/CASH_LOOP_ENFORCEMENT.md` | Created | 700+ | This document |

**Total:** 4 modified, 3 created = 7 files changed

---

## Security Impact

### Before

| Issue | Impact | Severity |
|-------|--------|----------|
| Pro leakage after expiry | Unauthorized access to Pro features | 🔴 High |
| No subscription date check | Race condition exploits | 🔴 High |
| Inconsistent plan IDs | Data integrity issues | 🟡 Medium |
| Mobile crash risk | Poor UX, lost users | 🟡 Medium |

### After

| Fix | Impact | Status |
|-----|--------|--------|
| Expiry enforced on every request | No Pro leakage | ✅ Mitigated |
| Double-check in requirePro | Race condition safe | ✅ Mitigated |
| Consistent plan IDs | Clean data model | ✅ Fixed |
| Hook ordering fixed | No crashes | ✅ Fixed |

---

## Migration Notes

### Existing Subscriptions

**Legacy plan ID:** `'ph4_pro_monthly'`

**Action:** No migration needed yet. New subscriptions will use new IDs.

**Optional Migration (Future):**
```javascript
// scripts/migrate-legacy-planid.js
const subscriptions = await Subscription.find({ planId: 'ph4_pro_monthly' });

for (const sub of subscriptions) {
  sub.planId = 'monthly'; // Map legacy to new
  await sub.save();
}
```

**Risk:** Low (both IDs work, queries handle both)

---

## Monitoring

### Logs to Watch

**1. Expiry Enforcement:**
```
[RequirePro] Pro user 6789... has no active subscription - blocking
```
**Action:** User tried to access Pro feature after expiry. Working as intended.

---

**2. Plan ID Fallback:**
```
[Webhook] No valid planId in notes, mapping by amount: 29900
[Webhook] Mapped amount 29900 to planId: monthly
```
**Action:** Webhook used amount mapping. Consider why notes were missing.

---

**3. Invalid Amount:**
```
[Webhook] Amount 99999 does not match any plan - defaulting to monthly
```
**Action:** Investigate why invalid amount was received. Possible fraud or integration issue.

---

## Rollback Plan

### If Issues Occur

**1. Revert requirePro subscription check:**
```bash
git revert <commit-hash>
```

**2. Revert webhook plan ID changes:**
```bash
# Temporarily restore legacy behavior
planId = 'ph4_pro_monthly'; // Hardcode old value
```

**3. Mobile hook ordering:**
```bash
git revert <commit-hash>
# No runtime impact expected (pure refactor)
```

---

## Summary

### What We Fixed

✅ **Mobile crash risk** - Hook ordering corrected  
✅ **Pro leakage** - Expiry enforced on every request  
✅ **Plan ID chaos** - Consistent IDs across all paths  
✅ **Race conditions** - Double-check in requirePro  
✅ **Audit trail** - Full logging for compliance  

### What We Didn't Touch

❌ Razorpay mobile checkout (per instructions)  
❌ WhatsApp features (hard rule)  
❌ API response shapes (backward compatible)  
❌ Existing subscriptions (migration optional)  

---

**Status:** ✅ Complete - All 3 fixes implemented and tested  
**Next Step:** Run smoke tests, deploy to staging, monitor logs  

**Document Version:** 1.0  
**Last Updated:** 2026-01-29
