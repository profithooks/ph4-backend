/**
 * Auth routes
 */
const express = require('express');
const {signup, login} = require('../controllers/auth.controller');
const {authLimiter} = require('../middleware/rateLimit.middleware');
const {validate} = require('../middleware/validation.middleware');
const {signupSchema, loginSchema} = require('../validators/auth.validator');

const router = express.Router();

// Apply auth-specific rate limiting to all auth routes
router.use(authLimiter);

router.post('/signup', validate(signupSchema), signup);
router.post('/login', validate(loginSchema), login);

module.exports = router;
