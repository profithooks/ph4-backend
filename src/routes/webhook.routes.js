/**
 * Webhook Routes - Payment Provider Webhooks
 * 
 * CRITICAL: These routes require raw body for signature verification.
 * Do NOT use express.json() middleware on these routes.
 */

const express = require('express');
const router = express.Router();
const {handleRazorpayWebhook} = require('../controllers/webhook.controller');

/**
 * Razorpay webhook endpoint
 * 
 * @route   POST /webhooks/razorpay
 * @access  Public (with signature verification)
 * @desc    Receives payment events from Razorpay
 * 
 * IMPORTANT: This route must preserve raw body for signature verification.
 * The rawBody middleware should be applied in app.js/server.js BEFORE express.json().
 */
router.post('/razorpay', handleRazorpayWebhook);

module.exports = router;
