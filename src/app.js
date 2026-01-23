/**
 * Express application setup
 */
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const {corsOptions, bodyLimits, trustProxy} = require('./config/security');
const {globalLimiter} = require('./middleware/rateLimit.middleware');
const errorHandler = require('./middleware/error.middleware');
const requestUid = require('./middleware/requestUid.middleware');
const requestLogger = require('./middleware/requestLogger.middleware'); // UNIFIED: Winston-based structured logging
const idempotencyMiddleware = require('./middleware/idempotency.middleware');
const {responseEnvelopeMiddleware} = require('./utils/responseEnvelope');
const {getSentryRequestHandler, getSentryTracingHandler, getSentryErrorHandler} = require('./config/sentry');

// Route imports
const authRoutes = require('./routes/auth.routes');
// const otpAuthRoutes = require('./routes/otpAuth.routes'); // OTP: Paused - files kept for future use
const authOtpSimpleRoutes = require('./routes/authOtpSimple.routes'); // Zero-friction OTP auth
const entitlementRoutes = require('./routes/entitlement.routes'); // Freemium entitlement
const proRoutes = require('./routes/pro.routes'); // Pro plan activation & subscription management
const customerRoutes = require('./routes/customer.routes');
const ledgerRoutes = require('./routes/ledger.routes');
const recoveryRoutes = require('./routes/recovery.routes');
const followupRoutes = require('./routes/followup.routes');
const billRoutes = require('./routes/bill.routes');
const itemRoutes = require('./routes/item.routes');
const attemptRoutes = require('./routes/attempt.routes');
const messageRoutes = require('./routes/message.routes');
const settingsRoutes = require('./routes/settings.routes');
const healthRoutes = require('./routes/health.routes');
const diagnosticsRoutes = require('./routes/diagnostics.routes');
const notificationRoutes = require('./routes/notification.routes');
const auditRoutes = require('./routes/audit.routes');
const todayRoutes = require('./routes/today.routes');
const promiseRoutes = require('./routes/promise.routes');
const insightsRoutes = require('./routes/insights.routes');
const securityRoutes = require('./routes/security.routes');
const pilotModeRoutes = require('./routes/pilotMode.routes');
const opsRoutes = require('./routes/ops.routes');
const supportRoutes = require('./routes/support.routes');
const specComplianceRoutes = require('./routes/specCompliance.routes');
const backupRoutes = require('./routes/backup.routes');
const publicBillRoutes = require('./routes/publicBill.routes');

// Step 23: Go-Live & Rollout Control middleware
const {checkGlobalKillSwitch, checkFeatureKillSwitches} = require('./middleware/killSwitch.middleware');
const {checkFeatureFreeze} = require('./middleware/featureFreeze.middleware');

const app = express();

// Security: Trust proxy (if behind reverse proxy)
// In production, this should be enabled to correctly detect protocol/host
if (trustProxy) {
  app.set('trust proxy', 1);
} else if (process.env.NODE_ENV === 'production') {
  // Warn if trust proxy is not enabled in production (may cause incorrect protocol detection)
  console.warn('[WARN] TRUST_PROXY is not enabled in production. This may cause incorrect protocol/host detection behind reverse proxy.');
}

// Security: Disable x-powered-by header
app.disable('x-powered-by');

// Security: Helmet for security headers
app.use(helmet());

// Performance: Compression
app.use(compression());

// Security: CORS with strict origin checking
app.use(cors(corsOptions));

// Security: Body size limits
app.use(express.json({limit: bodyLimits.json}));
app.use(express.urlencoded({extended: false, limit: bodyLimits.urlencoded}));

// Request UID generator (must be first)
app.use(requestUid);

// Response envelope helpers (adds res.success() and res.fail())
app.use(responseEnvelopeMiddleware);

// Sentry: Request handler (early, before routes)
// Safe to call even if Sentry not initialized - will be noop
app.use(getSentryRequestHandler());

// Sentry: Tracing handler (for performance monitoring)
app.use(getSentryTracingHandler());

// UNIFIED REQUEST LOGGER: Winston-based structured logging (logs completion with duration, status, errorCode)
// Replaces console.log-based request-logger.middleware.js
app.use(requestLogger);

// Idempotency middleware (for offline-first sync)
app.use(idempotencyMiddleware);

// Security: Global rate limiting for all API routes
app.use('/api', globalLimiter);

// Step 23: Kill-switch & feature freeze middleware (after auth, before routes)
app.use('/api', checkGlobalKillSwitch);
app.use('/api', checkFeatureKillSwitches);
app.use('/api', checkFeatureFreeze);

// Routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
// app.use('/api/auth/otp', otpAuthRoutes); // OTP: Paused - route disabled
app.use('/api/v1/auth', authOtpSimpleRoutes); // Zero-friction OTP auth (versioned)
app.use('/api/v1/auth', entitlementRoutes); // Freemium entitlement (versioned)
app.use('/api/v1/pro', proRoutes); // Pro plan activation & subscription (versioned)
app.use('/api/customers', customerRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/recovery', recoveryRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/v1/diagnostics', diagnosticsRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/today', todayRoutes);
app.use('/api/v1', promiseRoutes);
app.use('/api/v1/insights', insightsRoutes);
app.use('/api/v1/security', securityRoutes);
app.use('/api/v1', pilotModeRoutes);
app.use('/api/v1/ops', opsRoutes);
app.use('/api/v1/support', supportRoutes);
app.use('/api/v1/dev', specComplianceRoutes);
app.use('/api/v1/backup', backupRoutes);

// Public routes (outside /api prefix, no auth required)
app.use('/public', publicBillRoutes);

// Health check (legacy, kept for backward compatibility)
app.get('/health', (req, res) => {
  res.json({success: true, message: 'Server is running'});
});

// Sentry: Error handler (must be before main error handler)
// Safe to call even if Sentry not initialized - will be noop
app.use(getSentryErrorHandler());

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;

/*
 * ============================================================
 * PROD CHECKLIST P0 - Required Environment Variables
 * ============================================================
 * 
 * Security Configuration:
 * -----------------------
 * CORS_ORIGINS          - Comma-separated allowed origins (e.g., "https://app.example.com,https://admin.example.com")
 *                         Default: "http://localhost:19000,http://localhost:8081,http://localhost:3000"
 * 
 * CORS_CREDENTIALS      - Enable credentials (cookies/auth headers) (e.g., "true" or "false")
 *                         Default: false
 * 
 * TRUST_PROXY           - Trust X-Forwarded-* headers from reverse proxy (e.g., "true" or "false")
 *                         Default: false
 *                         Set to "true" if behind nginx/CloudFlare/AWS ALB
 * 
 * Server Configuration:
 * ---------------------
 * PORT                  - Server port (e.g., "5055")
 *                         Default: 5055
 * 
 * Example .env for Production:
 * -----------------------------
 * CORS_ORIGINS=https://yourdomain.com
 * CORS_CREDENTIALS=true
 * TRUST_PROXY=true
 * PORT=5055
 * 
 * ============================================================
 */
