# Interest E2E Verification Checklist

**Date**: 2026-01-22  
**Feature**: Interest as "Cost of Delay" - End-to-End Implementation

## Prerequisites

1. Backend running and accessible
2. Mobile app connected to backend
3. Interest Policy settings accessible in app
4. Test user with at least one customer and ability to create bills

## Test Scenarios

### Scenario 1: Enable Interest Policy

**Steps**:
1. Open app → Settings → Interest Policy
2. Enable "Interest Policy" toggle
3. Set rate: `2%` per month
4. Set grace days: `0` (or `5` for testing grace period)
5. Set cap: `100%` of principal
6. Save settings

**Expected**:
- Settings save successfully
- No errors in console
- Settings persist after app restart

---

### Scenario 2: Create Overdue Bill and Verify Interest

**Steps**:
1. Create a bill:
   - Customer: Any test customer
   - Amount: ₹10,000
   - Due Date: Yesterday (or 10 days ago for more interest)
   - Status: Unpaid
2. Navigate to Bills List screen
3. Find the bill in the list
4. Check bill row for interest display

**Expected**:
- Bill row shows principal amount (₹10,000)
- If interest accrued > 0:
  - Shows "+₹X interest" badge
  - Shows "Total: ₹(principal+interest)" in bill amount
  - Shows "Principal: ₹X" below total
- If no interest yet (within grace):
  - No interest badge shown
  - Only principal amount displayed

**Verification**:
- Interest amount matches backend computation
- Interest per day is visible (if applicable)
- Total with interest = principal + interest

---

### Scenario 3: Bill Detail Screen - Full Interest Breakdown

**Steps**:
1. From Bills List, tap on the overdue bill
2. Scroll to "Interest (Cost of Delay)" section

**Expected**:
- Interest section appears (only if interest policy enabled)
- Shows:
  - Policy snapshot: Rate, Grace Days, Cap
  - Interest start date (dueDate + graceDays)
  - Days accruing
  - Principal (unpaid amount)
  - Interest accrued (if > 0)
  - Interest per day
  - Total Payable = principal + interest
- If interest = 0:
  - Shows "Interest will apply after <date>" message
  - Or "No interest accrued yet"

**Verification**:
- All numbers match backend computation
- Dates are correct (IST timezone)
- Policy settings match current settings

---

### Scenario 4: Today Screen - Interest on Bucket Cards

**Steps**:
1. Navigate to Today screen
2. Check "OVERDUE" bucket card
3. Check "DUE TODAY" bucket card (if any bills due today)

**Expected**:
- OVERDUE card shows:
  - Count of overdue customers
  - Interest line: "+₹X interest accrued | ₹Y/day" (if interest > 0)
- DUE TODAY card shows:
  - Count of due today customers
  - Interest line (if any bills due today have interest)
- PROMISES and UPCOMING cards:
  - No interest lines (interest only applies to overdue bills)

**Verification**:
- Interest totals match sum of all overdue bills' interest
- Per-day rate is sum of all bills' per-day rates
- Numbers update when bills are paid/updated

---

### Scenario 5: Customer Detail - Cost of Delay Card

**Steps**:
1. Navigate to a customer with overdue bills
2. Go to Customer Detail screen
3. Check "Overview" tab
4. Look for "Cost of Delay" card

**Expected**:
- Cost of Delay card appears (only if customer has overdue principal)
- Shows:
  - Principal Overdue: ₹X
  - Interest Accrued: ₹Y (if > 0)
  - Interest Per Day: ₹Z/day
  - 7-Day Projection: ₹(principal + projected interest)
- Card has amber/yellow background (distinct styling)
- If no interest yet:
  - Shows "Interest will apply after grace period" message

**Verification**:
- Totals match sum of all customer's overdue bills
- 7-day projection is accurate
- Card only appears when interest enabled AND customer has overdue principal

---

### Scenario 6: WhatsApp Messages - Interest in Templates

**Steps**:
1. Navigate to Today screen
2. Find an overdue bill item
3. Tap to open WhatsApp message draft
4. Check message text

**Expected**:
- Message includes interest information:
  - If interest accrued > 0:
    - "Total ₹X (incl. ₹Y interest)"
  - If interest will apply later:
    - "Interest will apply after <date>"
- Message is concise and professional
- Hindi-friendly language maintained

**Verification**:
- Interest amounts match bill's interestSummary
- Dates are formatted correctly
- Message doesn't spam (only includes interest when relevant)

---

### Scenario 7: Disable Interest Policy - All Interest Disappears

**Steps**:
1. Go to Settings → Interest Policy
2. Disable "Interest Policy" toggle
3. Save settings
4. Navigate to:
   - Bills List
   - Bill Detail
   - Today Screen
   - Customer Detail

**Expected**:
- All interest lines/badges disappear
- All totals revert to principal only
- Cost of Delay card disappears
- WhatsApp messages don't include interest
- No errors or crashes

**Verification**:
- UI is clean (no interest artifacts)
- All amounts show principal only
- Backend returns interestAccrued = 0 when policy disabled

---

### Scenario 8: Edge Cases

**Test Cases**:
1. **Bill with zero principal** (fully paid):
   - Interest should be 0
   - No interest displayed

2. **Bill within grace period**:
   - Interest = 0
   - Shows "Interest will apply after <date>"

3. **Bill not overdue yet**:
   - Interest = 0
   - No interest displayed

4. **Bill with interest cap reached**:
   - Interest = cap amount
   - Total = principal + cap
   - Per-day rate still shown

5. **Multiple bills for same customer**:
   - Customer Detail shows aggregate interest
   - All bills show individual interest

6. **Date boundary (midnight IST)**:
   - Interest computation uses IST timezone
   - Days calculated correctly across date boundaries

---

## Backend Verification

### API Endpoints

1. **GET /api/bills** (List):
   - Response includes `interestSummary` for each bill
   - Only when `interestEnabled === true`
   - Contains: `interestAccrued`, `interestPerDay`, `totalWithInterest`, `startsAt`, `daysAccruing`

2. **GET /api/bills/:id** (Detail):
   - Response includes `interestDetail` object
   - Contains: `enabled`, `policy`, `computation`, `computedAt`

3. **GET /api/v1/today/chase**:
   - Response includes `interestTotals` object
   - Contains: `overdue`, `today`, `policy`
   - Each bill item includes `interestSummary` (if applicable)

4. **GET /api/v1/customers/:id/interest**:
   - Response includes `costOfDelay` object
   - Contains: `totalPrincipalOverdue`, `totalInterestAccrued`, `totalInterestPerDay`, `next7DaysProjection`

### Computation Verification

Run these checks:

1. **Interest Calculation**:
   ```javascript
   // Example: ₹10,000 overdue for 10 days, 2% per month, 0 grace
   // Expected: dailyRate = (2/100)/30 = 0.0006667
   // Expected: interest = 10000 * 0.0006667 * 10 = 66.67
   // Expected: rounded = 67
   // Expected: total = 10000 + 67 = 10067
   ```

2. **Grace Period**:
   ```javascript
   // Example: ₹10,000 overdue for 10 days, 2% per month, 5 grace
   // Expected: effectiveDays = 10 - 5 = 5
   // Expected: interest = 10000 * 0.0006667 * 5 = 33.33
   // Expected: rounded = 33
   ```

3. **Cap Application**:
   ```javascript
   // Example: ₹10,000 overdue for 100 days, 5% per month, 50% cap
   // Expected: interest before cap = 10000 * (5/100)/30 * 100 = 1666.67
   // Expected: maxInterest = 10000 * 0.5 = 5000
   // Expected: interest = min(1666.67, 5000) = 1666.67
   // Expected: rounded = 1667
   ```

---

## Performance Checks

1. **No N+1 Queries**:
   - Bills list endpoint computes interest in batch
   - Today endpoint computes interest per bill efficiently
   - Customer interest aggregates bills efficiently

2. **Response Times**:
   - Bills list with interest: < 500ms
   - Today endpoint with interest: < 1000ms
   - Customer interest: < 500ms

3. **Frontend Rendering**:
   - No JS thread blocking
   - Smooth scrolling in bills list
   - No excessive re-renders

---

## Known Limitations

1. **Interest computation is real-time**:
   - Interest amounts update on each API call
   - No historical interest snapshots (interest is always computed as-of-now)

2. **WhatsApp messages**:
   - Interest included only for bills (not promises/follow-ups)
   - Interest data must be available in item.interestSummary

3. **Cache refresh**:
   - Today screen refetches on focus
   - Bills list refetches via hydrate()
   - Manual refresh may be needed after bill operations

---

## Success Criteria

✅ All UI screens show interest when policy enabled  
✅ All interest amounts match backend computation  
✅ Interest disappears when policy disabled  
✅ No performance degradation  
✅ No crashes or errors  
✅ WhatsApp messages include interest correctly  
✅ Edge cases handled gracefully  

---

## Troubleshooting

### Interest not showing:
1. Check Interest Policy is enabled in Settings
2. Verify bill is overdue (dueDate < now)
3. Check bill has unpaid amount (grandTotal - paidAmount > 0)
4. Verify grace period has passed (if graceDays > 0)

### Interest amounts mismatch:
1. Check backend logs for computation
2. Verify policy settings (rate, grace, cap)
3. Check date/timezone (IST vs UTC)
4. Verify principal = grandTotal - paidAmount

### Performance issues:
1. Check backend response times
2. Verify no N+1 queries in logs
3. Check frontend re-render counts
4. Verify interest computation is batched

---

## Next Steps (Future Enhancements)

1. Historical interest snapshots (audit trail)
2. Interest payment tracking
3. Interest reports/analytics
4. Interest waiver functionality
5. Compound interest support (currently only simple)
