/**
 * Test setup - Database connection and utilities
 */
const mongoose = require('mongoose');
const User = require('../src/models/User');

// Environment variables for testing
const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017/ph4_test';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Test123456!';

/**
 * Connect to test database
 */
const connectTestDB = async () => {
  try {
    // Close any existing connections
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }

    // Connect to test database
    await mongoose.connect(TEST_MONGO_URI);
    
    console.log(`[Test Setup] Connected to test database: ${TEST_MONGO_URI}`);
    return true;
  } catch (error) {
    console.error('[Test Setup] Failed to connect to test database:', error.message);
    throw error;
  }
};

/**
 * Disconnect from test database
 */
const disconnectTestDB = async () => {
  try {
    await mongoose.connection.close();
    console.log('[Test Setup] Disconnected from test database');
  } catch (error) {
    console.error('[Test Setup] Failed to disconnect:', error.message);
  }
};

/**
 * Clear all collections (use with caution)
 */
const clearDatabase = async () => {
  try {
    const collections = mongoose.connection.collections;
    
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany({});
    }
    
    console.log('[Test Setup] Database cleared');
  } catch (error) {
    console.error('[Test Setup] Failed to clear database:', error.message);
    throw error;
  }
};

/**
 * Create test user if it doesn't exist
 * Uses existing User model and password hashing
 */
const ensureTestUser = async () => {
  try {
    // Check if user exists
    let user = await User.findOne({ email: TEST_EMAIL });
    
    if (user) {
      console.log(`[Test Setup] Test user already exists: ${TEST_EMAIL}`);
      return user;
    }

    // Create test user using model (password will be hashed by pre-save hook)
    user = await User.create({
      name: 'Test User',
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      phone: '+919890980947',
    });

    console.log(`[Test Setup] Test user created: ${TEST_EMAIL}`);
    return user;
  } catch (error) {
    console.error('[Test Setup] Failed to create test user:', error.message);
    throw error;
  }
};

/**
 * Get test credentials
 */
const getTestCredentials = () => {
  return {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  };
};

module.exports = {
  connectTestDB,
  disconnectTestDB,
  clearDatabase,
  ensureTestUser,
  getTestCredentials,
  TEST_MONGO_URI,
  TEST_EMAIL,
  TEST_PASSWORD,
};
