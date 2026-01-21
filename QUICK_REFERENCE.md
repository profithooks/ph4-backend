# Entitlement Rules - Quick Reference

## **Rules**

| Plan | Bills Creation | Bills Viewing | Customer Writes | Daily Limit |
|------|----------------|---------------|-----------------|-------------|
| Trial | ✅ Yes | ✅ Yes | ✅ Yes | ∞ Unlimited |
| Free | ❌ No (403) | ✅ Yes | ✅ Yes | 10/day |
| Pro | ✅ Yes | ✅ Yes | ✅ Yes | ∞ Unlimited |

---

## **Files Changed**

1. **NEW:** `src/utils/istTimezone.js` - IST date helpers
2. **UPDATED:** `src/models/User.js` - IST integration
3. **UPDATED:** `src/controllers/entitlement.controller.js` - New response format
4. **UPDATED:** `src/routes/bill.routes.js` - Separate view from create
5. **NEW:** `scripts/verify-entitlement-rules.js` - Test script

---

## **Test**

```bash
cd ph4-backend
export MONGO_URI='mongodb://localhost:27017/ph4-dev'
node scripts/verify-entitlement-rules.js
```

Expected: ✅ ALL TESTS PASSED

---

## **Entitlement Response**

```javascript
{
  planStatus: 'trial' | 'free' | 'pro',
  isTrialActive: boolean,
  limits: {
    customerWritesPerDay: null | 10,
    customerWritesUsedToday: number,
    customerWritesRemainingToday: null | number
  },
  permissions: {
    canCreateBills: boolean,
    canCreateCustomerWrites: boolean,
    canViewBills: boolean
  }
}
```

---

## **Key Changes**

✅ Free users can VIEW bills (not create)  
✅ Bill creation doesn't count as customer write  
✅ Daily reset at midnight IST (not UTC)  
✅ Auto-migration for existing users  
✅ Clear permissions in entitlement response  

---

**Full Details:** `ENTITLEMENT_RULES_IMPLEMENTATION_COMPLETE.md`
