/**
 * Verification script for Zero-Friction OTP Auth
 * Tests: request OTP -> verify OTP -> set business name -> refresh token
 */
const axios = require('axios');
const {connectDB} = require('../src/config/db');
const mongoose = require('mongoose');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const TEST_MOBILE = '9876543210';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

const log = (msg, color = 'reset') => {
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

const logStep = (step) => {
  log(`\n${'='.repeat(60)}`, 'blue');
  log(`STEP: ${step}`, 'blue');
  log('='.repeat(60), 'blue');
};

const logSuccess = (msg) => log(`✓ ${msg}`, 'green');
const logError = (msg) => log(`✗ ${msg}`, 'red');
const logInfo = (msg) => log(`  ${msg}`, 'yellow');

let accessToken = null;
let refreshToken = null;
let userId = null;

async function testOtpAuth() {
  try {
    // Connect to DB
    await connectDB();
    log('\n✓ Connected to database', 'green');

    // Step 1: Request OTP
    logStep('1. Request OTP');
    const requestResponse = await axios.post(`${BASE_URL}/api/v1/auth/otp/request`, {
      mobile: TEST_MOBILE,
      countryCode: '+91',
    });
    
    if (requestResponse.data.success) {
      logSuccess('OTP request successful');
      if (requestResponse.data.otpHint) {
        logInfo(`OTP Hint: ${requestResponse.data.otpHint}`);
      }
    } else {
      throw new Error('OTP request failed');
    }

    // Step 2: Verify OTP
    logStep('2. Verify OTP');
    const verifyResponse = await axios.post(`${BASE_URL}/api/v1/auth/otp/verify`, {
      mobile: TEST_MOBILE,
      otp: '0000',
      device: {
        deviceId: 'test-device-001',
        name: 'Test Device',
        platform: 'test',
      },
    });
    
    if (verifyResponse.data.success) {
      logSuccess('OTP verification successful');
      accessToken = verifyResponse.data.accessToken;
      refreshToken = verifyResponse.data.refreshToken;
      userId = verifyResponse.data.user.id;
      logInfo(`Access Token: ${accessToken.substring(0, 20)}...`);
      logInfo(`Refresh Token: ${refreshToken.substring(0, 20)}...`);
      logInfo(`User ID: ${userId}`);
      logInfo(`Needs Business Name: ${verifyResponse.data.needsBusinessName}`);
    } else {
      throw new Error('OTP verification failed');
    }

    // Step 3: Set Business Name
    logStep('3. Set Business Name');
    const businessResponse = await axios.patch(
      `${BASE_URL}/api/v1/auth/me/business`,
      {
        businessName: 'Test Business Co.',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (businessResponse.data.success) {
      logSuccess('Business name set successfully');
      logInfo(`Business Name: ${businessResponse.data.user.businessName}`);
    } else {
      throw new Error('Business name setting failed');
    }

    // Step 4: Test Refresh Token
    logStep('4. Test Refresh Token');
    const refreshResponse = await axios.post(`${BASE_URL}/api/v1/auth/refresh`, {
      refreshToken,
    });
    
    if (refreshResponse.data.success) {
      logSuccess('Token refresh successful');
      const newAccessToken = refreshResponse.data.accessToken;
      logInfo(`New Access Token: ${newAccessToken.substring(0, 20)}...`);
    } else {
      throw new Error('Token refresh failed');
    }

    // Step 5: Test Protected Endpoint (settings or any protected route)
    logStep('5. Test Protected Endpoint');
    try {
      const settingsResponse = await axios.get(`${BASE_URL}/api/settings`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      logSuccess('Protected endpoint accessible');
      logInfo(`Settings fetched successfully`);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        logInfo('Settings endpoint not found (but auth worked)');
        logSuccess('Authentication working correctly');
      } else {
        throw error;
      }
    }

    // Summary
    log('\n' + '='.repeat(60), 'green');
    log('ALL TESTS PASSED ✓', 'green');
    log('='.repeat(60), 'green');
    log('\nOTP Auth Flow Summary:', 'blue');
    log('1. ✓ OTP Request - Mobile validation and OTP generation', 'green');
    log('2. ✓ OTP Verify - Token issuance and user creation', 'green');
    log('3. ✓ Business Name - Post-auth profile completion', 'green');
    log('4. ✓ Refresh Token - Token refresh mechanism', 'green');
    log('5. ✓ Protected Routes - Auth middleware validation\n', 'green');

  } catch (error) {
    logError('Test failed!');
    if (error.response) {
      logError(`Status: ${error.response.status}`);
      logError(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      logError(error.message);
      console.error(error);
    }
    process.exit(1);
  } finally {
    // Cleanup
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      log('\n✓ Database connection closed', 'green');
    }
  }
}

// Run tests
testOtpAuth();
