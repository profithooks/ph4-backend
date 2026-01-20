/**
 * Diagnostics controller
 * 
 * Provides read-only access to reliability events for debugging
 */
const asyncHandler = require('express-async-handler');
const ReliabilityEvent = require('../models/ReliabilityEvent');
const AppError = require('../utils/AppError');

/**
 * Get reliability events for diagnostics
 * GET /api/v1/diagnostics/reliability?limit=100&kind=WRITE_FAIL
 * 
 * @access Private (requires auth)
 */
const getReliabilityEvents = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500); // Max 500
  const kind = req.query.kind; // Optional filter: WRITE_FAIL, ENGINE_FAIL, etc.
  
  // Build query
  const query = {
    userId,
  };
  
  if (kind && ['WRITE_FAIL', 'ENGINE_FAIL', 'SYNC_FAIL', 'NOTIF_FAIL'].includes(kind)) {
    query.kind = kind;
  }
  
  // Fetch events
  const events = await ReliabilityEvent.find(query)
    .sort({at: -1}) // Most recent first
    .limit(limit)
    .select('-__v') // Exclude version key
    .lean();
  
  // Sanitize events - remove sensitive data
  const sanitized = events.map(event => ({
    id: event._id,
    requestId: event.requestId,
    at: event.at,
    layer: event.layer,
    kind: event.kind,
    route: event.route,
    method: event.method,
    entityType: event.entityType,
    entityId: event.entityId,
    code: event.code,
    message: event.message,
    retryable: event.retryable,
    status: event.status,
    // Only include details if not sensitive
    details: event.details?.errors || event.details?.statusCode ? {
      errors: event.details.errors,
      statusCode: event.details.statusCode,
    } : undefined,
  }));
  
  res.success({
    events: sanitized,
    count: sanitized.length,
    limit,
  });
});

/**
 * Get reliability event by requestId
 * GET /api/v1/diagnostics/reliability/:requestId
 * 
 * @access Private (requires auth)
 */
const getReliabilityEventByRequestId = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const {requestId} = req.params;
  
  const events = await ReliabilityEvent.find({
    requestId,
    userId,
  })
    .sort({at: -1})
    .select('-__v')
    .lean();
  
  if (!events || events.length === 0) {
    throw new AppError('No events found for this requestId', 404, 'NOT_FOUND');
  }
  
  // Sanitize
  const sanitized = events.map(event => ({
    id: event._id,
    requestId: event.requestId,
    at: event.at,
    layer: event.layer,
    kind: event.kind,
    route: event.route,
    method: event.method,
    entityType: event.entityType,
    entityId: event.entityId,
    code: event.code,
    message: event.message,
    retryable: event.retryable,
    status: event.status,
    details: event.details,
  }));
  
  res.success({
    events: sanitized,
    count: sanitized.length,
  });
});

/**
 * Get reliability stats summary
 * GET /api/v1/diagnostics/reliability/stats
 * 
 * @access Private (requires auth)
 */
const getReliabilityStats = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const hours = parseInt(req.query.hours, 10) || 24; // Default last 24 hours
  
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  // Aggregate stats by kind
  const stats = await ReliabilityEvent.aggregate([
    {
      $match: {
        userId,
        at: {$gte: since},
      },
    },
    {
      $group: {
        _id: '$kind',
        count: {$sum: 1},
        retryableCount: {
          $sum: {$cond: ['$retryable', 1, 0]},
        },
      },
    },
  ]);
  
  // Total count
  const total = await ReliabilityEvent.countDocuments({
    userId,
    at: {$gte: since},
  });
  
  res.success({
    total,
    byKind: stats.reduce((acc, s) => {
      acc[s._id] = {
        count: s.count,
        retryable: s.retryableCount,
      };
      return acc;
    }, {}),
    since,
    hours,
  });
});

module.exports = {
  getReliabilityEvents,
  getReliabilityEventByRequestId,
  getReliabilityStats,
};
