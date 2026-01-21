/**
 * Zero-Friction OTP Auth Routes
 * Static OTP = "0000" (no SMS provider)
 */
const express = require('express');
const {protect} = require('../middleware/auth.middleware');
const {
  requestOtp,
  verifyOtp,
  setBusinessName,
  refreshToken,
} = require('../controllers/authOtpSimple.controller');

const router = express.Router();

// Public routes
router.post('/otp/request', requestOtp);
router.post('/otp/verify', verifyOtp);
router.post('/refresh', refreshToken);

// Protected routes
router.patch('/me/business', protect, setBusinessName);

module.exports = router;
