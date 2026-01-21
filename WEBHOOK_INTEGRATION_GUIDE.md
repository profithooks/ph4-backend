# Webhook Integration Guide - Quick Start

**Goal:** Mount webhook and ops routes in your Express app

---

## **STEP 1: Add Raw Body Middleware**

**File:** `server.js` or `app.js`

**CRITICAL:** Raw body must be preserved BEFORE `express.json()` for signature verification.

### **Option A: Express 4.17+ (Recommended)**

```javascript
const express = require('express');
const app = express();

// ✅ BEFORE express.json() - Preserve raw body for webhooks
app.use('/webhooks', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Mount webhook routes
const webhookRoutes = require('./src/routes/webhook.routes');
app.use('/webhooks', webhookRoutes);

// ✅ AFTER webhook routes - Regular JSON parsing
app.use(express.json());

// Mount ops routes (uses regular JSON)
const opsRoutes = require('./src/routes/ops.routes');
app.use('/api/v1/ops', opsRoutes);

// ... other routes
```

---

### **Option B: Manual Raw Body Middleware**

```javascript
const express = require('express');
const app = express();

// Custom middleware to capture raw body
const captureRawBody = (req, res, next) => {
  req.rawBody = '';
  req.on('data', chunk => {
    req.rawBody += chunk.toString();
  });
  req.on('end', () => {
    next();
  });
};

// Apply to webhook routes only
app.use('/webhooks', captureRawBody, express.json());

// Mount webhook routes
const webhookRoutes = require('./src/routes/webhook.routes');
app.use('/webhooks', webhookRoutes);

// Regular routes
app.use(express.json());

// Mount ops routes
const opsRoutes = require('./src/routes/ops.routes');
app.use('/api/v1/ops', opsRoutes);

// ... other routes
```

---

## **STEP 2: Verify Environment Variables**

Add to `.env`:

```env
# Razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxx

# Pro Plan
PRO_MONTHLY_PRICE=29900

# Ops (Production only)
ADMIN_SECRET=generate_secure_random_string

# Environment
NODE_ENV=development
```

---

## **STEP 3: Test Locally**

### **Test Manual Activation:**

```bash
# Activate Pro (no auth needed in dev)
curl -X POST http://localhost:5055/api/v1/ops/users/YOUR_USER_ID/activate-pro \
  -H "Content-Type: application/json" \
  -d '{"durationDays": 30, "reason": "testing"}'

# Expected response:
# {
#   "success": true,
#   "message": "Pro plan activated manually",
#   "user": { ... }
# }
```

### **Test Webhook (Mock):**

```bash
# Send mock webhook
curl -X POST http://localhost:5055/webhooks/razorpay \
  -H "X-Razorpay-Signature: test_signature" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "payment.captured",
    "payload": {
      "payment": {
        "entity": {
          "id": "pay_test123",
          "order_id": "order_test123",
          "amount": 29900,
          "notes": {
            "userId": "YOUR_USER_ID"
          }
        }
      }
    }
  }'

# Expected response (will fail signature verification):
# {
#   "success": false,
#   "message": "Invalid signature"
# }
```

---

## **STEP 4: Razorpay Test Mode Setup**

### **1. Expose Local Server:**

```bash
# Install ngrok
brew install ngrok  # macOS
# or
npm install -g ngrok

# Expose local server
ngrok http 5055

# Copy URL (e.g., https://abc123.ngrok.io)
```

### **2. Configure Razorpay Webhook:**

1. Go to: https://dashboard.razorpay.com/app/webhooks
2. Click "Add New Webhook"
3. URL: `https://abc123.ngrok.io/webhooks/razorpay`
4. Events: Enable only `payment.captured`
5. Secret: Copy secret and add to `.env` as `RAZORPAY_WEBHOOK_SECRET`

### **3. Make Test Payment:**

```javascript
// Website code (or test script)
const options = {
  key: 'rzp_test_...',
  amount: 29900,
  currency: 'INR',
  order_id: 'order_...',
  handler: function(response) {
    console.log('Payment successful:', response);
  }
};

const rzp = new Razorpay(options);
rzp.open();

// Use test card:
// Card: 4111 1111 1111 1111
// CVV: 123
// Expiry: Any future date
```

### **4. Verify Webhook Received:**

Check server logs:
```
[Webhook] Received event: payment.captured
[Webhook] Processing payment.captured: pay_xxx for user 65abc...
[Webhook] User 65abc... upgraded to Pro
```

---

## **COMMON ISSUES**

### **Issue 1: "Invalid signature"**

**Cause:** Raw body not preserved

**Fix:** Ensure raw body middleware is BEFORE `express.json()` for `/webhooks`

---

### **Issue 2: "RAZORPAY_WEBHOOK_SECRET not configured"**

**Cause:** Missing env variable

**Fix:** Add to `.env`:
```env
RAZORPAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxx
```

---

### **Issue 3: "User not found"**

**Cause:** Invalid userId in webhook payload

**Fix:** Ensure website passes correct MongoDB User ID in `notes.userId`:
```javascript
notes: {
  userId: user._id.toString(), // Must be valid MongoDB ObjectId
}
```

---

### **Issue 4: Webhook not received**

**Cause:** Razorpay cannot reach local server

**Fix:** Use ngrok to expose local server publicly

---

## **PRODUCTION DEPLOYMENT**

### **1. Set Environment Variables:**

```bash
# On your hosting platform (Render, Heroku, etc.)
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=whsec_live_...
PRO_MONTHLY_PRICE=29900
ADMIN_SECRET=<secure_random_string>
NODE_ENV=production
```

### **2. Configure Production Webhook:**

1. Razorpay Dashboard → Webhooks
2. URL: `https://api.yourdomain.com/webhooks/razorpay`
3. Events: `payment.captured` only
4. Copy live webhook secret

### **3. Test with Live Payment:**

- Make a real ₹299 payment
- Verify webhook received
- Verify user upgraded to Pro
- Verify subscription created

---

## **MONITORING**

### **Logs to Watch:**

```bash
# Webhook success
tail -f logs/combined.log | grep "Webhook"

# Pro activations
tail -f logs/combined.log | grep "upgraded to Pro"

# Errors
tail -f logs/error.log | grep "Webhook"
```

### **Metrics:**
- Webhook success rate (200 responses)
- Pro activation count
- Duplicate webhook count (idempotent hits)

---

## **QUICK CHECKLIST**

- [ ] Raw body middleware configured
- [ ] Webhook routes mounted (`/webhooks`)
- [ ] Ops routes mounted (`/api/v1/ops`)
- [ ] Environment variables set
- [ ] Razorpay webhook configured
- [ ] Test payment successful
- [ ] Webhook received and processed
- [ ] User upgraded to Pro
- [ ] Subscription created

---

**STATUS:** Ready to integrate! Follow steps above.

**Questions?** Check `PAYMENT_WEBHOOK_COMPLETE.md` for full details.
