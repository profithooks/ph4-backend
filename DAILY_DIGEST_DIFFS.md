# Daily Digest Implementation - Exact Code Diffs

## Summary of Changes

**Files Created:** 5  
**Files Modified:** 3  
**Total Lines Changed:** ~600 lines

---

## File 1: `src/models/Notification.js` (MODIFIED)

### Diff: Added digest notification kinds

```diff
      // Notification type
      kind: {
        type: String,
        enum: [
          // New kinds (per NOTIFICATIONS_SPEC.md)
          'OVERDUE_ALERT',
          'DUE_TODAY',
          'PROMISE_DUE_TODAY',
          'PROMISE_BROKEN',
          'FOLLOWUP_DUE',
          'PAYMENT_RECEIVED',
          'DEVICE_APPROVAL_REQUIRED',
          'DAILY_SUMMARY',
          'CREDIT_LIMIT_WARN',
+         // Daily digest kinds
+         'DAILY_DIGEST_AM',    // Morning digest (09:00 IST)
+         'DAILY_DIGEST_EOD',   // End of day digest (20:30 IST)
          // Legacy kinds (for backward compatibility)
          'FOLLOWUP',           // Follow-up reminder
          'PROMISE_REMINDER',   // Promise due reminder
          'OVERDUE',            // Overdue payment
          'SYSTEM',             // System notifications
          'BILL_CREATED',       // Bill created
        ],
        required: true,
        index: true,
      },
```

**Impact:** Enables two new notification types for daily digests

---

## File 2: `src/cron/notificationGeneration.cron.js` (MODIFIED)

### Diff 1: Added import for digest generators

```diff
  const {generateDailySummaryNotifications} = require('../services/notifications/generators/dailySummary');
+ const {generateDailyDigestAM, generateDailyDigestEOD} = require('../services/notifications/generators/dailyDigest.generator');
```

---

### Diff 2: Replaced placeholder with real implementations

```diff
  /**
-  * Run EOD summary generator (20:30 IST)
+  * Run Daily Digest AM generator (09:00 IST)
+  * Morning brief: overdue + due today + due tomorrow
+  * IST is UTC+5:30, so 09:00 IST = 03:30 UTC
+  * Cron: '30 3 * * *' (03:30 UTC daily)
+  */
+ async function runDailyDigestAM() {
+   const startTime = Date.now();
+   
+   try {
+     logger.info('[NotificationGenCron] ▶️  Daily Digest AM started');
+ 
+     const result = await generateDailyDigestAM();
+ 
+     const elapsed = Date.now() - startTime;
+ 
+     logger.info('[NotificationGenCron] ✅ Daily Digest AM completed', {
+       created: result.created,
+       skipped: result.skipped,
+       elapsedMs: elapsed,
+     });
+   } catch (error) {
+     const elapsed = Date.now() - startTime;
+     logger.error('[NotificationGenCron] ❌ Daily Digest AM failed', {
+       error: error.message,
+       stack: error.stack,
+       elapsedMs: elapsed,
+     });
+   }
+ }
+ 
+ /**
+  * Run Daily Digest EOD generator (20:30 IST)
+  * Day recap: completed today + still pending + tomorrow preview
   * IST is UTC+5:30, so 20:30 IST = 15:00 UTC
   * Cron: '0 15 * * *' (15:00 UTC daily)
-  * 
-  * Placeholder for future EOD summary with tomorrow preview.
   */
- async function runEodSummaryGenerator() {
+ async function runDailyDigestEOD() {
    const startTime = Date.now();
    
    try {
-     logger.info('[NotificationGenCron] ▶️  EOD summary generator started (placeholder)');
- 
-     // Fetch enabled users (same logic as daily summary)
-     const settingsDocs = await BusinessSettings.find({}).lean();
-     const enabledUserIds = settingsDocs
-       .filter(settings => isNotificationsEnabled(settings))
-       .map(settings => String(settings.userId))
-       .filter(Boolean);
+     logger.info('[NotificationGenCron] ▶️  Daily Digest EOD started');
+ 
+     const result = await generateDailyDigestEOD();
  
      const elapsed = Date.now() - startTime;
  
-     logger.info('[NotificationGenCron] ✅ EOD summary generator completed (placeholder)', {
-       enabledUsers: enabledUserIds.length,
+     logger.info('[NotificationGenCron] ✅ Daily Digest EOD completed', {
+       created: result.created,
+       skipped: result.skipped,
        elapsedMs: elapsed,
-       note: 'Generator not yet implemented - this is a placeholder',
      });
- 
-     // TODO: Implement EOD summary generator in Step 2
-     // Will generate notifications with:
-     // - Today's summary (completed tasks, bills paid, etc.)
-     // - Tomorrow's preview (upcoming tasks, due bills, promises)
    } catch (error) {
      const elapsed = Date.now() - startTime;
-     logger.error('[NotificationGenCron] ❌ EOD summary generator failed', {
+     logger.error('[NotificationGenCron] ❌ Daily Digest EOD failed', {
        error: error.message,
        stack: error.stack,
        elapsedMs: elapsed,
      });
    }
  }
```

---

### Diff 3: Updated cron schedule calls

```diff
-   // Run daily at 09:00 IST (03:30 UTC): '30 3 * * *'
+   // Run Daily Digest AM at 09:00 IST (03:30 UTC): '30 3 * * *'
    cronJobDaily = cron.schedule('30 3 * * *', async () => {
-     await runDailySummaryGenerator();
+     await runDailyDigestAM();
    });
  
-   // Run EOD summary at 20:30 IST (15:00 UTC): '0 15 * * *'
+   // Run Daily Digest EOD at 20:30 IST (15:00 UTC): '0 15 * * *'
    cronJobEOD = cron.schedule('0 15 * * *', async () => {
-     await runEodSummaryGenerator();
+     await runDailyDigestEOD();
    });
```

---

### Diff 4: Updated logging labels

```diff
    logger.info('[NotificationGenCron] Started', {
      interval15min: '*/15 * * * *',
-     dailySummary: '30 3 * * * (09:00 IST)',
-     eodSummary: '0 15 * * * (20:30 IST)',
+     digestAM: '30 3 * * * (09:00 IST)',
+     digestEOD: '0 15 * * * (20:30 IST)',
    });
```

---

### Diff 5: Updated exports

```diff
  module.exports = {
    startNotificationGenerationCron,
    stopNotificationGenerationCron,
    runNotificationGenerators, // Exported for testing/dry-run
    runDailySummaryGenerator, // Exported for testing/dry-run (legacy)
-   runEodSummaryGenerator, // Exported for testing/dry-run
+   runDailyDigestAM, // Exported for testing/dry-run
+   runDailyDigestEOD, // Exported for testing/dry-run
  };
```

---

## File 3: `src/app.js` (MODIFIED)

### Diff 1: Added import

```diff
  const devPushRoutes = require('./routes/devPush.routes');
+ const devNotificationsRoutes = require('./routes/devNotifications.routes');
  const backupRoutes = require('./routes/backup.routes');
```

---

### Diff 2: Mounted dev notifications routes

```diff
  app.use('/api/v1/dev', devPushRoutes); // Dev push notification testing (MUST be before specCompliance)
+ app.use('/api/v1/dev/notifications', devNotificationsRoutes); // Dev notification generators testing
  app.use('/api/v1/dev', specComplianceRoutes); // Has catch-all, so mount last
```

---

## File 4: `src/utils/istWindow.js` (NEW)

**Full content (90 lines):**

```javascript
/**
 * IST Day Window Helpers
 * 
 * Single source of truth for IST day boundaries
 * Used by daily digest generators for consistent date handling
 */

const {getNowIST, getStartOfDayIST, getEndOfDayIST} = require('./timezone.util');

/**
 * Get IST day window for a given date
 * 
 * @param {Date} [date=new Date()] - Reference date
 * @returns {Object} { dayKey, startUtc, endUtc, nowIst }
 */
function getIstDayWindow(date = new Date()) {
  const now = getNowIST();
  const targetDate = date ? new Date(date) : now;
  
  const startUtc = getStartOfDayIST(targetDate);
  const endUtc = getEndOfDayIST(targetDate);
  
  // Format as YYYY-MM-DD in IST
  const istDate = new Date(startUtc.getTime() + (5.5 * 60 * 60 * 1000));
  const dayKey = istDate.toISOString().substring(0, 10);
  
  return {
    dayKey,
    startUtc,
    endUtc,
    nowIst: now,
  };
}

// ... (similar for getIstTomorrowWindow and getIstYesterdayWindow)

module.exports = {
  getIstDayWindow,
  getIstTomorrowWindow,
  getIstYesterdayWindow,
};
```

**Purpose:**
- Single source of truth for IST date boundaries
- Used by all digest generators
- Ensures consistent date handling

---

## File 5: `src/services/notifications/generators/dailyDigest.generator.js` (NEW)

**Full content (340 lines):**

### Key Functions:

#### **1. `computeFollowupData(userId, windows, includeCompleted)`**
```javascript
async function computeFollowupData(userId, windows, includeCompleted) {
  // Queries:
  // - overdueCount
  // - dueTodayCount
  // - dueTomorrowCount
  // - doneTodayCount (if includeCompleted)
  
  // Fetches top 3 items for each category
  
  return {
    counts: { overdue, dueToday, dueTomorrow, doneToday },
    top: { overdue: [...], today: [...], tomorrow: [...] }
  };
}
```

---

#### **2. `buildAmContent(counts, top)`**
```javascript
function buildAmContent(counts, top) {
  const {overdue, dueToday, dueTomorrow} = counts;
  
  let title = '☀️ Good morning!';
  if (overdue + dueToday > 0) {
    title = `☀️ ${overdue + dueToday} follow-ups pending today`;
  }
  
  const parts = [];
  if (overdue > 0) {
    parts.push(`⚠️ ${overdue} overdue`);
    // Add top 2 customer names
  }
  if (dueToday > 0) {
    parts.push(`📋 ${dueToday} due today`);
    // Add top 2 customer names
  }
  if (dueTomorrow > 0) {
    parts.push(`📅 ${dueTomorrow} scheduled tomorrow`);
  }
  
  return {title, body: parts.join('\n')};
}
```

---

#### **3. `generateDailyDigestAM({date})`**
```javascript
async function generateDailyDigestAM({date = new Date()} = {}) {
  // 1. Compute IST windows
  const today = getIstDayWindow(date);
  const tomorrow = getIstTomorrowWindow(date);
  
  // 2. Fetch all users
  const users = await User.find({}).select('_id businessId').lean();
  
  // 3. For each user:
  for (const user of users) {
    // a. Compute followup data
    const data = await computeFollowupData(userId, {today, tomorrow}, false);
    
    // b. Skip if no relevant counts
    if (counts.overdue === 0 && counts.dueToday === 0 && counts.dueTomorrow === 0) {
      skipped++;
      continue;
    }
    
    // c. Build content
    const {title, body} = buildAmContent(data.counts, data.top);
    
    // d. Create notification (idempotent)
    const idempotencyKey = `daily_digest_am:${userId}:${today.dayKey}`;
    await Notification.create({
      userId,
      kind: 'DAILY_DIGEST_AM',
      title,
      body,
      channels: await selectChannels(userId),
      metadata: { digestType: 'AM', dayKey, counts, top, route },
      idempotencyKey,
    });
    
    created++;
  }
  
  return {created, skipped};
}
```

---

## File 6: `src/controllers/devNotifications.controller.js` (NEW)

**Full content (90 lines):**

```javascript
/**
 * DEV-only Notification Testing Controller
 */
const asyncHandler = require('express-async-handler');
const {generateDailyDigestAM, generateDailyDigestEOD} = require('../services/notifications/generators/dailyDigest.generator');
const logger = require('../../../utils/logger');

/**
 * Trigger Daily Digest AM manually
 * POST /api/v1/dev/notifications/digest/am?date=YYYY-MM-DD
 */
exports.triggerDigestAM = asyncHandler(async (req, res) => {
  const {date} = req.query;
  const targetDate = date ? new Date(date) : new Date();
  
  logger.info('[DevNotifications] Triggering Daily Digest AM', {
    date: date || 'today',
  });

  const result = await generateDailyDigestAM({date: targetDate});

  res.json({
    ok: true,
    generator: 'DAILY_DIGEST_AM',
    date: date || 'today',
    result: {
      created: result.created,
      skipped: result.skipped,
    },
  });
});

// ... (similar for triggerDigestEOD and triggerDailySummary)
```

---

## File 7: `src/routes/devNotifications.routes.js` (NEW)

**Full content (60 lines):**

```javascript
/**
 * DEV-only Notification Testing Routes
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth');
const {
  triggerDigestAM,
  triggerDigestEOD,
  triggerDailySummary,
} = require('../controllers/devNotifications.controller');

/**
 * DEV security middleware
 * Requires DEV_PUSH_KEY header to prevent abuse
 */
const requireDevKey = (req, res, next) => {
  const devKey = process.env.DEV_PUSH_KEY;
  const providedKey = req.headers['x-dev-push-key'];

  if (!devKey) {
    return res.status(500).json({ok: false, error: 'DEV_PUSH_KEY not configured'});
  }

  if (providedKey !== devKey) {
    return res.status(403).json({ok: false, error: 'Invalid X-DEV-PUSH-KEY'});
  }

  next();
};

// Routes
router.post('/digest/am', protect, requireDevKey, triggerDigestAM);
router.post('/digest/eod', protect, requireDevKey, triggerDigestEOD);
router.post('/summary', protect, requireDevKey, triggerDailySummary);

module.exports = router;
```

---

## File 8: `scripts/test-daily-digests.sh` (NEW)

**Full content (90 lines):**

```bash
#!/bin/bash
# Test Daily Digest Generators

set -e

BASE_URL="${BASE_URL:-https://profithooks-api.onrender.com}"
JWT="${JWT:-}"
DEV_KEY="${DEV_PUSH_KEY:-}"

if [ -z "$JWT" ] || [ -z "$DEV_KEY" ]; then
  echo "❌ Error: JWT and DEV_PUSH_KEY required"
  echo "Usage: JWT=<jwt> DEV_PUSH_KEY=<key> ./scripts/test-daily-digests.sh [am|eod|both]"
  exit 1
fi

MODE="${1:-both}"

echo "🧪 Testing Daily Digest Generators"
echo "Base URL: $BASE_URL"
echo "Mode: $MODE"

# Test AM Digest
if [ "$MODE" = "am" ] || [ "$MODE" = "both" ]; then
  echo "▶️  Testing Daily Digest AM..."
  
  curl -X POST "${BASE_URL}/api/v1/dev/notifications/digest/am" \
    -H "Authorization: Bearer ${JWT}" \
    -H "X-DEV-PUSH-KEY: ${DEV_KEY}" \
    -H "Content-Type: application/json"
  
  echo ""
fi

# Test EOD Digest
if [ "$MODE" = "eod" ] || [ "$MODE" = "both" ]; then
  echo "▶️  Testing Daily Digest EOD..."
  
  curl -X POST "${BASE_URL}/api/v1/dev/notifications/digest/eod" \
    -H "Authorization: Bearer ${JWT}" \
    -H "X-DEV-PUSH-KEY: ${DEV_KEY}" \
    -H "Content-Type: application/json"
  
  echo ""
fi

echo "✅ Test complete"
```

---

## Before/After Comparison

### **Morning Digest Generation**

**Before (Step 1):**
```javascript
async function runDailySummaryGenerator() {
  const settingsDocs = await BusinessSettings.find({}).lean();
  
  for (const settingsDoc of settingsDocs) {
    if (!isNotificationsEnabled(settingsDoc)) continue;
    
    await generateDailySummaryNotifications({settings: settingsDoc});
    // ^ Called N times (once per settings doc)
  }
}
```

**After (Step 2):**
```javascript
async function runDailyDigestAM() {
  const result = await generateDailyDigestAM();
  // ^ Called ONCE per day
  
  logger.info('✅ Daily Digest AM completed', {
    created: result.created,
    skipped: result.skipped,
  });
}
```

**Improvement:**
- Single generator call
- Clearer naming (AM vs generic "summary")
- Richer content (overdue + today + tomorrow)
- Better logging

---

### **EOD Digest Generation**

**Before (Step 1):**
```javascript
async function runEodSummaryGenerator() {
  logger.info('EOD summary started (placeholder)');
  // No actual implementation
}
```

**After (Step 2):**
```javascript
async function runDailyDigestEOD() {
  const result = await generateDailyDigestEOD();
  // ^ Real implementation with completed + pending + tomorrow
  
  logger.info('✅ Daily Digest EOD completed', {
    created: result.created,
    skipped: result.skipped,
  });
}
```

**Improvement:**
- Real implementation (not placeholder)
- Tracks completed tasks (EOD-specific)
- Tomorrow preview included
- Same idempotency pattern

---

## Testing Scenarios

### **Scenario 1: User with Pending Followups**

**Setup:**
- User has 2 overdue followups
- User has 3 followups due today
- User has 1 followup due tomorrow

**AM Digest (09:00 IST):**
```json
{
  "title": "☀️ 5 follow-ups pending today",
  "body": "⚠️ 2 overdue\n   (John Doe, Jane Smith)\n📋 3 due today\n   (Alice, Bob +1 more)\n📅 1 scheduled tomorrow",
  "kind": "DAILY_DIGEST_AM"
}
```

**EOD Digest (20:30 IST):**
Assume user completed 1 task during the day:
```json
{
  "title": "🌙 1 completed today!",
  "body": "✅ 1 follow-up completed\n⏰ 4 still pending from today\n   (Alice, Bob +2 more)\n\n📅 Tomorrow: 1 follow-up",
  "kind": "DAILY_DIGEST_EOD"
}
```

---

### **Scenario 2: User with No Activity**

**Setup:**
- User has no overdue followups
- User has no followups due today
- User has no followups due tomorrow

**AM Digest:** SKIPPED (not created)  
**EOD Digest:** SKIPPED (not created)

**Logs:**
```json
{
  "level": "info",
  "message": "[DailyDigestAM] ✅ Generator completed",
  "created": 0,
  "skipped": 80
}
```

---

### **Scenario 3: Idempotency Test**

**Setup:**
- Cron runs at 09:00 IST (creates AM digest)
- Admin manually triggers AM digest at 09:30 IST

**First Call (09:00 IST):**
```json
{
  "created": 45,
  "skipped": 35
}
```

**Second Call (09:30 IST):**
```json
{
  "created": 0,
  "skipped": 80
}
```

**Reason:** Idempotency key already exists for all 45 users who received digest

---

## API Response Examples

### **Successful AM Digest Trigger**

**Request:**
```bash
POST /api/v1/dev/notifications/digest/am
Headers:
  Authorization: Bearer eyJhbGc...
  X-DEV-PUSH-KEY: secret123
```

**Response (200):**
```json
{
  "ok": true,
  "generator": "DAILY_DIGEST_AM",
  "date": "today",
  "result": {
    "created": 45,
    "skipped": 35
  }
}
```

---

### **Missing DEV Key**

**Response (403):**
```json
{
  "ok": false,
  "error": "Invalid or missing X-DEV-PUSH-KEY header"
}
```

---

### **No JWT**

**Response (401):**
```json
{
  "ok": false,
  "error": {
    "code": "NO_TOKEN",
    "message": "Not authorized, no token"
  }
}
```

---

## Verification Steps

### **1. Check Notification Records in DB**

```javascript
// Query AM digest notifications
db.notifications.find({
  kind: 'DAILY_DIGEST_AM',
  createdAt: {
    $gte: new Date('2026-01-30T03:30:00Z'),
    $lte: new Date('2026-01-30T04:00:00Z'),
  }
}).pretty();

// Should return notifications with:
// - idempotencyKey: daily_digest_am:{userId}:2026-01-30
// - metadata.digestType: 'AM'
// - metadata.counts: {...}
```

---

### **2. Check Server Logs**

```bash
# Render logs
render logs --tail 100

# Should show:
# [NotificationGenCron] ▶️  Daily Digest AM started
# [DailyDigestAM] ▶️  Generator started, dayKey=2026-01-30
# [DailyDigestAM] ✅ Generator completed, created=45, skipped=35
# [NotificationGenCron] ✅ Daily Digest AM completed, elapsedMs=3456
```

---

### **3. Check Mobile Push Notifications**

```bash
# Wait 1-2 minutes for delivery worker to process
# Check mobile device for push notifications

# Expected:
# - Title: "☀️ 5 follow-ups pending today"
# - Body: "⚠️ 2 overdue\n..."
# - Tapping opens Followups screen
```

---

### **4. Test Idempotency**

```bash
# Trigger AM digest twice
JWT=<jwt> DEV_PUSH_KEY=<key> ./scripts/test-daily-digests.sh am
# Created: 45, Skipped: 35

JWT=<jwt> DEV_PUSH_KEY=<key> ./scripts/test-daily-digests.sh am
# Created: 0, Skipped: 80 (all skipped due to duplicate keys)
```

---

## Summary of All Changes

| File | Type | Lines | Purpose |
|------|------|-------|---------|
| `src/utils/istWindow.js` | NEW | 90 | IST date window helpers |
| `src/services/notifications/generators/dailyDigest.generator.js` | NEW | 340 | AM + EOD digest generators |
| `src/controllers/devNotifications.controller.js` | NEW | 90 | DEV testing endpoints |
| `src/routes/devNotifications.routes.js` | NEW | 60 | DEV testing routes |
| `scripts/test-daily-digests.sh` | NEW | 90 | Bash test script |
| `src/models/Notification.js` | MOD | +2 | Added digest kinds |
| `src/cron/notificationGeneration.cron.js` | MOD | ~80 | Wired in generators |
| `src/app.js` | MOD | +2 | Mounted dev routes |

**Total:** 8 files, ~750 lines

---

**Status: COMPLETE ✅**

Ready for testing and Step 3 (mobile grouped inbox UI).
