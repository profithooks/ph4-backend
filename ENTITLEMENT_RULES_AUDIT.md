# Entitlement Rules Audit & Implementation Plan

**Date:** 2026-01-21  
**Status:** 🔍 **AUDIT COMPLETE** → Ready for implementation

---

## **REQUIRED RULES (Source of Truth)**

### **TRIAL (30 days from signup)**
- ✅ All features available
- ✅ Can create bills
- ✅ Unlimited customer writes (given/taken, promises, followups, recovery)
- ✅ No daily limits

### **FREE (after trial expires, if not Pro)**
- ✅ Can VIEW bills (read-only)
- ❌ CANNOT create bills
- ✅ Can create customer writes: 10/day limit
  - Given/taken entries
  - Promise/followup/recovery actions
- ✅ Can VIEW all existing customer/ledger data

### **PRO**
- ✅ All features unlimited
- ✅ Can create bills
- ✅ Unlimited customer writes

---

## **CURRENT STATE AUDIT**

### **✅ CORRECT: Trial Initialization**

**File:** `src/models/User.js` (lines 71-94)

```javascript
planStatus: {
  type: String,
  enum: ['trial', 'free', 'pro'],
  default: 'trial',  // ✅ CORRECT
},
trialEndsAt: {
  type: Date,
  default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),  // ✅ CORRECT: 30 days
},
dailyWriteCount: {
  type: Number,
  default: 0,
},
dailyWriteDate: {
  type: String, // YYYY-MM-DD format
  default: () => new Date().toISOString().split('T')[0],
},
```

**✅ VERDICT:** New users correctly get trial + 30 days

**⚠️ ISSUE:** Existing users might be missing `trialEndsAt` → Need migration strategy

---

### **✅ CORRECT: Write Limit Logic**

**File:** `src/models/User.js` (lines 184-220)

```javascript
userSchema.methods.canWrite = function () {
  // Trial users: unlimited  ✅
  if (this.planStatus === 'trial') {
    return { allowed: true };
  }
  
  // Pro users: unlimited  ✅
  if (this.planStatus === 'pro') {
    return { allowed: true };
  }
  
  // Free users: check daily limit  ✅
  if (this.planStatus === 'free') {
    const FREE_DAILY_LIMIT = 10;  // ✅ CORRECT
    
    if (this.dailyWriteCount >= FREE_DAILY_LIMIT) {
      // Blocked ✅
    }
  }
};
```

**✅ VERDICT:** Logic is correct for trial/free/pro

---

### **❌ ISSUE 1: Bills Counting as "Customer Writes"**

**File:** `src/routes/bill.routes.js` (line 34)

```javascript
router.use(requirePro); // Bills are Pro-only feature

// PROBLEM: checkWriteLimit applied to bill routes
router.post('/', checkWriteLimit, createBill);  // ❌ WRONG
router.patch('/:id/pay', checkWriteLimit, addBillPayment);  // ❌ WRONG
```

**❌ PROBLEM:**
- Bill creation currently counts towards daily customer writes
- Per requirements: Bills should be BLOCKED for free users (not counted)
- Bill writes should NOT increment dailyWriteCount

**✅ FIX:**
- Remove `checkWriteLimit` from bill routes
- Keep `requirePro` middleware (blocks free, allows trial/pro)

---

### **❌ ISSUE 2: Free Users Blocked from VIEWING Bills**

**File:** `src/routes/bill.routes.js` (line 26)

```javascript
router.use(requirePro); // ❌ Blocks ALL bill routes for free users
```

**❌ PROBLEM:**
- `requirePro` blocks free users from GET routes too
- Per requirements: Free users should VIEW bills (read-only)

**✅ FIX:**
- Apply `requirePro` only to WRITE bill routes (POST/PATCH/DELETE)
- Allow GET routes for free users

---

### **❌ ISSUE 3: Entitlement Response Missing Permissions**

**File:** `src/controllers/entitlement.controller.js` (lines 45-58)

**Current response:**
```javascript
{
  planStatus,
  trialEndsAt,
  trialDaysLeft,
  trialExpired,
  dailyWriteCount,
  dailyLimit,
  writesRemainingToday,
}
```

**❌ MISSING:**
- `isTrialActive` boolean
- `permissions` object
- Clear separation of limits

**✅ FIX:** Match required contract

---

### **❌ ISSUE 4: UTC Timezone Instead of IST**

**File:** `src/models/User.js` (line 167)

```javascript
const today = new Date().toISOString().split('T')[0]; // ❌ UTC
```

**❌ PROBLEM:**
- Daily reset at midnight UTC (5:30 AM IST)
- Should reset at midnight IST (Asia/Kolkata)

**✅ FIX:** Implement IST helper

---

### **❌ ISSUE 5: No Migration for Missing trialEndsAt**

**Current:** No migration logic

**❌ RISK:** Old users without `trialEndsAt` will have undefined behavior

**✅ FIX:**
- If user created < 24h ago: Give full 30-day trial
- If user created > 24h ago: Expire immediately (set to now)

---

## **IMPLEMENTATION PLAN**

### **Phase 1: IST Timezone Helper**
1. Create `src/utils/istTimezone.js`
2. Implement `getISTDateString()` → Returns YYYY-MM-DD in IST
3. Update `ensureDailyWriteCounter()` to use IST

---

### **Phase 2: Entitlement Response Update**
1. Update `src/controllers/entitlement.controller.js`
2. Return new contract:
   ```javascript
   {
     planStatus,
     trialEndsAt,
     isTrialActive,
     limits: {
       customerWritesPerDay,
       customerWritesUsedToday,
       customerWritesRemainingToday
     },
     permissions: {
       canCreateBills,
       canCreateCustomerWrites,
       canViewBills
     }
   }
   ```

---

### **Phase 3: Separate Bill Viewing from Creation**
1. Update `src/routes/bill.routes.js`
2. Remove `router.use(requirePro)` (global)
3. Apply `requirePro` only to POST/PATCH/DELETE routes
4. Remove `checkWriteLimit` from ALL bill routes
5. Allow GET routes for everyone (auth only)

---

### **Phase 4: Trial Migration Logic**
1. Add migration check in entitlement endpoint
2. If `trialEndsAt` is null:
   - Check `createdAt`
   - If < 24h ago: Set `trialEndsAt = now + 30 days`
   - If > 24h ago: Set `trialEndsAt = now` (expired)

---

### **Phase 5: Verification Script**
1. Create `scripts/verify-entitlement-rules.js`
2. Test cases:
   - Trial user: unlimited + canCreateBills
   - Expired trial → free: 10/day + canViewBills
   - 11th write blocked
   - Pro user: unlimited

---

## **CUSTOMER WRITE ENDPOINTS (Apply checkWriteLimit)**

**These count towards 10/day limit for free users:**

1. **Ledger Routes:**
   - ✅ `POST /ledger/credit`
   - ✅ `POST /ledger/debit`

2. **Customer Routes:**
   - ✅ `POST /customers` (create)
   - ✅ `PUT /customers/:id` (update)
   - ✅ `DELETE /customers/:id`

3. **Recovery Routes:**
   - ✅ `POST /recovery/open`
   - ✅ `POST /recovery/promise`
   - ✅ `POST /recovery/status`
   - ✅ `POST /recovery/auto-keep`
   - ✅ `POST /recovery/:id/escalate`

4. **Follow-up Routes:**
   - ✅ `POST /followups` (create)
   - ✅ `POST /followups/auto-generate`

**Total:** 12 endpoints with `checkWriteLimit` ✅

---

## **BILL ENDPOINTS (Do NOT count as customer writes)**

**Pro-only for creation, read-only for free:**

1. **READ (Allow all users):**
   - `GET /bills` (list)
   - `GET /bills/summary`
   - `GET /bills/:id` (detail)

2. **WRITE (Pro/Trial only):**
   - `POST /bills` (create) → `requirePro` only
   - `PATCH /bills/:id/pay` → `requirePro` only
   - `PATCH /bills/:id/cancel` → `requirePro` only
   - `DELETE /bills/:id` → `requirePro` only

---

## **EXPECTED BEHAVIOR AFTER FIXES**

### **Trial User**
```
GET /me/entitlement
{
  planStatus: "trial",
  isTrialActive: true,
  limits: {
    customerWritesPerDay: null,      // unlimited
    customerWritesUsedToday: 0,
    customerWritesRemainingToday: null
  },
  permissions: {
    canCreateBills: true,            // ✅
    canCreateCustomerWrites: true,   // ✅
    canViewBills: true               // ✅
  }
}

POST /ledger/credit → ✅ Success (no limit)
POST /bills → ✅ Success (allowed)
```

---

### **Free User (After Trial)**
```
GET /me/entitlement
{
  planStatus: "free",
  isTrialActive: false,
  limits: {
    customerWritesPerDay: 10,
    customerWritesUsedToday: 3,
    customerWritesRemainingToday: 7
  },
  permissions: {
    canCreateBills: false,           // ❌ Blocked
    canCreateCustomerWrites: true,   // ✅ (up to 10/day)
    canViewBills: true               // ✅ Read-only
  }
}

POST /ledger/credit (10x) → ✅ Success
POST /ledger/credit (11th) → ❌ 403 WRITE_LIMIT_EXCEEDED

GET /bills → ✅ Success (read-only)
POST /bills → ❌ 403 PRO_REQUIRED
```

---

### **Pro User**
```
GET /me/entitlement
{
  planStatus: "pro",
  isTrialActive: false,
  limits: {
    customerWritesPerDay: null,      // unlimited
    customerWritesUsedToday: 0,
    customerWritesRemainingToday: null
  },
  permissions: {
    canCreateBills: true,            // ✅
    canCreateCustomerWrites: true,   // ✅
    canViewBills: true               // ✅
  }
}

POST /ledger/credit → ✅ Success (unlimited)
POST /bills → ✅ Success (unlimited)
```

---

## **FILES TO CHANGE**

1. ✅ `src/utils/istTimezone.js` (NEW)
2. ✅ `src/models/User.js` (update ensureDailyWriteCounter)
3. ✅ `src/controllers/entitlement.controller.js` (new response format)
4. ✅ `src/routes/bill.routes.js` (remove checkWriteLimit, selective requirePro)
5. ✅ `scripts/verify-entitlement-rules.js` (NEW)

---

**STATUS:** Ready to implement  
**NEXT:** Apply fixes in order (Phase 1-5)
