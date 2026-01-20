/**
 * Spec Compliance Routes
 * 
 * Dev-only routes for spec compliance checking
 * Step 14: Control Spec Compliance Gate
 */
const express = require('express');
const {getSpecCompliance, getSpecCodes} = require('../controllers/specCompliance.controller');
const {authenticate} = require('../middleware/auth.middleware');

const router = express.Router();

// Dev-only guard: Only enable in development
if (process.env.NODE_ENV === 'development' || process.env.ENABLE_DEV_ENDPOINTS === 'true') {
  // Spec compliance report
  router.get('/compliance', authenticate, getSpecCompliance);

  // Spec codes list
  router.get('/spec-codes', authenticate, getSpecCodes);
} else {
  // In production, return 404
  router.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Dev endpoints not available in production',
      },
    });
  });
}

module.exports = router;
