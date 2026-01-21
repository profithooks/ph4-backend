/**
 * Entitlement Routes
 */
const express = require('express');
const {protect} = require('../middleware/auth.middleware');
const {getEntitlement} = require('../controllers/entitlement.controller');

const router = express.Router();

// Get current user's entitlement status
router.get('/me/entitlement', protect, getEntitlement);

module.exports = router;
