const asyncHandler = require('express-async-handler');
const Expense = require('../models/Expense');
const AppError = require('../utils/AppError');
const {auditCreate, auditUpdate, auditDelete} = require('../services/auditHelper.service');
const {getUserRole} = require('../middleware/permission.middleware');

const toBusinessId = req => req.user.businessId || req.user.id || req.user._id;

exports.createOrUpsert = asyncHandler(async (req, res) => {
  const businessId = toBusinessId(req);
  const userId = req.user.id || req.user._id;
  const role = getUserRole(req);
  const payload = {...req.body, businessId};

  const existing = await Expense.findOne({businessId, clientId: payload.clientId});

  let expense;
  if (existing) {
    const before = existing.toObject();
    expense = await Expense.findOneAndUpdate(
      {businessId, clientId: payload.clientId},
      {...payload, updatedAt: new Date()},
      {new: true}
    );
    auditUpdate({
      action: 'EXPENSE_UPDATED',
      actorUserId: userId,
      actorRole: role,
      entityType: 'EXPENSE',
      entityId: expense._id,
      businessId,
      before,
      after: expense.toObject(),
      metadata: {clientId: payload.clientId},
      requestId: req.requestId,
    });
  } else {
    expense = await Expense.create(payload);
    auditCreate({
      action: 'EXPENSE_CREATED',
      actorUserId: userId,
      actorRole: role,
      entityType: 'EXPENSE',
      entityId: expense._id,
      businessId,
      after: expense.toObject(),
      metadata: {clientId: payload.clientId},
      requestId: req.requestId,
    });
  }

  res.status(existing ? 200 : 201).json({success: true, data: expense});
});

exports.list = asyncHandler(async (req, res) => {
  const businessId = toBusinessId(req);
  const {from, to, limit = 50, cursor} = req.query;

  const pageLimit = Math.min(parseInt(limit, 10) || 50, 200);

  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  const query = {
    businessId,
    spentAt: {$gte: start, $lte: end},
  };

  if (cursor) {
    const [spentCursor, idCursor] = cursor.split('|');
    query.$or = [
      {spentAt: {$lt: new Date(spentCursor)}},
      {spentAt: new Date(spentCursor), _id: {$lt: idCursor}},
    ];
  }

  const results = await Expense.find(query)
    .sort({spentAt: -1, _id: -1})
    .limit(pageLimit + 1)
    .lean();

  const hasMore = results.length > pageLimit;
  const items = hasMore ? results.slice(0, pageLimit) : results;
  const nextCursor = hasMore
    ? `${items[items.length - 1].spentAt.toISOString()}|${items[items.length - 1]._id}`
    : null;

  res.json({success: true, data: items, nextCursor, hasMore});
});

exports.update = asyncHandler(async (req, res) => {
  const businessId = toBusinessId(req);
  const userId = req.user.id || req.user._id;
  const role = getUserRole(req);
  const {id} = req.params;
  const updates = req.body;

  const expense = await Expense.findOne({_id: id, businessId});
  if (!expense) throw new AppError('Expense not found', 404, 'NOT_FOUND');

  const before = expense.toObject();
  Object.assign(expense, updates, {updatedAt: new Date()});
  await expense.save();

  auditUpdate({
    action: 'EXPENSE_UPDATED',
    actorUserId: userId,
    actorRole: role,
    entityType: 'EXPENSE',
    entityId: expense._id,
    businessId,
    before,
    after: expense.toObject(),
    metadata: {clientId: expense.clientId},
    requestId: req.requestId,
  });

  res.json({success: true, data: expense});
});

exports.remove = asyncHandler(async (req, res) => {
  const businessId = toBusinessId(req);
  const userId = req.user.id || req.user._id;
  const role = getUserRole(req);
  const {id} = req.params;

  const expense = await Expense.findOne({_id: id, businessId});
  if (!expense) throw new AppError('Expense not found', 404, 'NOT_FOUND');

  const before = expense.toObject();
  await Expense.deleteOne({_id: id, businessId});

  auditDelete({
    action: 'EXPENSE_DELETED',
    actorUserId: userId,
    actorRole: role,
    entityType: 'EXPENSE',
    entityId: id,
    businessId,
    before,
    metadata: {clientId: expense.clientId},
    requestId: req.requestId,
  });

  res.json({success: true, data: {deleted: true}});
});
