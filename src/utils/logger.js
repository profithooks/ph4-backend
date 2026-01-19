/**
 * Winston Logger Configuration
 * - JSON logging with timestamps
 * - Console output in development
 * - File output in production
 * - Sanitizes sensitive data (tokens, passwords, secrets)
 */
const winston = require('winston');
const path = require('path');

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Sanitize sensitive data from log metadata
 */
const sanitizeMetadata = (meta) => {
  if (!meta || typeof meta !== 'object') {
    return meta;
  }

  const sanitized = {...meta};
  const sensitiveKeys = [
    'password',
    'token',
    'jwt',
    'secret',
    'authorization',
    'authkey',
    'apikey',
    'api_key',
    'Bearer',
  ];

  const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    Object.keys(obj).forEach(key => {
      const lowerKey = key.toLowerCase();
      
      // Check if key contains sensitive data
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive.toLowerCase()))) {
        if (typeof obj[key] === 'string' && obj[key].length > 0) {
          // Mask the value but show first/last 4 chars if long enough
          if (obj[key].length > 20) {
            obj[key] = `${obj[key].substring(0, 4)}...${obj[key].substring(obj[key].length - 4)}`;
          } else {
            obj[key] = '[REDACTED]';
          }
        }
      } else if (typeof obj[key] === 'object') {
        // Recursively sanitize nested objects
        obj[key] = sanitizeObject(obj[key]);
      }
    });

    return obj;
  };

  return sanitizeObject(sanitized);
};

/**
 * Custom format for sanitizing logs
 */
const sanitizeFormat = winston.format((info) => {
  // Sanitize metadata
  if (info.meta) {
    info.meta = sanitizeMetadata(info.meta);
  }

  // Sanitize any top-level sensitive fields
  return sanitizeMetadata(info);
});

/**
 * Winston transports configuration
 */
const transports = [];

// Console transport (always in dev, optional in prod)
if (isDevelopment || process.env.LOG_CONSOLE === 'true') {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
        winston.format.printf(({timestamp, level, message, ...meta}) => {
          let metaStr = '';
          if (Object.keys(meta).length > 0) {
            metaStr = '\n' + JSON.stringify(meta, null, 2);
          }
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      ),
    })
  );
}

// File transports (production)
if (!isDevelopment) {
  const logsDir = process.env.LOGS_DIR || 'logs';
  
  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  );

  // Error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    })
  );
}

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  format: winston.format.combine(
    sanitizeFormat(),
    winston.format.timestamp(),
    winston.format.errors({stack: true}),
    winston.format.json()
  ),
  transports,
  // Don't exit on error
  exitOnError: false,
});

/**
 * Wrapper functions for common log levels
 */
const log = {
  /**
   * Debug level logging (verbose, dev only typically)
   */
  debug: (message, meta = {}) => {
    logger.debug(message, meta);
  },

  /**
   * Info level logging (general information)
   */
  info: (message, meta = {}) => {
    logger.info(message, meta);
  },

  /**
   * Warning level logging (non-critical issues)
   */
  warn: (message, meta = {}) => {
    logger.warn(message, meta);
  },

  /**
   * Error level logging (errors and exceptions)
   */
  error: (message, error = null, meta = {}) => {
    const errorMeta = {
      ...meta,
      error: error ? {
        message: error.message,
        stack: error.stack,
        code: error.code,
        name: error.name,
      } : undefined,
    };

    logger.error(message, errorMeta);
  },

  /**
   * HTTP request logging
   */
  http: (message, meta = {}) => {
    logger.http(message, meta);
  },
};

module.exports = log;
