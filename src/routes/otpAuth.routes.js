/**
 * OTP Authentication Routes
 */
const express = require('express');
const router = express.Router();
const { requestOtp, verifyOtp } = require('../controllers/otpAuth.controller');

// @route   POST /api/auth/otp/request
// @desc    Request OTP (send to phone)
// @access  Public
router.post('/request', requestOtp);

// @route   POST /api/auth/otp/verify
// @desc    Verify OTP and login/signup
// @access  Public
router.post('/verify', verifyOtp);

module.exports = router;
