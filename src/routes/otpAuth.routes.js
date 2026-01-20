/**
 * OTP Authentication Routes
 * Step 9: Added recovery endpoints
 */
const express = require('express');
const router = express.Router();
const {
  requestOtp,
  verifyOtp,
  initRecovery,
  verifyRecoveryPin,
  approveDeviceWithRecovery,
} = require('../controllers/otpAuth.controller');

// @route   POST /api/auth/otp/request
// @desc    Request OTP (send to phone)
// @access  Public
router.post('/request', requestOtp);

// @route   POST /api/auth/otp/verify
// @desc    Verify OTP and login/signup
// @access  Public
router.post('/verify', verifyOtp);

// Step 9: Recovery endpoints

// @route   POST /api/auth/recover/init
// @desc    Init recovery (check if recovery enabled)
// @access  Public
router.post('/recover/init', initRecovery);

// @route   POST /api/auth/recover/verify
// @desc    Verify recovery PIN
// @access  Public
router.post('/recover/verify', verifyRecoveryPin);

// @route   POST /api/auth/recover/approve-device
// @desc    Approve device using recovery token
// @access  Public (with recovery token)
router.post('/recover/approve-device', approveDeviceWithRecovery);

module.exports = router;
