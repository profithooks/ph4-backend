# Push Notifications Specification

## Purpose

Push notifications serve two primary functions:
1. **Wake-up + Deep Link**: Push notifications wake the app and deep link users to the relevant screen/context
2. **In-app Audit Log**: In-app notifications provide an audit trail of events and must match push notification data

**Critical**: Push notification payloads and in-app notification records must be identical in structure and content to maintain consistency across the system.

---

## Notification Kinds (Enum)

The following notification kinds are supported:

- `OVERDUE_ALERT` - Customer has overdue bills/payments
- `DUE_TODAY` - Bills/payments due today
- `PROMISE_DUE_TODAY` - A customer promise is due today
- `PROMISE_BROKEN` - A customer promise has been broken/missed
- `FOLLOWUP_DUE` - A follow-up task is due
- `PAYMENT_RECEIVED` - Payment has been received for a bill
- `DEVICE_APPROVAL_REQUIRED` - New device login requires approval
- `DAILY_SUMMARY` - Daily summary of business activity
- `CREDIT_LIMIT_WARN` - Customer is approaching or has exceeded credit limit

---

## Canonical Push Payload Schema

The data payload (excluding title/body which are computed client-side) follows this schema:

```json
{
  "kind": "<enum>",
  "entityType": "customer|bill|device|system",
  "entityId": "<string>",
  "customerId": "<string|null>",
  "billId": "<string|null>",
  "occurredAt": "<ISO string>",
  "idempotencyKey": "<string>",
  "deeplink": "<string>"
}
```

### Field Descriptions

- **kind**: One of the notification kinds from the enum above
- **entityType**: The primary entity type this notification relates to (`customer`, `bill`, `device`, or `system`)
- **entityId**: The unique identifier of the primary entity (e.g., customer ID, bill ID, device ID)
- **customerId**: Customer ID if applicable, `null` otherwise
- **billId**: Bill ID if applicable, `null` otherwise
- **occurredAt**: ISO 8601 timestamp when the event occurred
- **idempotencyKey**: Deterministic key to prevent duplicate notifications (see format below)
- **deeplink**: Deep link URL to navigate to the relevant screen (see mapping below)

---

## Deep Link Mapping

Deep links map notification kinds to mobile app routes and parameters:

| Kind | Route | Parameters |
|------|-------|------------|
| `OVERDUE_ALERT` | `CustomerDetail` | `customerId`, `openTab='recovery'` |
| `DUE_TODAY` | `Today` | `openFilter='dueToday'` |
| `PROMISE_DUE_TODAY` | `CustomerDetail` | `customerId`, `openTab='promises'` |
| `PROMISE_BROKEN` | `CustomerDetail` | `customerId`, `openTab='promises'` |
| `FOLLOWUP_DUE` | `CustomerDetail` | `customerId`, `openTab='followups'` |
| `PAYMENT_RECEIVED` | `BillDetail` | `billId` |
| `DEVICE_APPROVAL_REQUIRED` | `Security` | `openTab='devices'` |
| `DAILY_SUMMARY` | `Today` | (no params) |
| `CREDIT_LIMIT_WARN` | `CustomerDetail` | `customerId`, `openTab='credit'` |

### Deep Link Format

Deep links follow the pattern:
- `ph4://customer/{customerId}?tab={tabName}` for customer-related screens
- `ph4://bill/{billId}` for bill detail screens
- `ph4://today?filter={filterName}` for Today screen with filters
- `ph4://today` for Today screen without filters
- `ph4://security?tab={tabName}` for security settings

---

## Idempotency Keys Format

Idempotency keys must be deterministic to prevent duplicate notifications. Format by kind:

| Kind | Format |
|------|--------|
| `OVERDUE_ALERT` | `OVERDUE_ALERT:{customerId}:{YYYY-MM-DD}` |
| `DUE_TODAY` | `DUE_TODAY:{customerId}:{YYYY-MM-DD}` |
| `PROMISE_DUE_TODAY` | `PROMISE_DUE_TODAY:{customerId}:{promiseId}:{YYYY-MM-DD}` |
| `PROMISE_BROKEN` | `PROMISE_BROKEN:{customerId}:{promiseId}:{YYYY-MM-DD}` |
| `FOLLOWUP_DUE` | `FOLLOWUP_DUE:{customerId}:{followupId}:{YYYY-MM-DDTHH}` |
| `PAYMENT_RECEIVED` | `PAYMENT_RECEIVED:{billId}:{YYYY-MM-DD}` |
| `DEVICE_APPROVAL_REQUIRED` | `DEVICE_APPROVAL_REQUIRED:{userId}:{deviceId}:{YYYY-MM-DD}` |
| `DAILY_SUMMARY` | `DAILY_SUMMARY:{userId}:{YYYY-MM-DD}` |
| `CREDIT_LIMIT_WARN` | `CREDIT_LIMIT_WARN:{customerId}:{YYYY-MM-DD}` |

**Notes:**
- Date format is `YYYY-MM-DD` (e.g., `2026-01-23`)
- For `FOLLOWUP_DUE`, include hour in format `YYYY-MM-DDTHH` (e.g., `2026-01-23T14`)
- All IDs are string representations (ObjectId strings, UUIDs, etc.)

---

## Non-Goals

The following are explicitly **not** supported:

- ❌ Marketing push notifications
- ❌ Promotional content
- ❌ Spam or low-value notifications
- ❌ Unactionable notifications (notifications that don't lead to a specific action or screen)
- ❌ Notifications without deep links
- ❌ Notifications that cannot be deduplicated via idempotency keys

---

## Implementation Notes

1. **Backend**: When sending push notifications, ensure the payload matches this schema exactly
2. **Mobile**: When receiving push notifications, parse the payload and navigate using the `deeplink` field
3. **In-app Notifications**: Store notifications using the same payload structure for consistency
4. **Idempotency**: Always check `idempotencyKey` before sending/displaying to prevent duplicates
5. **Deep Links**: Use the `deeplink` field to navigate, not manual route construction

---

## Example Payloads

### OVERDUE_ALERT
```json
{
  "kind": "OVERDUE_ALERT",
  "entityType": "customer",
  "entityId": "507f1f77bcf86cd799439011",
  "customerId": "507f1f77bcf86cd799439011",
  "billId": null,
  "occurredAt": "2026-01-23T10:30:00Z",
  "idempotencyKey": "OVERDUE_ALERT:507f1f77bcf86cd799439011:2026-01-23",
  "deeplink": "ph4://customer/507f1f77bcf86cd799439011?tab=recovery"
}
```

### PAYMENT_RECEIVED
```json
{
  "kind": "PAYMENT_RECEIVED",
  "entityType": "bill",
  "entityId": "507f1f77bcf86cd799439012",
  "customerId": "507f1f77bcf86cd799439011",
  "billId": "507f1f77bcf86cd799439012",
  "occurredAt": "2026-01-23T14:15:00Z",
  "idempotencyKey": "PAYMENT_RECEIVED:507f1f77bcf86cd799439012:2026-01-23",
  "deeplink": "ph4://bill/507f1f77bcf86cd799439012"
}
```

### DAILY_SUMMARY
```json
{
  "kind": "DAILY_SUMMARY",
  "entityType": "system",
  "entityId": "system",
  "customerId": null,
  "billId": null,
  "occurredAt": "2026-01-23T08:00:00Z",
  "idempotencyKey": "DAILY_SUMMARY:507f1f77bcf86cd799439010:2026-01-23",
  "deeplink": "ph4://today"
}
```

---

## Version History

- **2026-01-23**: Initial specification created
