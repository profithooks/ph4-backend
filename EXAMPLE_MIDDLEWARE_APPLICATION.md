# Example: Applying Write Limit Middleware

This document shows **exactly** how to update a route file with the `checkWriteLimit` middleware.

---

## 📝 Example: Ledger Routes

**File:** `/src/routes/ledger.routes.js`

### **Before** (Current):

```javascript
/**
 * Ledger routes
 */
const express = require('express');
const {
  getCustomerTransactions,
  addCredit,
  addDebit,
} = require('../controllers/ledger.controller');
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  addCreditSchema,
  addDebitSchema,
} = require('../validators/ledger.validator');

const router = express.Router();

// Guard: Ensure all handlers are functions
const handlers = {getCustomerTransactions, addCredit, addDebit};
Object.entries(handlers).forEach(([name, fn]) => {
  if (typeof fn !== 'function') {
    throw new Error(
      `Route handler "${name}" is undefined in ledger.controller.js`,
    );
  }
});

router.use(protect);

router.get('/:customerId', validateObjectId('customerId'), getCustomerTransactions);
router.post('/credit', validate(addCreditSchema), addCredit);
router.post('/debit', validate(addDebitSchema), addDebit);

module.exports = router;
```

---

### **After** (With Write Limits):

```javascript
/**
 * Ledger routes
 */
const express = require('express');
const {
  getCustomerTransactions,
  addCredit,
  addDebit,
} = require('../controllers/ledger.controller');
const {protect} = require('../middleware/auth.middleware');
const {checkWriteLimit} = require('../middleware/writeLimit.middleware'); // ← NEW
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  addCreditSchema,
  addDebitSchema,
} = require('../validators/ledger.validator');

const router = express.Router();

// Guard: Ensure all handlers are functions
const handlers = {getCustomerTransactions, addCredit, addDebit};
Object.entries(handlers).forEach(([name, fn]) => {
  if (typeof fn !== 'function') {
    throw new Error(
      `Route handler "${name}" is undefined in ledger.controller.js`,
    );
  }
});

router.use(protect);

// Read endpoint - NO write limit
router.get('/:customerId', validateObjectId('customerId'), getCustomerTransactions);

// Write endpoints - WITH write limit
router.post('/credit', validate(addCreditSchema), checkWriteLimit, addCredit);  // ← ADDED
router.post('/debit', validate(addDebitSchema), checkWriteLimit, addDebit);     // ← ADDED

module.exports = router;
```

---

## 🔍 **What Changed?**

### 1. **Import Statement** (Line 6):
```javascript
// Added:
const {checkWriteLimit} = require('../middleware/writeLimit.middleware');
```

### 2. **Applied to Write Endpoints** (Lines 33-34):
```javascript
// Before:
router.post('/credit', validate(addCreditSchema), addCredit);
router.post('/debit', validate(addDebitSchema), addDebit);

// After:
router.post('/credit', validate(addCreditSchema), checkWriteLimit, addCredit);
router.post('/debit', validate(addDebitSchema), checkWriteLimit, addDebit);
```

**Middleware order:**
1. `protect` (applied globally via `router.use(protect)`)
2. `validate()` (specific to each route)
3. `checkWriteLimit` (NEW - enforces write limits)
4. Controller function

---

## ✅ **Middleware Chain Execution**

### For `POST /api/v1/ledger/credit`:

```
Request
  ↓
1. protect (sets req.user)
  ↓
2. validate(addCreditSchema) (validates request body)
  ↓
3. checkWriteLimit (checks plan status + daily count)
  ↓
  - If trial/pro → continue
  - If free + count < 10 → continue + increment
  - If free + count >= 10 → BLOCK (403)
  ↓
4. addCredit (controller executes)
  ↓
Response
```

---

## 🧪 **Testing This Change**

### 1. Start server:
```bash
npm run dev
```

### 2. Create trial user:
```bash
curl -X POST http://localhost:5000/api/v1/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"mobile":"9999999999"}'

curl -X POST http://localhost:5000/api/v1/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"mobile":"9999999999","otp":"0000","device":{"deviceId":"test"}}'
```

Save the `accessToken` from response.

### 3. Test credit endpoint (trial = unlimited):
```bash
TOKEN="your_access_token_here"

# Try 12 writes (all should succeed for trial user)
for i in {1..12}; do
  echo "Write $i:"
  curl -X POST http://localhost:5000/api/v1/ledger/credit \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"customerId":"674b1234567890abcdef1234","amount":100,"note":"Test '$i'"}'
  echo ""
done
```

**Expected:** All 12 succeed (trial = unlimited).

### 4. Transition to free plan:
```bash
# Connect to MongoDB and update user:
mongo ph4 --eval '
  db.users.updateOne(
    { mobile: "9999999999" },
    { $set: { 
        planStatus: "free", 
        dailyWriteCount: 0,
        dailyWriteDate: "'$(date +%Y-%m-%d)'" 
    }}
  )
'
```

### 5. Test again (free = 10 limit):
```bash
# Try 12 writes (first 10 succeed, last 2 blocked)
for i in {1..12}; do
  echo "Write $i:"
  curl -X POST http://localhost:5000/api/v1/ledger/credit \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"customerId":"674b1234567890abcdef1234","amount":100,"note":"Test '$i'"}'
  echo ""
done
```

**Expected:**
- Writes 1-10: Success (200)
- Writes 11-12: Blocked (403) with:
  ```json
  {
    "code": "WRITE_LIMIT_EXCEEDED",
    "message": "Daily free limit reached",
    "limit": 10,
    "resetAt": "2026-01-22T00:00:00.000Z"
  }
  ```

---

## 📋 **Apply Same Pattern to Other Routes**

### Recovery Routes (`/src/routes/recovery.routes.js`):
```javascript
const {checkWriteLimit} = require('../middleware/writeLimit.middleware');

router.post('/cases', protect, validate(createCaseSchema), checkWriteLimit, createCase);
router.patch('/cases/:id/promise', protect, validate(setPromiseSchema), checkWriteLimit, setPromise);
```

### Follow-Up Routes (`/src/routes/followup.routes.js`):
```javascript
const {checkWriteLimit} = require('../middleware/writeLimit.middleware');

router.post('/tasks', protect, validate(createTaskSchema), checkWriteLimit, createTask);
router.patch('/tasks/:id/status', protect, validate(updateStatusSchema), checkWriteLimit, updateStatus);
```

---

## ⚠️ **Important Notes**

### 1. **Order Matters:**
Always place `checkWriteLimit` AFTER `protect`:
```javascript
// ✅ CORRECT:
router.post('/credit', protect, checkWriteLimit, addCredit);

// ❌ WRONG:
router.post('/credit', checkWriteLimit, protect, addCredit);
// (checkWriteLimit needs req.user from protect)
```

### 2. **Validation First:**
If you have validation, it goes before `checkWriteLimit`:
```javascript
// ✅ CORRECT (validate input before checking limits):
router.post('/credit', validate(schema), checkWriteLimit, addCredit);

// ❌ WRONG (wastes write count on invalid input):
router.post('/credit', checkWriteLimit, validate(schema), addCredit);
```

**Best order:**
1. `protect` (auth)
2. `validate()` (input validation)
3. `checkWriteLimit` (entitlement check)
4. Controller

### 3. **Don't Apply to GET:**
```javascript
// ✅ CORRECT:
router.get('/transactions', protect, getTransactions);  // No checkWriteLimit

// ❌ WRONG:
router.get('/transactions', protect, checkWriteLimit, getTransactions);
```

---

## ✅ **Checklist for Each Route File**

When updating a route file:
- [ ] Import `checkWriteLimit` from middleware
- [ ] Identify write endpoints (POST/PATCH that mutate data)
- [ ] Add `checkWriteLimit` to each write endpoint
- [ ] Verify middleware order: `protect` → `validate` → `checkWriteLimit` → controller
- [ ] Test with trial user (unlimited)
- [ ] Test with free user (10 limit)
- [ ] Verify 403 response on limit exceeded

---

## 🎯 **Next Steps**

1. Apply this pattern to:
   - ✅ `/src/routes/ledger.routes.js` (example above)
   - ⬜ `/src/routes/recovery.routes.js`
   - ⬜ `/src/routes/followup.routes.js`
   - ⬜ `/src/routes/bill.routes.js` (future)

2. Test each route file individually

3. Run full test suite: `node scripts/test-write-limits.js`

4. Deploy to staging

---

**Questions?** See:
- `WRITE_ENDPOINTS_CHECKLIST.md` - Full list of endpoints
- `FREEMIUM_ENTITLEMENT_IMPLEMENTATION.md` - How middleware works

**Ready to apply!** Start with ledger routes, then recovery, then follow-up.
