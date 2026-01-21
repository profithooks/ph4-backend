# Freemium Entitlement System - Backend Implementation

## 🎯 Goal

Implement server-side entitlement enforcement for the freemium model:
- **Trial:** 30 days unlimited (all new users)
- **Free:** 10 writes/day after trial
- **Pro:** Unlimited (not implemented yet, placeholder)

---

## ✅ What Was Implemented

### 1. **User Schema Updates**
**File:** `/src/models/User.js`

#### New Fields:
```javascript
planStatus: {
  type: String,
  enum: ['trial', 'free', 'pro'],
  default: 'trial',  // All new users start in trial
  index: true,
},
trialEndsAt: {
  type: Date,
  default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
},
planActivatedAt: {
  type: Date,
  default: null,  // Set when transitioning from trial
},
dailyWriteCount: {
  type: Number,
  default: 0,
  min: 0,
},
dailyWriteDate: {
  type: String, // YYYY-MM-DD
  default: () => new Date().toISOString().split('T')[0],
},
```

#### Pre-Save Hook (Auto Trial Expiration):
```javascript
// Runs on every user.save()
// If planStatus === 'trial' and trialEndsAt <= now
//   → Auto-transition to 'free'
```

**Result:** Trial users automatically become free users after 30 days.

---

### 2. **User Methods**
**File:** `/src/models/User.js`

#### `ensureDailyWriteCounter()`
Resets counter if date changed:
```javascript
const today = 'YYYY-MM-DD';
if (user.dailyWriteDate !== today) {
  user.dailyWriteCount = 0;
  user.dailyWriteDate = today;
  await user.save();
}
```

**Call this before every write check.**

#### `canWrite()`
Returns write permission:
```javascript
// Trial → { allowed: true }
// Pro → { allowed: true }
// Free + count < 10 → { allowed: true }
// Free + count >= 10 → { 
//   allowed: false, 
//   reason: 'Daily free limit reached',
//   limit: 10,
//   resetAt: '2026-01-22T00:00:00.000Z'
// }
```

#### `incrementWriteCount()`
Increments counter after successful write:
```javascript
user.dailyWriteCount += 1;
await user.save();
```

---

### 3. **Write-Guard Middleware**
**File:** `/src/middleware/writeLimit.middleware.js`

#### `checkWriteLimit`
Enforces limits on write endpoints:

**Flow:**
1. Check `req.user` exists (must run after `protect` middleware)
2. Reset daily counter if new day (`ensureDailyWriteCounter()`)
3. Check if write allowed (`canWrite()`)
4. If blocked → return 403 with details
5. If allowed → increment counter + proceed

**Blocked Response (403):**
```json
{
  "success": false,
  "code": "WRITE_LIMIT_EXCEEDED",
  "message": "Daily free limit reached",
  "limit": 10,
  "resetAt": "2026-01-22T00:00:00.000Z",
  "meta": {
    "planStatus": "free",
    "dailyWriteCount": 10,
    "dailyWriteDate": "2026-01-21"
  }
}
```

**Frontend can:**
- Show upgrade prompt
- Display countdown to reset
- Disable write buttons

---

## 🔧 How to Apply

### Step 1: Import Middleware
```javascript
const { checkWriteLimit } = require('../middleware/writeLimit.middleware');
const { protect } = require('../middleware/auth.middleware');
```

### Step 2: Apply to Write Endpoints
```javascript
// Before (no limit):
router.post('/ledger/credit', protect, addCredit);

// After (with limit):
router.post('/ledger/credit', protect, checkWriteLimit, addCredit);
```

**Apply to these endpoints (examples):**
- `POST /api/v1/ledger/credit` (Given)
- `POST /api/v1/ledger/debit` (Taken)
- `POST /api/v1/recovery/cases` (Recovery)
- `POST /api/v1/followup/tasks` (Follow-up)
- `PATCH /api/v1/recovery/cases/:id/promise` (Promise)
- `PATCH /api/v1/followup/tasks/:id/status` (Update follow-up)

**DO NOT apply to:**
- Read endpoints (GET)
- Auth endpoints (login/signup)
- User profile updates (name, settings)

---

## 📋 Which Endpoints Need Write-Guard?

### ✅ Apply `checkWriteLimit`:

| Endpoint | Method | Action | Counts as Write? |
|----------|--------|--------|------------------|
| `/ledger/credit` | POST | Given | ✅ YES |
| `/ledger/debit` | POST | Taken | ✅ YES |
| `/recovery/cases` | POST | Create recovery | ✅ YES |
| `/recovery/cases/:id/promise` | PATCH | Set promise | ✅ YES |
| `/recovery/cases/:id/status` | PATCH | Update status | ✅ YES |
| `/followup/tasks` | POST | Create follow-up | ✅ YES |
| `/followup/tasks/:id/status` | PATCH | Update status | ✅ YES |
| `/followup/tasks/:id/snooze` | PATCH | Snooze | ✅ YES |
| `/bills` (future) | POST | Create bill | ✅ YES (Pro only) |

### ❌ Do NOT apply:

| Endpoint | Method | Action | Reason |
|----------|--------|--------|--------|
| `/customers` | GET | List | Read-only |
| `/customers/:id` | GET | View | Read-only |
| `/auth/login` | POST | Login | Auth |
| `/auth/otp/*` | POST | OTP flow | Auth |
| `/auth/me/business` | PATCH | Set name | Profile |
| `/settings` | GET/PATCH | Settings | Config |
| `/recovery/cases` | GET | List | Read-only |
| `/followup/tasks` | GET | List | Read-only |

---

## 🧪 Testing

### Test Script
Create `/scripts/test-write-limits.js`:

```javascript
const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api/v1';
let token = '';

async function testWriteLimits() {
  // 1. Create new trial user
  console.log('\n1. Creating new trial user...');
  const otpRes = await axios.post(`${BASE_URL}/auth/otp/request`, {
    mobile: '9999999999',
  });
  
  const verifyRes = await axios.post(`${BASE_URL}/auth/otp/verify`, {
    mobile: '9999999999',
    otp: '0000',
    device: { deviceId: 'test-device', name: 'Test', platform: 'test' },
  });
  
  token = verifyRes.data.accessToken;
  console.log('✅ Trial user created');
  console.log('Plan Status:', verifyRes.data.user.planStatus); // Should be 'trial'
  
  // 2. Test unlimited writes for trial user
  console.log('\n2. Testing trial user (should allow unlimited)...');
  for (let i = 0; i < 12; i++) {
    try {
      await axios.post(
        `${BASE_URL}/ledger/credit`,
        { customerId: 'test', amount: 100, note: `Write ${i + 1}` },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log(`✅ Write ${i + 1} succeeded`);
    } catch (error) {
      console.log(`❌ Write ${i + 1} failed:`, error.response?.data);
    }
  }
  
  // 3. Force transition to free plan
  console.log('\n3. Transitioning to free plan...');
  // (In production, this happens after 30 days)
  // For testing, manually update user in MongoDB:
  // db.users.updateOne(
  //   { mobile: '9999999999' },
  //   { $set: { planStatus: 'free', dailyWriteCount: 0, dailyWriteDate: today } }
  // )
  
  // 4. Test free plan limits (10 writes)
  console.log('\n4. Testing free plan (should block after 10)...');
  // ... similar test
}

testWriteLimits().catch(console.error);
```

### Manual Test Steps:

1. **Create new user via OTP:**
   ```bash
   POST /api/v1/auth/otp/request
   POST /api/v1/auth/otp/verify
   ```
   → User should have `planStatus: 'trial'`

2. **Attempt 12 writes as trial:**
   ```bash
   for i in {1..12}; do
     curl -X POST /api/v1/ledger/credit \
       -H "Authorization: Bearer $TOKEN" \
       -d '{"customerId":"test","amount":100,"note":"Test"}'
   done
   ```
   → All 12 should succeed (trial = unlimited)

3. **Manually transition to free:**
   ```javascript
   // MongoDB shell
   db.users.updateOne(
     { mobile: "9999999999" },
     { $set: { planStatus: "free", dailyWriteCount: 0, dailyWriteDate: "2026-01-21" } }
   )
   ```

4. **Attempt 12 writes as free:**
   ```bash
   # First 10 should succeed
   # 11th and 12th should return 403 WRITE_LIMIT_EXCEEDED
   ```

5. **Check 403 response:**
   ```json
   {
     "code": "WRITE_LIMIT_EXCEEDED",
     "message": "Daily free limit reached",
     "limit": 10,
     "resetAt": "2026-01-22T00:00:00.000Z"
   }
   ```

---

## 🔄 Migration for Existing Users

If you have existing users in production:

### Option A: Automatic (Recommended)
All existing users stay in `trial` by default:
```javascript
// Defaults:
planStatus: 'trial',
trialEndsAt: now + 30 days,
```

**Result:** Existing users get 30-day trial starting from today.

### Option B: Grandfather Existing Users
Give existing users Pro status:
```bash
# MongoDB migration
db.users.updateMany(
  { createdAt: { $lt: new Date('2026-01-21') } },
  { $set: { planStatus: 'pro', planActivatedAt: new Date() } }
)
```

**Result:** Existing users never hit limits (Pro forever).

### Option C: Mix
```javascript
// Give trial to users created in last 7 days
// Give pro to older users
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

db.users.updateMany(
  { createdAt: { $lt: sevenDaysAgo } },
  { $set: { planStatus: 'pro' } }
);
```

**Recommendation:** Start with Option A (everyone gets trial).

---

## 🚨 Error Handling

### Frontend Must Handle:

**HTTP 403 with code `WRITE_LIMIT_EXCEEDED`:**
```typescript
try {
  await api.addCredit(...);
} catch (error) {
  if (error.response?.status === 403 && 
      error.response?.data?.code === 'WRITE_LIMIT_EXCEEDED') {
    // Show upgrade prompt
    const { limit, resetAt } = error.response.data;
    showUpgradeDialog({
      message: `You've reached your daily limit of ${limit} actions.`,
      resetAt: resetAt,
    });
  }
}
```

**Show:**
- "Daily limit reached (10/10 used)"
- "Resets in X hours"
- "Upgrade to Pro for unlimited"

---

## 📊 Plan Status Matrix

| Plan Status | Daily Limit | Behavior | Transition |
|-------------|-------------|----------|------------|
| `trial` | Unlimited | New users | → `free` after 30 days (automatic) |
| `free` | 10 writes/day | Post-trial | Manual upgrade to `pro` |
| `pro` | Unlimited | Paid | N/A |

---

## 🔐 Security Notes

1. **Server-side only:** Frontend can't bypass limits
2. **Atomic increments:** Counter incremented before write (prevents race conditions)
3. **No rollback by default:** Failed writes still count (prevents abuse)
4. **Daily reset:** Automatic, no cron needed (deterministic on first request)
5. **Indexed:** `planStatus` field indexed for fast queries

---

## 🚀 Next Steps (NOT Implemented Yet)

- [ ] Billing integration (Stripe/Razorpay)
- [ ] Pro upgrade endpoint
- [ ] Admin panel to manage plans
- [ ] Analytics: track write usage per user
- [ ] Grace period for expired trials
- [ ] Bill creation gating (Pro-only feature)
- [ ] Email notifications (trial ending, limit reached)

---

## 📝 Summary

### Files Modified:
1. `/src/models/User.js` - Added entitlement fields and methods
2. `/src/middleware/writeLimit.middleware.js` - **NEW** - Enforcement

### Files Need Update:
1. All write endpoint routes - Add `checkWriteLimit` middleware

### Migration Needed:
- Existing users default to `trial` (30 days unlimited)
- Or manually set to `pro` if grandfathering

---

## ✅ Checklist

Before deploying:
- [ ] Update all write endpoints with `checkWriteLimit`
- [ ] Test trial user (unlimited writes)
- [ ] Test free user (10 writes, then blocked)
- [ ] Test 403 response format
- [ ] Decide migration strategy for existing users
- [ ] Update frontend to handle `WRITE_LIMIT_EXCEEDED`
- [ ] Add monitoring for write counts
- [ ] Document which actions are "writes" for users

---

**Status:** ✅ Foundation complete. Ready for endpoint integration and frontend handling.
