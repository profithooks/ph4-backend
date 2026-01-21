/**
 * Pro plan routes
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { checkTrialExpiry } = require('../middleware/trialExpiry.middleware');
const { activatePro, getSubscription } = require('../controllers/pro.controller');

// All routes require authentication
router.use(protect);
router.use(checkTrialExpiry);

// POST /api/v1/pro/activate - Activate Pro plan after payment
router.post('/activate', activatePro);

// GET /api/v1/pro/subscription - Get current subscription status
router.get('/subscription', getSubscription);

module.exports = router;
