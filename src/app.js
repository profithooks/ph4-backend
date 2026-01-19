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
const requestLogger = require('./middleware/request-logger.middleware');
const {getSentryRequestHandler, getSentryTracingHandler, getSentryErrorHandler} = require('./config/sentry');

// Route imports
const authRoutes = require('./routes/auth.routes');
// const otpAuthRoutes = require('./routes/otpAuth.routes'); // OTP: Paused - files kept for future use
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

const app = express();

// Security: Trust proxy (if behind reverse proxy)
if (trustProxy) {
  app.set('trust proxy', 1);
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

// Sentry: Request handler (early, before routes)
// Safe to call even if Sentry not initialized - will be noop
app.use(getSentryRequestHandler());

// Sentry: Tracing handler (for performance monitoring)
app.use(getSentryTracingHandler());

// Request logger (logs entry + finish)
app.use(requestLogger);

// Security: Global rate limiting for all API routes
app.use('/api', globalLimiter);

// Routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
// app.use('/api/auth/otp', otpAuthRoutes); // OTP: Paused - route disabled
app.use('/api/customers', customerRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/recovery', recoveryRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/settings', settingsRoutes);

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
