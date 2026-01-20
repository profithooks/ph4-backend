/**
 * Audit Controller
 * 
 * Business-wide audit log queries
 * Step 5: Staff Accountability
 */
const asyncHandler = require('express-async-handler');
const AuditEvent = require('../models/AuditEvent');
const AppError = require('../utils/AppError');

/**
 * Get business-wide audit log
 * GET /api/v1/audit?limit=100&cursor=&filter=
 */
const getBusinessAudit = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const cursor = req.query.cursor; // ISO timestamp
  const filter = req.query.filter; // Entity type filter: BILL, CUSTOMER, etc.
  
  // Build query
  const query = {
    actorUserId: userId, // Only show this user's actions (or could be businessId)
  };
  
  // Cursor pagination
  if (cursor) {
    query.createdAt = {$lt: new Date(cursor)};
  }
  
  // Entity type filter
  if (filter && filter !== 'ALL') {
    query.entityType = filter;
  }
  
  // Get audit events
  const auditEvents = await AuditEvent.find(query)
    .sort({createdAt: -1})
    .limit(limit)
    .populate('actorUserId', 'name email')
    .populate('customerId', 'name')
    .lean();
  
  // Next cursor
  const nextCursor = auditEvents.length === limit
    ? auditEvents[auditEvents.length - 1].createdAt
    : null;
  
  res.success({
    auditEvents,
    count: auditEvents.length,
    nextCursor,
    hasMore: !!nextCursor,
  });
});

/**
 * Get audit event by ID
 * GET /api/v1/audit/:id
 */
const getAuditEvent = asyncHandler(async (req, res) => {
  const {id} = req.params;
  const userId = req.user._id;
  
  const auditEvent = await AuditEvent.findOne({
    _id: id,
    actorUserId: userId,
  })
    .populate('actorUserId', 'name email')
    .populate('customerId', 'name')
    .lean();
  
  if (!auditEvent) {
    throw new AppError('Audit event not found', 404, 'NOT_FOUND');
  }
  
  res.success({auditEvent});
});

/**
 * Get audit statistics
 * GET /api/v1/audit/stats
 */
const getAuditStats = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const days = parseInt(req.query.days, 10) || 30;
  
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  // Aggregate by action type
  const byAction = await AuditEvent.aggregate([
    {
      $match: {
        actorUserId: userId,
        createdAt: {$gte: since},
      },
    },
    {
      $group: {
        _id: '$action',
        count: {$sum: 1},
      },
    },
    {
      $sort: {count: -1},
    },
  ]);
  
  // Aggregate by entity type
  const byEntity = await AuditEvent.aggregate([
    {
      $match: {
        actorUserId: userId,
        createdAt: {$gte: since},
      },
    },
    {
      $group: {
        _id: '$entityType',
        count: {$sum: 1},
      },
    },
    {
      $sort: {count: -1},
    },
  ]);
  
  // Total count
  const total = await AuditEvent.countDocuments({
    actorUserId: userId,
    createdAt: {$gte: since},
  });
  
  res.success({
    period: `${days} days`,
    since,
    total,
    byAction: byAction.map(item => ({
      action: item._id,
      count: item.count,
    })),
    byEntity: byEntity.map(item => ({
      entityType: item._id,
      count: item.count,
    })),
  });
});

module.exports = {
  getBusinessAudit,
  getAuditEvent,
  getAuditStats,
};
