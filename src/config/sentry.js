/**
 * Sentry configuration for backend error tracking
 * 
 * Environment variables:
 * - SENTRY_DSN: Sentry project DSN (required for error tracking)
 * - SENTRY_ENABLED: Enable/disable Sentry (default: true in production, false otherwise)
 * - SENTRY_ENVIRONMENT: Environment name (default: from NODE_ENV)
 * - SENTRY_TRACES_SAMPLE_RATE: Performance monitoring sample rate (default: 0.0 to save quota)
 */
const logger = require('../utils/logger');
const {nodeEnv} = require('./env');

// Environment configuration
const SENTRY_DSN = process.env.SENTRY_DSN || '';
const SENTRY_ENABLED = process.env.SENTRY_ENABLED !== undefined 
  ? process.env.SENTRY_ENABLED === 'true' 
  : nodeEnv === 'production'; // Default: enabled only in production
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || nodeEnv || 'development';
const SENTRY_TRACES_SAMPLE_RATE = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.0');

// Track if Sentry was successfully initialized
let isSentryInitialized = false;
let Sentry = null;

/**
 * Initialize Sentry
 * Safe to call even if DSN is missing - will warn but not crash
 * 
 * @returns {boolean} True if Sentry was initialized successfully
 */
const initSentry = () => {
  // Check if Sentry should be enabled
  if (!SENTRY_ENABLED) {
    logger.info('[Sentry] Disabled via SENTRY_ENABLED=false');
    return false;
  }

  // Warn if enabled but DSN not provided
  if (!SENTRY_DSN) {
    logger.warn(
      '\n' + '='.repeat(70) + '\n' +
      '⚠️  SENTRY WARNING\n' +
      '='.repeat(70) + '\n' +
      'SENTRY_ENABLED is true but SENTRY_DSN is not configured.\n' +
      'Error tracking will NOT work in production.\n' +
      '\n' +
      'To fix:\n' +
      '1. Get DSN from https://sentry.io\n' +
      '2. Set SENTRY_DSN in your .env file\n' +
      '3. Or set SENTRY_ENABLED=false to disable this warning\n' +
      '='.repeat(70)
    );
    return false;
  }

  try {
    // Dynamically require Sentry to avoid import errors if not installed
    Sentry = require('@sentry/node');
    
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: SENTRY_ENVIRONMENT,
      
      // Performance monitoring (default 0.0 to save quota)
      tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
      
      // Explicitly control enabled state
      enabled: SENTRY_ENABLED,
      
      // Integrations
      integrations: [
        // HTTP integration for Express
        new Sentry.Integrations.Http({ tracing: true }),
        // Capture unhandled promise rejections
        new Sentry.Integrations.OnUncaughtException(),
        new Sentry.Integrations.OnUnhandledRejection(),
      ],
      
      // PII Scrubbing - DO NOT send sensitive data
      beforeSend(event, hint) {
        // Remove sensitive data from event
        if (event.request?.headers) {
          // Remove auth headers
          delete event.request.headers.authorization;
          delete event.request.headers.Authorization;
          delete event.request.headers['x-auth-token'];
          delete event.request.headers.cookie;
          delete event.request.headers.Cookie;
        }
        
        // Scrub sensitive data from request body
        if (event.request?.data) {
          const sanitized = {...event.request.data};
          const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'authorization'];
          
          sensitiveKeys.forEach(key => {
            if (sanitized[key]) {
              sanitized[key] = '[REDACTED]';
            }
          });
          
          event.request.data = sanitized;
        }
        
        // Scrub breadcrumbs
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
            if (breadcrumb.data) {
              const sanitized = {...breadcrumb.data};
              const sensitiveKeys = ['token', 'password', 'authorization', 'auth', 'secret', 'apiKey'];
              
              sensitiveKeys.forEach(key => {
                if (sanitized[key]) {
                  sanitized[key] = '[REDACTED]';
                }
              });
              
              breadcrumb.data = sanitized;
            }
            return breadcrumb;
          });
        }
        
        // Remove PII from user context
        if (event.user) {
          event.user = {
            id: event.user.id || 'anonymous',
            // DO NOT include email, name, ip_address, etc.
          };
        }
        
        return event;
      },
      
      // Ignore certain errors
      ignoreErrors: [
        // Validation errors (expected user errors)
        'ValidationError',
        'VALIDATION_ERROR',
        
        // Auth errors (expected)
        'INVALID_CREDENTIALS',
        'UNAUTHORIZED',
        
        // Network timeouts (not actionable)
        'ETIMEDOUT',
        'ECONNREFUSED',
      ],
    });

    isSentryInitialized = true;

    logger.info('[Sentry] ✅ Initialized successfully', {
      dsn: SENTRY_DSN.substring(0, 30) + '...',
      environment: SENTRY_ENVIRONMENT,
      tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
      enabled: SENTRY_ENABLED,
    });

    return true;
  } catch (error) {
    logger.error('[Sentry] ❌ Initialization failed', {error: error.message});
    logger.warn('[Sentry] Error tracking will NOT work. Server will continue without Sentry.');
    logger.warn('[Sentry] To fix: npm install @sentry/node');
    return false;
  }
};

/**
 * Check if Sentry is active
 */
const isSentryActive = () => {
  return isSentryInitialized && SENTRY_ENABLED && !!SENTRY_DSN && Sentry !== null;
};

/**
 * Get Sentry request handler middleware for Express
 * Safe to call even if Sentry is not initialized - returns noop middleware
 */
const getSentryRequestHandler = () => {
  if (!isSentryActive()) {
    return (req, res, next) => next(); // Noop middleware
  }
  
  try {
    return Sentry.Handlers.requestHandler();
  } catch (error) {
    logger.error('[Sentry] Failed to create request handler', {error: error.message});
    return (req, res, next) => next();
  }
};

/**
 * Get Sentry tracing handler middleware for Express
 * Safe to call even if Sentry is not initialized - returns noop middleware
 */
const getSentryTracingHandler = () => {
  if (!isSentryActive()) {
    return (req, res, next) => next();
  }
  
  try {
    return Sentry.Handlers.tracingHandler();
  } catch (error) {
    logger.error('[Sentry] Failed to create tracing handler', {error: error.message});
    return (req, res, next) => next();
  }
};

/**
 * Get Sentry error handler middleware for Express
 * Safe to call even if Sentry is not initialized - returns noop middleware
 */
const getSentryErrorHandler = () => {
  if (!isSentryActive()) {
    return (err, req, res, next) => next(err);
  }
  
  try {
    return Sentry.Handlers.errorHandler();
  } catch (error) {
    logger.error('[Sentry] Failed to create error handler', {error: error.message});
    return (err, req, res, next) => next(err);
  }
};

/**
 * Capture exception manually
 * Safe to call even if Sentry is not initialized
 */
const captureException = (error, context = {}) => {
  if (!isSentryActive()) {
    return;
  }

  try {
    Sentry.captureException(error, {
      contexts: {
        app: context,
      },
    });
  } catch (e) {
    logger.error('[Sentry] Failed to capture exception', {error: e.message});
  }
};

/**
 * Capture message manually
 * Safe to call even if Sentry is not initialized
 */
const captureMessage = (message, level = 'info', context = {}) => {
  if (!isSentryActive()) {
    return;
  }

  try {
    Sentry.captureMessage(message, {
      level,
      contexts: {
        app: context,
      },
    });
  } catch (e) {
    logger.error('[Sentry] Failed to capture message', {error: e.message});
  }
};

/**
 * Set user context (without PII)
 * Safe to call even if Sentry is not initialized
 */
const setUserContext = (userId) => {
  if (!isSentryActive()) {
    return;
  }

  try {
    Sentry.setUser({
      id: userId || 'anonymous',
      // DO NOT set email, name, ip_address, or other PII
    });
  } catch (e) {
    logger.error('[Sentry] Failed to set user context', {error: e.message});
  }
};

/**
 * Clear user context
 * Safe to call even if Sentry is not initialized
 */
const clearUserContext = () => {
  if (!isSentryActive()) {
    return;
  }

  try {
    Sentry.setUser(null);
  } catch (e) {
    logger.error('[Sentry] Failed to clear user context', {error: e.message});
  }
};

module.exports = {
  initSentry,
  isSentryActive,
  getSentryRequestHandler,
  getSentryTracingHandler,
  getSentryErrorHandler,
  captureException,
  captureMessage,
  setUserContext,
  clearUserContext,
};
