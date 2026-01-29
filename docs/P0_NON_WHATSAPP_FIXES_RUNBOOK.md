# P0 Non-WhatsApp Fixes - Implementation Runbook

**Date:** 2026-01-29  
**Version:** 1.0  
**Status:** ✅ Complete

---

## Table of Contents

1. [Overview](#overview)
2. [Phase A: Backend Implementation](#phase-a-backend-implementation)
3. [Phase B: Frontend Implementation](#phase-b-frontend-implementation)
4. [Testing Instructions](#testing-instructions)
5. [Manual Sanity Checks](#manual-sanity-checks)
6. [Rollout Plan](#rollout-plan)

---

## Overview

This document outlines the implementation of P0 non-WhatsApp fixes to improve system reliability, observability, and audit compliance.

### Changes Summary

| Area | Change | Status |
|------|--------|--------|
| Webhooks | Mounted Razorpay webhook routes with raw body middleware | ✅ Complete |
| Timezone | Fixed daily write-limit reset to use IST | ✅ Complete |
| Observability | Added reliability metadata to Today summary endpoints | ✅ Complete |
| Cron | Verified recovery cron execution stats tracking | ✅ Complete |
| Audit | Added audit logging for public bill access | ✅ Complete |
| Frontend | Added DEV-only reliability banner | ✅ Complete |

---

## Phase A: Backend Implementation

### A1) Mount Razorpay Webhook Routes

**Files Modified:**
- `src/app.js` - Added raw body middleware and mounted webhook routes
- `src/controllers/webhook.controller.js` - Added JSON parsing after signature verification
- `.env.example` - Added `RAZORPAY_WEBHOOK_SECRET`

**Changes:**

1. **Raw Body Middleware** (BEFORE express.json())
   ```javascript
   app.use('/webhooks', express.raw({
     type: 'application/json',
     limit: bodyLimits.json,
     verify: (req, res, buf, encoding) => {
       req.rawBody = buf.toString(encoding || 'utf8');
     }
   }));
   ```

2. **Webhook Route Mounting**
   ```javascript
   const webhookRoutes = require('./routes/webhook.routes');
   app.use('/webhooks', webhookRoutes);
   ```

3. **JSON Parsing in Controller**
   - After signature verification, parses `req.rawBody` to JSON
   - Attaches parsed body to `req.body` for handlers

**Environment Variables:**
```bash
# Required in .env
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_from_dashboard
```

**Test Script:**
```bash
node scripts/test-webhook-signature.js
```

---

### A2) Fix Daily Write-Limit Reset to IST

**Files Modified:**
- `src/utils/timezone.util.js` - Added `getISTDateString()` helper
- `src/models/User.js` - Updated `ensureDailyWriteCounter()` to use IST

**Changes:**

1. **New Helper Function**
   ```javascript
   // Returns YYYY-MM-DD in IST timezone
   function getISTDateString(date) {
     const targetDate = date ? new Date(date) : getNowIST();
     const utc = targetDate.getTime() + (targetDate.getTimezoneOffset() * 60000);
     const istDate = new Date(utc + IST_OFFSET_MS);
     
     const year = istDate.getFullYear();
     const month = String(istDate.getMonth() + 1).padStart(2, '0');
     const day = String(istDate.getDate()).padStart(2, '0');
     
     return `${year}-${month}-${day}`;
   }
   ```

2. **Updated User Model**
   ```javascript
   // Before: new Date().toISOString().split('T')[0] (UTC)
   // After:  getISTDateString() (IST)
   
   dailyWriteDate: {
     type: String,
     default: () => getISTDateString(),
   }
   
   userSchema.methods.ensureDailyWriteCounter = async function () {
     const todayIST = getISTDateString();
     // ... reset if date changed
   };
   ```

**Critical Fix:**
- UTC 2026-01-29 23:45 → UTC date: `2026-01-29`
- IST 2026-01-30 05:15 → IST date: `2026-01-30` ✅
- Counter now resets at IST midnight, not UTC midnight

**Test Script:**
```bash
node scripts/test-write-limit-timezone.js
```

---

### A3) Add Reliability + Observability to Today Summary

**Files Modified:**
- `src/controllers/today.controller.js` - Added reliability tracking to `getTodaySummary`

**Changes:**

1. **Reliability Metadata Structure**
   ```javascript
   {
     ok: boolean,               // false if any query failed
     queriesSucceeded: [],      // ['receivable', 'overdue', ...]
     queriesFailed: [],         // ['brokenPromises', ...]
     queryDurations: {          // { receivable: 45ms, ... }
       receivable: 45,
       overdue: 67,
       dueToday: 23,
       brokenPromises: 12,
       chaseCounts: 34
     }
   }
   ```

2. **Query Execution Wrapper**
   - Each compute function wrapped in try-catch
   - Measures duration (ms)
   - On failure: logs error, returns fallback value (zeros)
   - On success: logs timing, returns actual data

3. **Response Structure** (Additive - No Breaking Changes)
   ```javascript
   {
     date: '2026-01-29',
     moneyAtRisk: { ... },      // Existing fields unchanged
     chaseCounts: { ... },      // Existing fields unchanged
     meta: { ... },             // Existing fields unchanged
     reliabilityMeta: { ... }   // NEW: Additive field
   }
   ```

**Benefits:**
- Never silently returns wrong zeros
- Immediate visibility into backend query failures
- Performance monitoring per query
- Structured logs with requestId

**Test Script:**
```bash
MONGO_URI=mongodb://localhost:27017/ph4-test node scripts/test-today-summary-reliability.js
```

---

### A4) Recovery Cron Execution Stats

**Files Modified:**
- None (already implemented correctly)

**Verified:**
- `src/cron/recoveryTaskProcessing.cron.js` - Already has structured logging
- `src/models/CronLock.js` - Already tracks execution stats

**Execution Stats Tracked:**
```javascript
{
  lastExecutionAt: Date,
  lastExecutionStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED',
  lastExecutionDuration: Number, // milliseconds
  lastExecutionStats: {
    processed: Number,           // Tasks found
    attempted: Number,           // Delivery attempts created
    errors: Number,              // Failed tasks
    skipped: Boolean            // Lock not acquired
  }
}
```

**Logs Generated:**
```
[RecoveryTaskCron] Lock acquired
[RecoveryTaskCron] Found due tasks (count: 5)
[RecoveryTaskCron] Delivery attempt created (taskId: ..., channel: WHATSAPP)
[RecoveryTaskCron] Processing complete { processed: 5, attempted: 5, errors: 0 }
```

**Test Script:**
```bash
MONGO_URI=mongodb://localhost:27017/ph4-test node scripts/test-recovery-auto-generate.js
```

---

### A5) Audit Logging for Public Bill Access

**Files Modified:**
- `src/models/AuditEvent.js` - Added `BILL_SHARE_ACCESSED` action
- `src/controllers/publicBill.controller.js` - Added audit event creation

**Changes:**

1. **New Audit Action**
   ```javascript
   // Added to AuditEvent.action enum
   'BILL_SHARE_ACCESSED'
   ```

2. **Audit Event Creation** (Both HTML and JSON endpoints)
   ```javascript
   await AuditEvent.create({
     actorUserId: bill.userId,
     actorRole: 'SYSTEM',
     action: 'BILL_SHARE_ACCESSED',
     entityType: 'BILL',
     entityId: bill._id,
     businessId: bill.userId,
     metadata: {
       shareTokenPrefix: token.substring(0, 8),  // First 8 chars
       accessCount: shareLink.accessCount,       // Running count
       via: 'public_link_html' | 'public_link_json',
       ip: req.ip,                                // Client IP
       userAgent: req.get('user-agent')          // User agent
     }
   });
   ```

3. **Error Handling**
   - Audit failures don't block the request
   - Failures logged with requestId

**Audit Trail Benefits:**
- Every public bill view leaves evidence
- IP + User-Agent tracking
- Running access count
- Token prefix (first 8 chars for privacy)

**Test Script:**
```bash
MONGO_URI=mongodb://localhost:27017/ph4-test node scripts/test-public-bill-audit.js
```

---

## Phase B: Frontend Implementation

### B1) DEV-Only Reliability Metadata Banner

**Files Modified:**
- `ph4/src/screens/TodayScreen.js` - Added `ReliabilityMetaBanner` component

**Changes:**

1. **New Component** (DEV-only, auto-renders if data present)
   ```javascript
   const ReliabilityMetaBanner = ({reliabilityMeta}) => {
     if (!__DEV__ || !reliabilityMeta) return null;
     
     const {ok, queriesSucceeded, queriesFailed, queryDurations} = reliabilityMeta;
     
     // Only show if there are failures
     if (ok && queriesFailed.length === 0) return null;
     
     return (
       <View style={styles.reliabilityBanner}>
         <AppText>⚠️ Data Reliability: {ok ? 'OK' : 'PARTIAL'}</AppText>
         <AppText>Failed: {queriesFailed.join(', ')}</AppText>
         <AppText>Durations: {...}</AppText>
       </View>
     );
   };
   ```

2. **Rendering** (Top of ScrollView)
   ```javascript
   <ScrollView>
     {backendChaseData?.reliabilityMeta && (
       <ReliabilityMetaBanner reliabilityMeta={backendChaseData.reliabilityMeta} />
     )}
     
     {renderListContent()}
   </ScrollView>
   ```

**User Experience:**
- **Production builds**: No UI changes (banner hidden)
- **DEV builds with healthy data**: No banner shown
- **DEV builds with failed queries**: Yellow banner with details
- **No noise**: Only shows when something actually fails

**Styles:**
- Yellow background (#FEF3C7)
- Amber text (#92400E)
- Subtle, non-intrusive
- Small font (11-12px)

### B2) Timezone Consistency

**Status:** ✅ Verified  
**Finding:** All analytics already use IST consistently via `timezone.util.js`  
**No changes required.**

---

## Testing Instructions

### Automated Tests

Run all test scripts in sequence:

```bash
# Backend tests
cd /Users/naved/Desktop/ph4-backend

# Test 1: Webhook signature verification
node scripts/test-webhook-signature.js

# Test 2: IST timezone for write limits
node scripts/test-write-limit-timezone.js

# Test 3: Today summary reliability
MONGO_URI=mongodb://localhost:27017/ph4-test JWT_SECRET=test node scripts/test-today-summary-reliability.js

# Test 4: Recovery cron execution
MONGO_URI=mongodb://localhost:27017/ph4-test node scripts/test-recovery-auto-generate.js

# Test 5: Public bill audit
MONGO_URI=mongodb://localhost:27017/ph4-test JWT_SECRET=test node scripts/test-public-bill-audit.js
```

**Expected Output:**
```
✅ ALL TESTS PASSED
```

---

## Manual Sanity Checks

### 1. Webhook Signature Verification

**Test:**
```bash
# Start backend
npm run dev

# In another terminal, send test webhook
curl -X POST http://localhost:5055/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: test_signature" \
  -d '{"event":"payment.captured","payload":{}}'
```

**Expected:**
- Status: `401 Unauthorized` (invalid signature)
- Response: `{"success":false,"message":"Invalid signature"}`

**Verify Logs:**
```
[Webhook] Invalid signature received
```

---

### 2. Today Summary Reliability

**Test:**
```bash
# Call Today summary endpoint
curl http://localhost:5055/api/v1/today/summary \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "date": "2026-01-29",
    "moneyAtRisk": { ... },
    "chaseCounts": { ... },
    "meta": { ... },
    "reliabilityMeta": {
      "ok": true,
      "queriesSucceeded": ["receivable", "overdue", "dueToday", "brokenPromises", "chaseCounts"],
      "queriesFailed": [],
      "queryDurations": {
        "receivable": 45,
        "overdue": 23,
        "dueToday": 18,
        "brokenPromises": 12,
        "chaseCounts": 34
      }
    }
  }
}
```

**Verify Logs:**
```
[Today] Starting query: receivable
[Today] Query succeeded: receivable (durationMs: 45)
[Today] Starting query: overdue
[Today] Query succeeded: overdue (durationMs: 23)
...
```

---

### 3. Public Bill Access Audit

**Test:**
```bash
# Get a valid share token
# Then access public bill
curl http://localhost:5055/public/b/YOUR_SHARE_TOKEN

# Check AuditEvent collection
mongo ph4
db.auditevents.find({action: 'BILL_SHARE_ACCESSED'}).pretty()
```

**Expected Audit Event:**
```javascript
{
  "action": "BILL_SHARE_ACCESSED",
  "entityType": "BILL",
  "entityId": ObjectId("..."),
  "actorRole": "SYSTEM",
  "metadata": {
    "shareTokenPrefix": "abc12345",
    "accessCount": 1,
    "via": "public_link_html",
    "ip": "127.0.0.1",
    "userAgent": "curl/7.64.1"
  },
  "at": ISODate("2026-01-29T...")
}
```

---

### 4. Mobile DEV Build Reliability Banner

**Test:**
1. Build mobile app in DEV mode
2. Open Today screen
3. Simulate backend query failure (optional: set env flag)
4. Check for yellow reliability banner

**Expected:**
- **Normal operation**: No banner shown
- **Query failure**: Yellow banner with "Data reliability: PARTIAL" + failed query names

---

## Rollout Plan

### Pre-Deployment Checklist

- [ ] All automated tests pass
- [ ] Manual sanity checks complete
- [ ] Environment variables set:
  ```bash
  RAZORPAY_WEBHOOK_SECRET=...
  ```
- [ ] Webhook URL configured in Razorpay dashboard
- [ ] Database backups taken
- [ ] Monitoring alerts configured

### Deployment Steps

#### 1. Backend Deployment

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies
npm install

# 3. Set environment variables
# Add to .env:
RAZORPAY_WEBHOOK_SECRET=your_production_webhook_secret

# 4. Restart server
pm2 restart ph4-backend
# OR
systemctl restart ph4-backend

# 5. Verify deployment
curl http://localhost:5055/health
```

#### 2. Verify Webhook Mounting

```bash
# Test webhook endpoint is reachable
curl -X POST https://api.yourdomain.com/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -d '{"test":"ping"}'

# Should return 401 (signature required)
```

#### 3. Configure Razorpay Webhook

1. Go to Razorpay Dashboard → Settings → Webhooks
2. Add webhook URL: `https://api.yourdomain.com/webhooks/razorpay`
3. Select events: `payment.captured`
4. Copy webhook secret
5. Add to `.env`: `RAZORPAY_WEBHOOK_SECRET=...`
6. Restart backend

#### 4. Mobile Deployment

```bash
# DEV builds will show reliability banner
# Production builds will not (automatically)

# Build and deploy normally
cd /Users/naved/Desktop/ph4
npm install
npm run build:ios
npm run build:android
```

#### 5. Monitor

**First 24 Hours:**
- Check webhook delivery success rate
- Monitor Today summary query durations
- Check audit event creation
- Verify no regression in existing flows

**Metrics to Watch:**
- Webhook signature verification failures
- Today summary query failures
- Public bill access audit event creation rate
- Recovery cron execution status

---

## Monitoring Queries

### Check Webhook Health

```javascript
// MongoDB - Check recent webhook events
db.payments.find({
  createdAt: {$gt: new Date(Date.now() - 24*60*60*1000)},
  webhookProcessed: true
}).count()
```

### Check Today Summary Reliability

```bash
# Check logs for query failures
grep "Query failed" /var/log/ph4-backend.log

# Check reliabilityMeta in responses
curl http://localhost:5055/api/v1/today/summary -H "Authorization: Bearer TOKEN" | jq '.data.reliabilityMeta'
```

### Check Audit Events

```javascript
// MongoDB - Recent public bill accesses
db.auditevents.find({
  action: 'BILL_SHARE_ACCESSED',
  at: {$gt: new Date(Date.now() - 24*60*60*1000)}
}).count()

// Top accessed bills
db.auditevents.aggregate([
  {$match: {action: 'BILL_SHARE_ACCESSED'}},
  {$group: {_id: '$entityId', count: {$sum: 1}}},
  {$sort: {count: -1}},
  {$limit: 10}
])
```

### Check Recovery Cron Health

```javascript
// MongoDB - Check CronLock
db.cronlocks.findOne({name: 'recovery_task_processing'})

// Check last execution
db.cronlocks.findOne(
  {name: 'recovery_task_processing'},
  {lastExecutionAt: 1, lastExecutionStatus: 1, lastExecutionStats: 1}
)
```

---

## Rollback Plan

If issues arise, rollback steps:

### 1. Revert Backend Code

```bash
# Revert to previous commit
git revert HEAD
git push origin main

# Redeploy
pm2 restart ph4-backend
```

### 2. Disable Webhook

```bash
# In Razorpay dashboard: Disable webhook
# OR comment out in app.js:
# // app.use('/webhooks', webhookRoutes);
```

### 3. Revert Mobile

```bash
# Revert TodayScreen.js changes
git checkout HEAD~1 ph4/src/screens/TodayScreen.js

# Rebuild and deploy
npm run build
```

---

## Success Criteria

✅ **Phase A Complete:**
- [ ] Webhook endpoint returns 200 for valid signatures
- [ ] Daily write limit resets at IST midnight
- [ ] Today summary includes reliabilityMeta
- [ ] Recovery cron updates CronLock stats
- [ ] Public bill access creates audit events

✅ **Phase B Complete:**
- [ ] DEV builds show reliability banner on failures
- [ ] Production builds show no extra UI
- [ ] No performance regression

✅ **Production Ready:**
- [ ] All automated tests pass
- [ ] Manual sanity checks pass
- [ ] Monitoring configured
- [ ] Documentation complete

---

## Support & Troubleshooting

### Common Issues

#### 1. Webhook Signature Verification Fails

**Symptom:** 401 errors on webhook endpoint

**Fix:**
```bash
# Check RAZORPAY_WEBHOOK_SECRET is set
echo $RAZORPAY_WEBHOOK_SECRET

# Verify it matches Razorpay dashboard secret
# Test with: node scripts/test-webhook-signature.js
```

#### 2. Daily Write Limit Not Resetting

**Symptom:** User still sees limit after IST midnight

**Check:**
```javascript
// MongoDB - Check user dailyWriteDate
db.users.findOne({_id: ObjectId('...')}, {dailyWriteDate: 1, dailyWriteCount: 1})

// Should show current IST date (not UTC)
```

#### 3. Today Summary Returns All Zeros

**Symptom:** Dashboard shows 0 for all metrics

**Check:**
```bash
# Check reliabilityMeta in response
curl .../today/summary | jq '.data.reliabilityMeta'

# If queriesFailed contains items, check backend logs for errors
grep "Query failed" /var/log/ph4-backend.log
```

---

## Appendix

### Test Script Locations

```
ph4-backend/scripts/
├── test-webhook-signature.js           # Webhook signature verification
├── test-write-limit-timezone.js        # IST timezone validation
├── test-today-summary-reliability.js   # Today summary reliability
├── test-recovery-auto-generate.js      # Recovery cron execution
└── test-public-bill-audit.js          # Public bill audit logging
```

### Modified Files

**Backend:**
- `src/app.js`
- `src/controllers/webhook.controller.js`
- `src/controllers/today.controller.js`
- `src/controllers/publicBill.controller.js`
- `src/models/AuditEvent.js`
- `src/models/User.js`
- `src/utils/timezone.util.js`
- `.env.example`

**Frontend:**
- `src/screens/TodayScreen.js`

**Documentation:**
- `docs/P0_NON_WHATSAPP_FIXES_RUNBOOK.md`

### Related Documentation

- [PAYMENT_LOOP.md](./PAYMENT_LOOP.md) - Payment integration guide
- [AGING_ANALYTICS.md](./AGING_ANALYTICS.md) - Aging KPI dashboard
- [DISPUTE_AND_PAUSE.md](./DISPUTE_AND_PAUSE.md) - Dispute management

---

**Last Updated:** 2026-01-29  
**Maintainer:** Backend Team  
**Status:** ✅ Production Ready
