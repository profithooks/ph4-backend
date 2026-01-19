/**
 * Attempt Routes
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { createAttempt, listAttempts } = require('../controllers/attempt.controller');

router.use(protect);

router.post('/', createAttempt);
router.get('/', listAttempts);

module.exports = router;
