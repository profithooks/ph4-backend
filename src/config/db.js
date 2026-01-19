/**
 * Database connection configuration
 */
const mongoose = require('mongoose');
const {mongoUri} = require('./env');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoUri);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error('MongoDB connection failed', error);
    process.exit(1);
  }
};

module.exports = connectDB;
