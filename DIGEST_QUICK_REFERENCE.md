# Daily Digest - Quick Reference

## 🚀 Quick Start

### **1. Test Locally (if running local server)**

```bash
cd /Users/naved/Desktop/ph4-backend

# Get JWT from login
# Get DEV_PUSH_KEY from .env

# Test both digests
JWT=<your_jwt> DEV_PUSH_KEY=<your_key> \
./scripts/test-daily-digests.sh both
```

---

### **2. Test on Render (Production)**

```bash
JWT=<your_jwt> DEV_PUSH_KEY=<render_env_key> \
BASE_URL=https://profithooks-api.onrender.com \
./scripts/test-daily-digests.sh both
```

---

## 📋 API Endpoints

### **Trigger AM Digest**
```
POST /api/v1/dev/notifications/digest/am?date=YYYY-MM-DD
Headers:
  Authorization: Bearer <JWT>
  X-DEV-PUSH-KEY: <DEV_PUSH_KEY>
```

### **Trigger EOD Digest**
```
POST /api/v1/dev/notifications/digest/eod?date=YYYY-MM-DD
Headers:
  Authorization: Bearer <JWT>
  X-DEV-PUSH-KEY: <DEV_PUSH_KEY>
```

---

## 📅 Scheduled Times

| Digest | IST Time | UTC Time | Cron |
|--------|----------|----------|------|
| **AM** | 09:00 | 03:30 | `30 3 * * *` |
| **EOD** | 20:30 | 15:00 | `0 15 * * *` |

---

## 🔍 Check Logs

### **Render Logs:**
```bash
# View recent logs
render logs --tail 100

# Search for digest logs
render logs --tail 1000 | grep "Daily Digest"
```

### **Expected Log Pattern:**
```
[NotificationGenCron] ▶️  Daily Digest AM started
[DailyDigestAM] ▶️  Generator started {"dayKey":"2026-01-30"}
[DailyDigestAM] ✅ Generator completed {"created":45,"skipped":35}
[NotificationGenCron] ✅ Daily Digest AM completed {"elapsedMs":3456}
```

---

## 🗄️ Check DB

### **MongoDB Query (via Compass or shell):**

```javascript
// Count AM digests created today
db.notifications.countDocuments({
  kind: 'DAILY_DIGEST_AM',
  createdAt: {$gte: new Date('2026-01-30T03:30:00Z')}
});

// View recent AM digest
db.notifications.findOne({
  kind: 'DAILY_DIGEST_AM'
}, {}, {sort: {createdAt: -1}});

// Check for duplicates (should be 0)
db.notifications.aggregate([
  {$match: {kind: 'DAILY_DIGEST_AM'}},
  {$group: {
    _id: {userId: '$userId', dayKey: '$metadata.dayKey'},
    count: {$sum: 1}
  }},
  {$match: {count: {$gt: 1}}}
]);
```

---

## 📱 Check Mobile

### **Push Notification:**
- Open mobile app
- Wait 1-2 minutes after digest generation
- Should receive push notification
- Tap → Opens app (deep-link in Step 4)

### **In-App Notification:**
- Open mobile app
- Navigate to Notifications/Inbox screen
- Should see digest notification with:
  - Title: "☀️ X follow-ups pending today"
  - Body with counts
  - Tap to view details

---

## 🐛 Troubleshooting

### **Issue: No notifications created**

**Check:**
1. Do users have any followup tasks?
   ```javascript
   db.followuptasks.countDocuments({status: {$ne: 'done'}});
   ```

2. Are notifications being skipped due to zero counts?
   ```
   Check logs for: "created":0,"skipped":80
   ```

3. Is the date correct?
   ```javascript
   // Verify IST date
   const {getIstDayWindow} = require('./src/utils/istWindow');
   console.log(getIstDayWindow());
   // Should match expected date
   ```

---

### **Issue: Duplicate notifications**

**Check:**
1. Query for duplicates:
   ```javascript
   db.notifications.aggregate([
     {$match: {kind: 'DAILY_DIGEST_AM'}},
     {$group: {_id: '$idempotencyKey', count: {$sum: 1}}},
     {$match: {count: {$gt: 1}}}
   ]);
   ```

2. Verify index exists:
   ```javascript
   db.notifications.getIndexes();
   // Should include: {userId: 1, idempotencyKey: 1}
   ```

**Fix:** Index should prevent duplicates automatically

---

### **Issue: Wrong time zone**

**Check:**
1. Verify IST offset:
   ```javascript
   const {getNowIST} = require('./src/utils/timezone.util');
   console.log('IST Now:', getNowIST());
   console.log('UTC Now:', new Date());
   // Difference should be ~5.5 hours
   ```

2. Verify day boundaries:
   ```javascript
   const {getIstDayWindow} = require('./src/utils/istWindow');
   const today = getIstDayWindow();
   console.log(today);
   // dayKey should match IST date, not UTC
   ```

---

### **Issue: Push not received**

**Check:**
1. Is FCM token registered?
   ```javascript
   db.devices.find({userId: ObjectId('<userId>')});
   // Should have fcmToken field
   ```

2. Is delivery worker running?
   ```bash
   render logs | grep "NotificationDeliveryWorker"
   # Should show periodic processing
   ```

3. Are channels correct?
   ```javascript
   db.notifications.findOne({kind: 'DAILY_DIGEST_AM'});
   // Check channels array includes 'PUSH'
   ```

---

## 📊 Success Metrics

### **What to Monitor:**

| Metric | Target | Check |
|--------|--------|-------|
| **Created/Skipped Ratio** | 50-70% created | Logs |
| **Elapsed Time** | < 5 seconds | Logs |
| **Error Rate** | < 1% | Error logs |
| **Duplicate Rate** | 0% | DB query |
| **Push Delivery Rate** | > 95% | Delivery worker logs |

---

## 🎯 Expected Behavior

### **Day 1 (Fresh Start):**
```
09:00 IST → AM Digest runs
  Created: 45 (users with pending followups)
  Skipped: 35 (users with no activity)

20:30 IST → EOD Digest runs
  Created: 52 (users with activity today)
  Skipped: 28 (users with no activity)
```

### **Day 2 (With Idempotency):**
```
09:00 IST → AM Digest runs
  Created: 47 (new pending followups)
  Skipped: 33 (no activity)

09:15 IST → Admin manually triggers AM
  Created: 0 (all skipped due to idempotency)
  Skipped: 80 (duplicate keys)

20:30 IST → EOD Digest runs
  Created: 50
  Skipped: 30
```

---

## 🔑 Environment Variables Required

```bash
# In Render environment or .env
DEV_PUSH_KEY=<secret_key>    # For dev endpoints
FIREBASE_SERVICE_ACCOUNT_JSON=<json>  # For push delivery
MONGO_URI=<connection_string>
```

---

## 📞 Support Commands

### **Get Help:**
```bash
# View full implementation docs
cat DAILY_DIGEST_IMPLEMENTATION.md

# View exact diffs
cat DAILY_DIGEST_DIFFS.md

# View this quick reference
cat DIGEST_QUICK_REFERENCE.md
```

### **Test Endpoints:**
```bash
# Test AM only
./scripts/test-daily-digests.sh am

# Test EOD only
./scripts/test-daily-digests.sh eod

# Test both
./scripts/test-daily-digests.sh both
```

---

## ✅ CHECKLIST

- [ ] Files deployed to production
- [ ] Cron logs show scheduled times correctly
- [ ] Manual test via curl succeeds
- [ ] Notifications created in DB
- [ ] Push notifications received on mobile
- [ ] No duplicate notifications
- [ ] IST dates correct in metadata
- [ ] Zero-count skipping works
- [ ] Idempotency verified

---

**Status: READY FOR PRODUCTION ✅**

Test with: `JWT=<jwt> DEV_PUSH_KEY=<key> ./scripts/test-daily-digests.sh both`
