/**
 * Pro plan routes
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { checkTrialExpiry } = require('../middleware/trialExpiry.middleware');
const { 
  activatePro, 
  getSubscription, 
  getProPlans, 
  createProOrder,
  verifyAndActivatePro
} = require('../controllers/pro.controller');

// All routes require authentication
router.use(protect);
router.use(checkTrialExpiry);

// GET /api/v1/pro/plans - Get available Pro plans
router.get('/plans', getProPlans);

// POST /api/v1/pro/order - Create Pro subscription order
router.post('/order', createProOrder);

// POST /api/v1/pro/verify - Verify payment and activate Pro (server-truth activation)
router.post('/verify', verifyAndActivatePro);

// POST /api/v1/pro/activate - Activate Pro plan after payment (legacy)
router.post('/activate', activatePro);

// GET /api/v1/pro/subscription - Get current subscription status
router.get('/subscription', getSubscription);

module.exports = router;
