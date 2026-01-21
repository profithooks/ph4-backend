# Pro Lifecycle Management - Backend Implementation

## ✅ **Status: Silent, Authoritative Transitions**

Backend now handles trial expiry and plan transitions automatically on every request.

---

## 🎯 **What Was Built**

### **1. Auto-Expiry Logic** (Already Exists in User Model)

**File:** `/src/models/User.js` (Pre-save hook)

**Behavior:**
```javascript
// Runs on every user.save()
if (planStatus === 'trial' && now >= trialEndsAt) {
  planStatus = 'free';
  planActivatedAt = now;
}
```

**Guarantees:**
- ✅ No stale trial users
- ✅ No cron jobs needed
- ✅ No manual cleanup
- ✅ Transitions happen naturally on next write/read

---

### **2. Entitlement Controller** (`/src/controllers/entitlement.controller.js` - NEW)

**Endpoint:** `GET /api/v1/auth/me/entitlement`

**Response:**
```json
{
  "success": true,
  "data": {
    "planStatus": "free",
    "trialEndsAt": "2026-02-20T00:00:00.000Z",
    "trialDaysLeft": 0,
    "trialExpired": true,
    "dailyWriteCount": 3,
    "dailyLimit": 10,
    "writesRemainingToday": 7,
    "dailyWriteDate": "2026-01-21"
  }
}
```

**Fields Explained:**
- `planStatus`: Current plan (`'trial' | 'free' | 'pro'`)
- `trialEndsAt`: Date when trial ends (null if never had trial)
- `trialDaysLeft`: Days remaining in trial (0 if expired)
- `trialExpired`: Boolean (true if was trial, now expired)
- `dailyWriteCount`: Writes used today
- `dailyLimit`: Max writes per day (10 for free, Infinity for trial/pro)
- `writesRemainingToday`: Writes left today

**Logic:**
```javascript
// Trial days calculation
if (planStatus === 'trial') {
  trialDaysLeft = Math.max(0, ceil((trialEndsAt - now) / 86400000));
  trialExpired = trialDaysLeft <= 0;
} else if (planStatus === 'free' && trialEndsAt) {
  // Was trial, now free (expired)
  trialExpired = true;
  trialDaysLeft = 0;
}

// Daily limit calculation
dailyLimit = planStatus === 'free' ? 10 : Infinity;
writesRemainingToday = planStatus === 'free'
  ? Math.max(0, 10 - dailyWriteCount)
  : Infinity;
```

**Resets daily counter:**
- Calls `user.ensureDailyWriteCounter()` before returning
- Ensures counter is reset if new day

---

### **3. Entitlement Routes** (`/src/routes/entitlement.routes.js` - NEW)

```javascript
router.get('/me/entitlement', protect, getEntitlement);
```

**Mounted at:** `/api/v1/auth/me/entitlement`

---

### **4. App Integration** (`/src/app.js` - UPDATED)

```javascript
const entitlementRoutes = require('./routes/entitlement.routes');
app.use('/api/v1/auth', entitlementRoutes);
```

---

## 🔄 **Lifecycle Flow (Backend)**

### **New User Signup:**
```
User signs up (OTP or password)
  ↓
User.create({
  planStatus: 'trial',
  trialEndsAt: now + 30 days,
  dailyWriteCount: 0,
  dailyWriteDate: today
})
  ↓
User gets 30 days unlimited writes
```

---

### **Trial Expiry (Automatic):**
```
Day 30: User makes any write or read
  ↓
Middleware calls user.save()
  ↓
Pre-save hook checks:
  if (planStatus === 'trial' && now >= trialEndsAt)
  ↓
Auto-transition:
  planStatus = 'free'
  planActivatedAt = now
  ↓
No notification, no event, no email
  ↓
User.save() completes
  ↓
Next write: Enforces 10/day limit
```

**Result:** Silent, inevitable, respectful.

---

### **Daily Counter Reset:**
```
First request of new day
  ↓
ensureDailyWriteCounter() checks:
  if (dailyWriteDate !== today)
  ↓
Reset:
  dailyWriteCount = 0
  dailyWriteDate = today
  ↓
User gets 10 fresh writes (if free)
```

---

### **Write Limit Enforcement:**
```
Free user attempts 11th write
  ↓
checkWriteLimit middleware runs
  ↓
user.canWrite() checks:
  if (planStatus === 'free' && dailyWriteCount >= 10)
  ↓
Return 403:
  {
    code: 'WRITE_LIMIT_EXCEEDED',
    message: 'Daily free limit reached',
    limit: 10,
    resetAt: 'tomorrow midnight'
  }
  ↓
Frontend intercepts → Opens Go Pro sheet
```

---

## 📋 **API Contract**

### **Endpoint:**
`GET /api/v1/auth/me/entitlement`

### **Headers:**
```
Authorization: Bearer {accessToken}
```

### **Response (200):**
```json
{
  "success": true,
  "data": {
    "planStatus": "trial",
    "trialEndsAt": "2026-02-20T00:00:00.000Z",
    "trialDaysLeft": 10,
    "trialExpired": false,
    "dailyWriteCount": 0,
    "dailyLimit": null,
    "writesRemainingToday": null,
    "dailyWriteDate": "2026-01-21"
  }
}
```

### **Response (401):**
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Not authorized, no token"
  }
}
```

---

## 🧪 **Testing**

### **Test 1: Trial User (Unlimited):**
```bash
# Create trial user
curl -X POST http://localhost:5000/api/v1/auth/otp/request \
  -d '{"mobile":"9999999999"}'

curl -X POST http://localhost:5000/api/v1/auth/otp/verify \
  -d '{"mobile":"9999999999","otp":"0000","device":{"deviceId":"test"}}'

TOKEN="..."

# Get entitlement
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/auth/me/entitlement

# Expected:
# {
#   "planStatus": "trial",
#   "trialDaysLeft": 30,
#   "trialExpired": false,
#   "dailyLimit": null (Infinity)
# }
```

---

### **Test 2: Trial Expiry (Force Transition):**
```bash
# Manually expire trial
mongo ph4 --eval '
  db.users.updateOne(
    {mobile:"9999999999"},
    {$set:{trialEndsAt: new Date("2026-01-01")}}
  )
'

# Make any write (triggers save)
curl -X POST http://localhost:5000/api/v1/ledger/credit \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"customerId":"test","amount":100,"note":"Test"}'

# Get entitlement again
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/auth/me/entitlement

# Expected:
# {
#   "planStatus": "free",  ← Changed!
#   "trialExpired": true,
#   "trialDaysLeft": 0,
#   "dailyLimit": 10
# }
```

---

### **Test 3: Free User (10/day limit):**
```bash
# User is now free (from above)

# Attempt 10 writes (should all succeed)
for i in {1..10}; do
  curl -X POST http://localhost:5000/api/v1/ledger/credit \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"customerId":"test","amount":100,"note":"Write '$i'"}'
done

# Get entitlement
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/auth/me/entitlement

# Expected:
# {
#   "dailyWriteCount": 10,
#   "writesRemainingToday": 0
# }

# Attempt 11th write (should be blocked)
curl -X POST http://localhost:5000/api/v1/ledger/credit \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"customerId":"test","amount":100,"note":"Write 11"}'

# Expected: 403 WRITE_LIMIT_EXCEEDED
```

---

### **Test 4: Daily Counter Reset:**
```bash
# Manually reset date
mongo ph4 --eval '
  db.users.updateOne(
    {mobile:"9999999999"},
    {$set:{dailyWriteDate: "2026-01-20", dailyWriteCount: 10}}
  )
'

# Get entitlement (should reset counter)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/auth/me/entitlement

# Expected:
# {
#   "dailyWriteCount": 0,  ← Reset!
#   "writesRemainingToday": 10,
#   "dailyWriteDate": "2026-01-21"
# }
```

---

### **Test 5: Pro User (Unlimited):**
```bash
# Upgrade to Pro
mongo ph4 --eval '
  db.users.updateOne(
    {mobile:"9999999999"},
    {$set:{planStatus:"pro"}}
  )
'

# Get entitlement
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/v1/auth/me/entitlement

# Expected:
# {
#   "planStatus": "pro",
#   "dailyLimit": null,  (Infinity)
#   "writesRemainingToday": null  (Infinity)
# }

# Attempt unlimited writes (all succeed)
for i in {1..20}; do
  curl -X POST http://localhost:5000/api/v1/ledger/credit \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"customerId":"test","amount":100,"note":"Write '$i'"}'
done
```

---

## 📂 **Files Created/Modified**

### **Created (2):**
1. `/src/controllers/entitlement.controller.js` - Entitlement logic
2. `/src/routes/entitlement.routes.js` - Entitlement routes

### **Modified (1):**
1. `/src/app.js` - Mounted entitlement routes

**No linter errors** ✅

---

## ✅ **Success Criteria**

Backend is working when:

1. ✅ New user gets `planStatus: 'trial'`
2. ✅ Trial user has `trialDaysLeft: 30`
3. ✅ Trial user gets unlimited writes
4. ✅ After 30 days → Auto-transition to `'free'` on next save
5. ✅ Free user gets `dailyLimit: 10`
6. ✅ Free user blocked after 10 writes (403)
7. ✅ Daily counter resets at midnight
8. ✅ Pro user has `dailyLimit: null` (unlimited)

---

## 🎯 **Philosophy**

### **Silent Transitions:**
- Trial → Free happens automatically on save
- No notification, no event, no email
- User discovers limit naturally (on 11th write)

### **Authoritative Backend:**
- Frontend never computes dates
- Backend always returns computed values (`trialDaysLeft`, `writesRemainingToday`)
- Frontend trusts backend completely

### **Predictable Behavior:**
- Daily counter resets at midnight (first request of new day)
- Limits are enforced consistently (server-side)
- No surprises, no pressure

---

**Status:** ✅ Backend lifecycle complete. Ready for frontend integration.
