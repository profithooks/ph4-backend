/**
 * Analytics Routes
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {getAgingAnalytics} = require('../controllers/analytics.controller');

// All analytics routes require authentication
router.use(protect);

// GET /api/v1/analytics/aging - Get aging analytics
router.get('/aging', getAgingAnalytics);

module.exports = router;
