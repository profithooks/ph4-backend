const express = require('express');
const router = express.Router();
const {createRateLimiter} = require('../middleware/rateLimit.middleware');
const {
  getPublicBill,
  getPublicBillJson,
} = require('../controllers/publicBill.controller');

// Strict rate limit for public endpoints (60 requests per minute per IP)
const publicBillLimiter = createRateLimiter({
  maxAttempts: 60,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'public-bill',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return ip;
  },
});

// Apply rate limiting to all public bill routes
router.use(publicBillLimiter);

// Public bill viewer (JSON) - must come before /b/:token to match .json first
router.get('/b/:token.json', getPublicBillJson);

// Public bill viewer (HTML)
router.get('/b/:token', getPublicBill);

module.exports = router;
