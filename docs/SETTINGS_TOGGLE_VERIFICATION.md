# Settings Toggle Verification Guide

**Date**: 2026-01-22  
**Fix**: Added missing schema fields for `recoveryEnabled` and `autoFollowupEnabled`

## Quick Verification

### Test 1: Enable Recovery Engine

1. Open app → Settings → Recovery Engine
2. Toggle "Enable Recovery" ON
3. **Check console logs** (dev mode):
   ```
   [SettingsScreen] Toggle handler called { key: 'recoveryEnabled', nextValue: true, ... }
   [SettingsContext] updateSettings called { partial: { recoveryEnabled: true }, ... }
   [SettingsContext] Backend response received { recoveryEnabled: true, ... }
   ```
4. Navigate away (back button)
5. Navigate back to Settings
6. **Expected**: Toggle remains ON ✅
7. Kill app completely
8. Reopen app → Settings
9. **Expected**: Toggle remains ON ✅

### Test 2: Enable Follow-up Engine

1. Open app → Settings → Follow-up Engine (or Automation Settings)
2. Toggle "Enable Auto Follow-up" ON
3. **Check console logs** (dev mode)
4. Navigate away and back
5. **Expected**: Toggle remains ON ✅
6. Kill app and reopen
7. **Expected**: Toggle remains ON ✅

### Test 3: Backend Logs (Dev Mode)

When toggling, check backend logs:

```
[Settings] Update request received {
  recoveryEnabled: true,
  userId: "...",
  requestId: "..."
}
[Settings] Setting recoveryEnabled { value: true, original: true }
[Settings] Update completed {
  persisted: { recoveryEnabled: true, autoFollowupEnabled: false },
  updatedAt: "..."
}
```

### Test 4: Database Verification

Query MongoDB:

```javascript
db.businesssettings.findOne(
  { userId: ObjectId("YOUR_USER_ID") },
  {
    recoveryEnabled: 1,
    autoFollowupEnabled: 1,
    updatedAt: 1,
    _id: 0
  }
)
```

**Expected Output** (when Recovery enabled):
```json
{
  "recoveryEnabled": true,
  "autoFollowupEnabled": false,
  "updatedAt": ISODate("2026-01-22T...")
}
```

## What Was Fixed

### Root Cause
The `recoveryEnabled` and `autoFollowupEnabled` fields were missing from the Mongoose schema, so Mongoose silently ignored them during updates.

### Solution
1. Added missing fields to `BusinessSettings` schema
2. Added instrumentation logs throughout data path
3. Fixed nested `channelsEnabled` update handling
4. Added explicit Boolean conversion

## Files Changed

### Backend
- `/src/models/BusinessSettings.js` - Added schema fields
- `/src/controllers/settings.controller.js` - Added logs, fixed nested updates

### Frontend
- `/src/state/SettingsContext.js` - Added instrumentation logs
- `/src/screens/SettingsScreen.js` - Added toggle handler logs
- `/src/screens/settings/AutomationSettingsScreen.js` - Added toggle handler logs
- `/src/services/settingsStore.js` - Added API call logs

## Troubleshooting

### If toggle still flips back:

1. **Check backend logs** - Are values being persisted?
2. **Check database** - Do fields exist and have correct values?
3. **Check frontend logs** - Is backend returning correct values?
4. **Check for kill switches** - Are feature kill switches blocking?
5. **Check prerequisites** - Are there any validation errors?

### Common Issues

1. **Existing records**: Old records won't have these fields until first update
2. **Kill switches**: `featureKillSwitches.recoveryEngine` or `featureKillSwitches.followupEngine` can block features even if enabled
3. **Cache**: Clear app cache if issues persist

## Next Steps (If Prerequisites Needed)

If enabling requires prerequisites (e.g., WhatsApp setup), implement:

1. Backend validation check
2. Return structured error: `{ ok: false, blockedBy: "WHATSAPP_NOT_CONFIGURED", message: "..." }`
3. Frontend shows modal/toast with CTA
4. UI hint under toggle: "Requires WhatsApp setup"

---

**Status**: ✅ FIXED  
**Ready for Testing**: ✅ YES
