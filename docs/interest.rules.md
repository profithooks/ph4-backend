# Interest Policy Rules

**Last Updated**: 2026-01-22  
**Status**: Implemented (Step 8: Interest Calculation)

## Overview

Interest is computed as an **overlay** on bills. Bills themselves are never mutated. Interest is calculated deterministically based on policy settings and displayed as "Cost of Delay" across the application.

## Policy Fields

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `interestEnabled` | Boolean | `false` | - | Master toggle for interest calculation |
| `interestRatePctPerMonth` | Number | `2` | 0-10 | Interest rate per month (percentage) |
| `interestGraceDays` | Number | `0` | 0-365 | Days after due date before interest starts |
| `interestBasis` | String | `'DAILY_SIMPLE'` | `['DAILY_SIMPLE']` | Calculation basis (only simple interest supported) |
| `interestRounding` | String | `'NEAREST_RUPEE'` | `['NEAREST_RUPEE']` | Rounding method |
| `interestCapPctOfPrincipal` | Number | `100` | 0-500 | Maximum interest as % of principal |
| `interestApplyOn` | String | `'OVERDUE_ONLY'` | `['OVERDUE_ONLY']` | When interest applies (only overdue bills) |

## Computation Rules

### 1. Eligibility

Interest applies **only** when:
- `interestEnabled === true`
- Bill has `dueDate` set
- Bill is overdue: `dueDate < asOfDate`
- Bill has unpaid amount: `grandTotal - paidAmount > 0`
- Bill status is `'unpaid'` or `'partial'`

### 2. Principal Calculation

```
principal = grandTotal - paidAmount
```

If `principal <= 0`, interest is zero.

### 3. Overdue Days

```
overdueDays = floor((asOfDate - dueDate) / (24 * 60 * 60 * 1000))
```

If `overdueDays <= 0`, interest is zero.

### 4. Grace Period

```
effectiveDays = max(0, overdueDays - interestGraceDays)
```

If `effectiveDays <= 0`, interest is zero (still within grace period).

### 5. Interest Calculation (DAILY_SIMPLE)

```
dailyRate = (interestRatePctPerMonth / 100) / 30
interest = principal * dailyRate * effectiveDays
```

### 6. Cap Application

```
maxInterest = principal * (interestCapPctOfPrincipal / 100)
interest = min(interest, maxInterest)
```

### 7. Rounding

```
interest = round(interest)  // Nearest rupee
```

### 8. Total Payable

```
totalWithInterest = principal + interest
```

**Important**: Interest is **never added to bill.grandTotal**. It's computed separately and shown as an overlay.

## Date Handling

- All dates are normalized to IST (Indian Standard Time) using existing PH4 date utilities
- `asOfDate` defaults to current server time (backend) or current device time (frontend, but backend should be source of truth)
- Interest computation uses exact date differences (millisecond precision)

## Examples

### Example 1: Basic Interest
- Policy: `rate=2%`, `graceDays=0`, `cap=100%`
- Bill: `grandTotal=10000`, `paidAmount=0`, `dueDate=2026-01-01`
- As of: `2026-01-11` (10 days overdue)
- Computation:
  - `principal = 10000`
  - `overdueDays = 10`
  - `effectiveDays = 10 - 0 = 10`
  - `dailyRate = (2/100)/30 = 0.0006667`
  - `interest = 10000 * 0.0006667 * 10 = 66.67`
  - `interest = round(66.67) = 67`
  - `totalWithInterest = 10000 + 67 = 10067`

### Example 2: With Grace Period
- Policy: `rate=2%`, `graceDays=5`, `cap=100%`
- Bill: `grandTotal=10000`, `paidAmount=0`, `dueDate=2026-01-01`
- As of: `2026-01-11` (10 days overdue)
- Computation:
  - `principal = 10000`
  - `overdueDays = 10`
  - `effectiveDays = 10 - 5 = 5`
  - `dailyRate = (2/100)/30 = 0.0006667`
  - `interest = 10000 * 0.0006667 * 5 = 33.33`
  - `interest = round(33.33) = 33`
  - `totalWithInterest = 10000 + 33 = 10033`

### Example 3: Cap Applied
- Policy: `rate=5%`, `graceDays=0`, `cap=50%`
- Bill: `grandTotal=10000`, `paidAmount=0`, `dueDate=2026-01-01`
- As of: `2026-02-01` (31 days overdue)
- Computation:
  - `principal = 10000`
  - `overdueDays = 31`
  - `effectiveDays = 31`
  - `dailyRate = (5/100)/30 = 0.0016667`
  - `interest = 10000 * 0.0016667 * 31 = 516.67`
  - `maxInterest = 10000 * (50/100) = 5000`
  - `interest = min(516.67, 5000) = 516.67`
  - `interest = round(516.67) = 517`
  - `totalWithInterest = 10000 + 517 = 10517`

### Example 4: Policy Disabled
- Policy: `interestEnabled=false`
- Result: All interest computations return `0`

## Per-Day Interest Rate

For display purposes, compute per-day interest:

```
interestPerDay = principal * dailyRate
```

This shows the **current daily accrual rate** (not cumulative).

## Projection (7-Day Cost)

For future projections:

```
projectedDays = effectiveDays + 7
projectedInterest = principal * dailyRate * projectedDays
projectedInterest = min(projectedInterest, maxInterest)
projectedInterest = round(projectedInterest)
projectedTotal = principal + projectedInterest
```

## Backend Implementation

- **Service**: `/src/services/interest.service.js`
- **Function**: `computeBillInterest(bill, settings, asOfDate)`
- **Returns**: `{ principal, interest, overdueDays, graceDays, effectiveDays }`

## Frontend Implementation

- **Settings**: `/src/components/InterestPolicySettings.js`
- **API**: `/src/api/settings.api.js` → `getInterestPolicy()`, `updateInterestPolicy()`
- **Insights**: `/src/api/insights.api.js` → `getBusinessInterest()`, `getCustomerInterest()`

## Safety Guarantees

1. **Non-mutating**: Interest never modifies bill documents
2. **Deterministic**: Same inputs always produce same outputs
3. **Audit-safe**: All computations are traceable via policy settings
4. **Backward compatible**: When `interestEnabled=false`, all interest values are zero

## References

- Backend Model: `/src/models/BusinessSettings.js`
- Backend Service: `/src/services/interest.service.js`
- Backend Controller: `/src/controllers/settings.controller.js` → `getInterestPolicy()`, `updateInterestPolicy()`
- Backend Controller: `/src/controllers/insights.controller.js` → `getBusinessInterest()`, `getCustomerInterest()`
