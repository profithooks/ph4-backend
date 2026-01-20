# API Response Envelope Standard

**Last Updated:** 2026-01-20  
**Status:** ✅ ENFORCED

---

## Overview

All API responses MUST use the unified envelope format. This ensures:
- Consistent error handling on frontend
- Reliable requestId tracking for debugging
- Clear distinction between success/error states
- Retryability metadata for offline-first sync

---

## Standard Envelope Format

### Success Response

```json
{
  "ok": true,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "data": {
    // Your response data here
  },
  "meta": {
    // Optional metadata (pagination, timezone, etc.)
  }
}
```

### Error Response

```json
{
  "ok": false,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "error": {
    "code": "SOME_ERROR_CODE",
    "message": "Human-readable error message",
    "retryable": false,
    "details": {
      // Optional error details
    }
  }
}
```

---

## Response Helpers

### New Helpers (Preferred)

Use these for cleaner code:

```javascript
// Success
res.ok({bills: [...], total: 50});
res.ok({bills: [...]}, {page: 1, total: 50}); // with meta

// Error
res.error('NOT_FOUND', 'Customer not found');
res.error('VALIDATION_ERROR', 'Invalid input', {field: 'email'});
res.error('CREDIT_LIMIT_EXCEEDED', 'Limit exceeded', {limit: 10000});
```

**Auto Status Detection:**
- `VALIDATION_ERROR` → 400
- `UNAUTHORIZED`, `INVALID_TOKEN` → 401
- `FORBIDDEN`, `PERMISSION_DENIED` → 403
- `NOT_FOUND` → 404
- `CONFLICT`, `DUPLICATE`, `CREDIT_LIMIT_EXCEEDED` → 409
- `RATE_LIMIT` → 429
- Others → 500

### Legacy Helpers (Still Supported)

```javascript
// Success
res.success({bills: [...]});
res.success({bills: [...]}, {page: 1}, 200); // with meta & status

// Error
res.fail('NOT_FOUND', 'Customer not found', 404, false);
```

---

## Middleware Stack

### Single Source of Truth

| Component | Source | Field/Method |
|-----------|--------|--------------|
| **Request ID** | `requestUid.middleware.js` | `req.requestId` |
| **Logging** | `requestLogger.middleware.js` | Winston-based |
| **Validation** | `validation.middleware.js` | Joi + standard envelope |
| **Response Helpers** | `responseEnvelope.js` | `res.ok()`, `res.error()` |

### Deprecated Middleware

❌ **DO NOT USE:**
- `validate.middleware.js` → Use `validation.middleware.js`
- `request-logger.middleware.js` → Use `requestLogger.middleware.js`
- `req._reqUid` → Use `req.requestId`

---

## Validation Errors

Use the standard `validation.middleware.js`:

```javascript
const {validate} = require('../middleware/validation.middleware');
const Joi = require('joi');

const createBillSchema = Joi.object({
  customerId: Joi.string().required(),
  amount: Joi.number().positive().required(),
});

router.post(
  '/bills',
  validate({body: createBillSchema}),
  createBill
);
```

**Validation Error Response:**

```json
{
  "ok": false,
  "requestId": "550e8400-e29b-41d4-a716-446655440002",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "retryable": false,
    "details": {
      "source": "body",
      "errors": [
        {
          "field": "customerId",
          "message": "\"customerId\" is required",
          "type": "any.required"
        }
      ]
    }
  }
}
```

---

## Error Codes

### Standard Codes

| Code | HTTP Status | Retryable | Description |
|------|-------------|-----------|-------------|
| `VALIDATION_ERROR` | 400 | No | Invalid input data |
| `INVALID_ID` | 400 | No | Invalid ObjectId format |
| `UNAUTHORIZED` | 401 | No | Missing/invalid auth token |
| `TOKEN_EXPIRED` | 401 | No | JWT token expired |
| `FORBIDDEN` | 403 | No | Permission denied |
| `NOT_FOUND` | 404 | No | Resource not found |
| `CONFLICT` | 409 | No | Resource conflict (e.g., duplicate) |
| `CREDIT_LIMIT_EXCEEDED` | 409 | No | Credit limit exceeded (requires override) |
| `RATE_LIMIT` | 429 | Yes | Too many requests |
| `SERVER_ERROR` | 500 | Yes | Internal server error |
| `TIMEOUT` | 500 | Yes | Request timeout |

### Business Logic Codes

Add custom codes as needed:
- `PAYMENT_FAILED`
- `INSUFFICIENT_BALANCE`
- `DUPLICATE_ENTRY`
- etc.

---

## Request ID

Every request has a unique `requestId`:

```javascript
// Available in all middleware & controllers
console.log(req.requestId); // "550e8400-e29b-41d4-a716-446655440000"

// Included in all logs
logger.info('Processing bill', {
  requestId: req.requestId,
  billId: bill._id,
});

// Auto-included in all responses
res.ok({bill}); 
// → {ok: true, requestId: "...", data: {bill}}
```

**Client Tracing:**
- Client can send `X-Request-Id` header for end-to-end tracing
- Server returns same `X-Request-Id` in response header

---

## Logging

All requests are logged with structured data:

```json
{
  "level": "info",
  "message": "[Request] Complete",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/v1/bills",
  "userId": "507f1f77bcf86cd799439011",
  "status": 201,
  "durationMs": 234,
  "ok": true,
  "timestamp": "2026-01-20T10:30:00.000Z"
}
```

---

## Verification

Run the envelope verification script:

```bash
npm run verify-envelope
```

This tests:
1. Success responses have correct envelope
2. Error responses have correct envelope
3. Validation errors use standard format
4. No legacy fields (`success`, `errors`, etc.)

---

## Migration Guide

### Step 1: Update Validation Imports

**Before:**
```javascript
const {validate} = require('../middleware/validate.middleware');
```

**After:**
```javascript
const {validate} = require('../middleware/validation.middleware');
```

### Step 2: Update Response Calls

**Before:**
```javascript
res.status(200).json({success: true, data: {bill}});
res.status(404).json({success: false, message: 'Not found'});
```

**After:**
```javascript
res.ok({bill});
res.error('NOT_FOUND', 'Customer not found');
```

### Step 3: Update Request ID References

**Before:**
```javascript
logger.info('Processing', {reqId: req._reqUid});
```

**After:**
```javascript
logger.info('Processing', {requestId: req.requestId});
```

---

## Examples

### Simple Success

```javascript
exports.getCustomer = async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  
  if (!customer) {
    return res.error('NOT_FOUND', 'Customer not found');
  }
  
  res.ok({customer});
};
```

### Success with Meta

```javascript
exports.listBills = async (req, res) => {
  const {limit = 20, offset = 0} = req.query;
  
  const bills = await Bill.find()
    .limit(limit)
    .skip(offset);
  
  const total = await Bill.countDocuments();
  
  res.ok(
    {bills},
    {total, limit, offset, page: Math.floor(offset / limit) + 1}
  );
};
```

### Business Logic Error

```javascript
exports.createBill = async (req, res) => {
  const customer = await Customer.findById(req.body.customerId);
  
  // Check credit limit
  if (customer.creditOutstanding + amount > customer.creditLimit) {
    return res.error(
      'CREDIT_LIMIT_EXCEEDED',
      'Credit limit exceeded',
      {
        limit: customer.creditLimit,
        outstanding: customer.creditOutstanding,
        attempted: amount,
        requiredOverride: true,
      }
    );
  }
  
  const bill = await Bill.create(req.body);
  res.ok({bill}, null, 201);
};
```

### Validation with Custom Schema

```javascript
const {validate} = require('../middleware/validation.middleware');
const Joi = require('joi');

const updateCustomerSchema = Joi.object({
  name: Joi.string().min(2).max(100),
  phone: Joi.string().regex(/^[0-9]{10,15}$/),
  credit: Joi.object({
    enabled: Joi.boolean(),
    limit: Joi.number().positive(),
  }),
});

router.patch(
  '/:id',
  validate({
    params: Joi.object({
      id: Joi.string().regex(/^[0-9a-fA-F]{24}$/),
    }),
    body: updateCustomerSchema,
  }),
  updateCustomer
);
```

---

## Testing

### Unit Tests

```javascript
const request = require('supertest');
const app = require('../app');

describe('GET /api/v1/customers/:id', () => {
  it('returns standard success envelope', async () => {
    const res = await request(app)
      .get('/api/v1/customers/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      requestId: expect.any(String),
      data: {
        customer: expect.objectContaining({
          _id: expect.any(String),
        }),
      },
    });
  });
  
  it('returns standard error envelope for not found', async () => {
    const res = await request(app)
      .get('/api/v1/customers/507f1f77bcf86cd799439012')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      ok: false,
      requestId: expect.any(String),
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        retryable: false,
      },
    });
  });
});
```

---

## Frontend Consumption

### TypeScript Types

```typescript
interface ApiSuccessResponse<T> {
  ok: true;
  requestId: string;
  data: T;
  meta?: Record<string, any>;
}

interface ApiErrorResponse {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: any;
  };
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
```

### Usage

```typescript
async function fetchCustomer(id: string): Promise<Customer> {
  const response = await api.get<ApiResponse<{customer: Customer}>>(
    `/customers/${id}`
  );
  
  if (!response.data.ok) {
    throw new ApiError(response.data.error);
  }
  
  return response.data.data.customer;
}
```

---

## FAQ

### Q: Can I use a different status code?

**A:** Yes, for `res.success()` you can pass a third parameter:

```javascript
res.success({bill}, {created: true}, 201);
```

For `res.ok()`, it always returns 200. Use `res.success()` if you need custom status.

### Q: What about streaming responses?

**A:** Streaming responses (SSE, file downloads) don't use the envelope. They're raw streams.

### Q: Can I add custom fields to the envelope?

**A:** No. The envelope structure is fixed. Use `data` or `meta` for custom fields.

### Q: What if I need to return an array at the top level?

**A:** Wrap it in `data`:

```javascript
// ❌ Wrong
res.json([1, 2, 3]);

// ✅ Correct
res.ok({items: [1, 2, 3]});
```

---

## Enforcement

- ✅ All new endpoints MUST use standard envelope
- ✅ Validation middleware enforces standard error envelope
- ✅ Error middleware enforces standard error envelope
- ⚠️ Legacy endpoints should be migrated gradually
- ❌ No new code should use deprecated middleware

Run `npm run verify-envelope` to verify compliance.

---

**Questions?** Contact the backend team or open an issue.
