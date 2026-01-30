/**
 * Stats routes
 */
const express = require('express');
const { getDailyStatsHandler } = require('../controllers/stats.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

// Protect route - requires authentication
router.use(protect);

// GET /api/v1/stats/daily?date=yesterday|YYYY-MM-DD
router.get('/daily', getDailyStatsHandler);

module.exports = router;
