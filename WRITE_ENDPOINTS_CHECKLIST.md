# Write Endpoints - Middleware Application Checklist

This document lists **all endpoints** that need the `checkWriteLimit` middleware.

---

## 🔍 How to Identify a "Write" Endpoint

**A "write" is any action that:**
- Creates money-related data (Given, Taken, Bill)
- Creates recovery/follow-up tasks
- Updates promise/follow-up status
- Materially changes business-critical state

**NOT a write:**
- Reading data (GET)
- Updating user profile (name, settings)
- Authentication (login, signup)

---

## ✅ Apply `checkWriteLimit` Middleware

### Format:
```javascript
const { checkWriteLimit } = require('../middleware/writeLimit.middleware');
const { protect } = require('../middleware/auth.middleware');

// Apply middleware chain:
router.post('/endpoint', protect, checkWriteLimit, controller);
//                       ↑        ↑
//                       auth     write limit
```

---

## 📋 Endpoints Requiring Write-Guard

### **1. Ledger Routes** (`/routes/ledger.routes.js`)

| Method | Endpoint | Action | Middleware |
|--------|----------|--------|------------|
| POST | `/api/v1/ledger/credit` | Add Given (credit) | `protect, checkWriteLimit` |
| POST | `/api/v1/ledger/debit` | Add Taken (debit) | `protect, checkWriteLimit` |

**Example:**
```javascript
// Before:
router.post('/credit', protect, addCredit);

// After:
router.post('/credit', protect, checkWriteLimit, addCredit);
router.post('/debit', protect, checkWriteLimit, addDebit);
```

---

### **2. Recovery Routes** (`/routes/recovery.routes.js`)

| Method | Endpoint | Action | Middleware |
|--------|----------|--------|------------|
| POST | `/api/v1/recovery/cases` | Create recovery case | `protect, checkWriteLimit` |
| PATCH | `/api/v1/recovery/cases/:id/promise` | Set promise | `protect, checkWriteLimit` |
| PATCH | `/api/v1/recovery/cases/:id/status` | Update status | `protect, checkWriteLimit` |
| POST | `/api/v1/recovery/cases/:id/events` | Add event | `protect, checkWriteLimit` |

**Example:**
```javascript
router.post('/cases', protect, checkWriteLimit, createCase);
router.patch('/cases/:id/promise', protect, checkWriteLimit, setPromise);
router.patch('/cases/:id/status', protect, checkWriteLimit, updateStatus);
router.post('/cases/:id/events', protect, checkWriteLimit, addEvent);
```

---

### **3. Follow-Up Routes** (`/routes/followup.routes.js`)

| Method | Endpoint | Action | Middleware |
|--------|----------|--------|------------|
| POST | `/api/v1/followup/tasks` | Create follow-up task | `protect, checkWriteLimit` |
| PATCH | `/api/v1/followup/tasks/:id/status` | Mark done/failed | `protect, checkWriteLimit` |
| PATCH | `/api/v1/followup/tasks/:id/snooze` | Snooze task | `protect, checkWriteLimit` |
| PATCH | `/api/v1/followup/tasks/:id/reschedule` | Reschedule task | `protect, checkWriteLimit` |

**Example:**
```javascript
router.post('/tasks', protect, checkWriteLimit, createTask);
router.patch('/tasks/:id/status', protect, checkWriteLimit, updateTaskStatus);
router.patch('/tasks/:id/snooze', protect, checkWriteLimit, snoozeTask);
router.patch('/tasks/:id/reschedule', protect, checkWriteLimit, rescheduleTask);
```

---

### **4. Bill Routes** (`/routes/bill.routes.js`) - FUTURE (Pro-only)

| Method | Endpoint | Action | Middleware |
|--------|----------|--------|------------|
| POST | `/api/v1/bills` | Create bill | `protect, checkWriteLimit, checkProAccess` |
| PATCH | `/api/v1/bills/:id` | Update bill | `protect, checkWriteLimit, checkProAccess` |
| POST | `/api/v1/bills/:id/payment` | Add payment | `protect, checkWriteLimit, checkProAccess` |

**Note:** Bills will require BOTH write limit AND Pro access. Chain middleware:
```javascript
router.post('/', protect, checkWriteLimit, checkProAccess, createBill);
```

---

## ❌ Do NOT Apply to These Endpoints

### Read-Only (No Limits)
```javascript
// Ledger
router.get('/transactions', protect, getTransactions);  // ❌ No checkWriteLimit

// Recovery
router.get('/cases', protect, getCases);  // ❌ No checkWriteLimit
router.get('/cases/:id', protect, getCaseById);  // ❌ No checkWriteLimit

// Follow-up
router.get('/tasks', protect, getTasks);  // ❌ No checkWriteLimit
router.get('/tasks/:id', protect, getTaskById);  // ❌ No checkWriteLimit

// Bills
router.get('/bills', protect, getBills);  // ❌ No checkWriteLimit

// Customers
router.get('/customers', protect, getCustomers);  // ❌ No checkWriteLimit
router.post('/customers', protect, createCustomer);  // ❌ No checkWriteLimit (metadata)
```

### Auth & Profile (No Limits)
```javascript
// Auth
router.post('/auth/otp/request', requestOtp);  // ❌ No checkWriteLimit
router.post('/auth/otp/verify', verifyOtp);  // ❌ No checkWriteLimit
router.patch('/auth/me/business', protect, setBusinessName);  // ❌ No checkWriteLimit

// Settings
router.get('/settings', protect, getSettings);  // ❌ No checkWriteLimit
router.patch('/settings', protect, updateSettings);  // ❌ No checkWriteLimit
```

---

## 🧪 Testing Each Endpoint

### 1. Test as Trial User (should allow unlimited):
```bash
# Create trial user
curl -X POST http://localhost:5000/api/v1/auth/otp/request \
  -d '{"mobile":"9999999999"}'

curl -X POST http://localhost:5000/api/v1/auth/otp/verify \
  -d '{"mobile":"9999999999","otp":"0000","device":{"deviceId":"test"}}'

# Get token from response, then test write endpoint:
TOKEN="..."

# Should succeed (trial = unlimited)
for i in {1..12}; do
  curl -X POST http://localhost:5000/api/v1/ledger/credit \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"customerId":"test","amount":100,"note":"Test"}'
done
```

### 2. Test as Free User (should block after 10):
```bash
# Transition user to free in MongoDB:
mongo ph4 --eval 'db.users.updateOne(
  {mobile:"9999999999"},
  {$set:{planStatus:"free",dailyWriteCount:0}}
)'

# Test writes (first 10 succeed, 11-12 blocked):
for i in {1..12}; do
  curl -X POST http://localhost:5000/api/v1/ledger/credit \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"customerId":"test","amount":100,"note":"Test '$i'"}'
  echo ""
done
```

### 3. Verify 403 Response:
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

---

## 🔄 Migration Steps

### Step 1: Update Routes Files
For each route file, add:
```javascript
const { checkWriteLimit } = require('../middleware/writeLimit.middleware');
```

### Step 2: Apply Middleware
Add `checkWriteLimit` after `protect`:
```javascript
router.post('/endpoint', protect, checkWriteLimit, controller);
```

### Step 3: Test Each Endpoint
Run test script or manual curl tests.

### Step 4: Deploy
Once verified, deploy to production.

---

## 📊 Quick Reference Table

| Route File | Endpoints Needing Middleware | Count |
|------------|------------------------------|-------|
| `ledger.routes.js` | credit, debit | 2 |
| `recovery.routes.js` | cases (POST), promise, status, events | 4 |
| `followup.routes.js` | tasks (POST), status, snooze, reschedule | 4 |
| `bill.routes.js` | bills (POST), update, payment | 3 (future) |
| **Total** | | **10+ endpoints** |

---

## ✅ Completion Checklist

- [ ] Import `checkWriteLimit` in each route file
- [ ] Apply to all POST/PATCH write endpoints
- [ ] Verify middleware order: `protect` → `checkWriteLimit` → controller
- [ ] Test trial user (unlimited)
- [ ] Test free user (10 limit)
- [ ] Test 403 response format
- [ ] Update API documentation
- [ ] Deploy to staging
- [ ] Run integration tests
- [ ] Deploy to production

---

## 🚨 Important Notes

1. **Always apply `protect` before `checkWriteLimit`**
   - `checkWriteLimit` requires `req.user` (set by `protect`)

2. **Do NOT apply to read endpoints**
   - Only POST/PATCH/PUT that mutate money-related data

3. **Customer creation is NOT a write**
   - It's metadata, not a financial transaction

4. **Settings updates are NOT writes**
   - User configuration shouldn't count against limits

5. **Test thoroughly before production**
   - Use the test script: `node scripts/test-write-limits.js`

---

**Next:** Update each route file with the middleware, then test!
