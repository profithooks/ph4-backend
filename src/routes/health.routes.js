/**
 * Health Routes
 * 
 * Step 12: Production Readiness
 */
const express = require('express');
const {getHealth, getReadiness, getStatus} = require('../controllers/health.controller');

const router = express.Router();

// Public health endpoints (no auth required)
router.get('/health', getHealth);
router.get('/ready', getReadiness);
router.get('/status', getStatus);

module.exports = router;
