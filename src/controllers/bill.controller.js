const Bill = require('../models/Bill');
const LedgerTransaction = require('../models/LedgerTransaction');
const Customer = require('../models/Customer');
const Item = require('../models/Item');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Generate next bill number for user
 */
const generateBillNo = async userId => {
  const lastBill = await Bill.findOne({userId})
    .sort({createdAt: -1})
    .select('billNo');

  if (!lastBill) {
    return 'BILL-001';
  }

  // Extract number from last bill (format: BILL-XXX)
  const match = lastBill.billNo.match(/BILL-(\d+)/);
  if (match) {
    const nextNum = parseInt(match[1], 10) + 1;
    return `BILL-${String(nextNum).padStart(3, '0')}`;
  }

  // Fallback to timestamp-based
  return `BILL-${Date.now()}`;
};

/**
 * Create a new bill
 * POST /api/bills
 */
exports.createBill = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {customerId, items, subTotal, discount, tax, grandTotal, paidAmount, dueDate, notes} =
      req.body;

    // Get idempotencyKey from headers or body
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;

    logger.debug('Bill creation request', {
      userId,
      requestId: req.headers['x-request-id'] || 'NO_RID',
      idempotencyKey: idempotencyKey || 'null',
      customerId,
    });

    // Validate required fields
    if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
      throw new AppError('Customer and at least one item are required', 400, 'VALIDATION_ERROR');
    }

    if (subTotal == null || grandTotal == null) {
      throw new AppError('subTotal and grandTotal are required', 400, 'VALIDATION_ERROR');
    }

    // Verify customer exists and belongs to user
    const customer = await Customer.findOne({_id: customerId, userId});
    if (!customer) {
      throw new AppError('Customer not found', 404, 'NOT_FOUND');
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await Bill.findOne({userId, idempotencyKey});
      if (existing) {
        logger.info('Idempotent duplicate bill creation detected', {
          userId,
          idempotencyKey,
          billId: existing._id,
        });
        return res.status(200).json({
          success: true,
          data: existing,
          message: 'Bill already exists (idempotent)',
        });
      }
    }

    // Generate bill number
    const billNo = await generateBillNo(userId);

    // Process items: upsert catalog items if itemId is missing
    const processedItems = await Promise.all(
      items.map(async item => {
        // If itemId is provided, use it
        if (item.itemId) {
          return {
            itemId: item.itemId,
            name: item.name,
            qty: item.qty,
            price: item.price,
            total: item.total,
          };
        }

        // If no itemId, upsert to catalog
        if (item.name && item.name.trim()) {
          try {
            const catalogItem = await Item.upsertByName(userId, item.name.trim(), item.price);
            return {
              itemId: catalogItem._id,
              name: item.name,
              qty: item.qty,
              price: item.price,
              total: item.total,
            };
          } catch (error) {
            console.error(`[Bill] Error upserting item ${item.name}:`, error);
            // If upsert fails, continue without itemId (backward compatible)
            return {
              name: item.name,
              qty: item.qty,
              price: item.price,
              total: item.total,
            };
          }
        }

        // Fallback: use item as-is
        return item;
      })
    );

    // Create bill
    const bill = await Bill.create({
      userId,
      customerId,
      billNo,
      items: processedItems,
      subTotal,
      discount: discount || 0,
      tax: tax || 0,
      grandTotal,
      paidAmount: paidAmount || 0,
      dueDate: dueDate || null,
      notes: notes || '',
      idempotencyKey: idempotencyKey || null,
    });

    // Auto-create ledger transaction if unpaid amount > 0
    const unpaidAmount = grandTotal - (paidAmount || 0);
    if (unpaidAmount > 0) {
      const ledgerIdempotencyKey = idempotencyKey
        ? `${idempotencyKey}_ledger_credit`
        : `bill_${bill._id}_credit`;

      // Check if ledger transaction already exists (for idempotency)
      const existingLedgerTx = await LedgerTransaction.findOne({
        userId,
        idempotencyKey: ledgerIdempotencyKey,
      });

      if (!existingLedgerTx) {
        await LedgerTransaction.create({
          userId,
          customerId,
          type: 'credit',
          amount: unpaidAmount,
          note: `Bill ${billNo} created`,
          metadata: {
            billId: bill._id,
            billNo: bill.billNo,
            source: 'bill_create',
          },
          idempotencyKey: ledgerIdempotencyKey,
        });

        console.log(`[Bill] Auto-created ledger CREDIT ₹${unpaidAmount} for bill ${billNo}`);
      }
    }

    res.status(201).json({
      success: true,
      data: bill,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List bills with pagination, filters, and search
 * GET /api/bills?limit=20&cursor=xxx&from=xxx&to=xxx&status=xxx&customerId=xxx&search=xxx
 */
exports.listBills = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      limit = 20,
      cursor,
      from,
      to,
      status,
      customerId,
      search,
      includeOverdue, // optional: include only overdue bills
    } = req.query;

    const pageLimit = Math.min(parseInt(limit, 10), 100); // Max 100 per page

    // Build filter
    const filter = {userId};

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Customer filter
    if (customerId) {
      filter.customerId = customerId;
    }

    // Date range filter (on createdAt)
    if (from || to) {
      filter.createdAt = {};
      if (from) {
        filter.createdAt.$gte = new Date(from);
      }
      if (to) {
        filter.createdAt.$lte = new Date(to);
      }
    }

    // Overdue filter
    if (includeOverdue === 'true') {
      filter.dueDate = {$lt: new Date()};
      filter.status = {$in: ['unpaid', 'partial']};
    }

    // Cursor-based pagination
    if (cursor) {
      filter._id = {$lt: cursor};
    }

    // Search: billNo OR customer name/phone
    // For simplicity, we'll fetch customers first if search is provided
    let customerIds = [];
    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      
      // Search by billNo
      filter.$or = [{billNo: searchRegex}];

      // Search by customer name/phone
      const matchingCustomers = await Customer.find({
        userId,
        $or: [{name: searchRegex}, {phone: searchRegex}],
      })
        .select('_id')
        .lean();

      if (matchingCustomers.length > 0) {
        customerIds = matchingCustomers.map(c => c._id);
        filter.$or.push({customerId: {$in: customerIds}});
      }
    }

    // Query bills
    const bills = await Bill.find(filter)
      .populate('customerId', 'name phone')
      .sort({createdAt: -1, _id: -1}) // Stable sort
      .limit(pageLimit + 1) // Fetch one extra to determine if there's a next page
      .lean();

    // Check if there are more results
    const hasMore = bills.length > pageLimit;
    const results = hasMore ? bills.slice(0, pageLimit) : bills;

    // Compute virtual fields manually for lean queries
    const enrichedResults = results.map(bill => ({
      ...bill,
      pendingAmount: Math.max(0, bill.grandTotal - bill.paidAmount),
      isOverdue:
        bill.dueDate &&
        bill.status !== 'paid' &&
        bill.status !== 'cancelled' &&
        new Date(bill.dueDate) < new Date() &&
        bill.grandTotal - bill.paidAmount > 0,
    }));

    // Generate next cursor
    const nextCursor = hasMore ? results[results.length - 1]._id : null;

    res.status(200).json({
      success: true,
      data: enrichedResults,
      nextCursor,
      hasMore,
      count: enrichedResults.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get bills summary (totals and counts)
 * GET /api/bills/summary?from=xxx&to=xxx&status=xxx&customerId=xxx
 */
exports.getBillsSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {from, to, status, customerId, search} = req.query;

    // Build filter (same logic as listBills)
    const filter = {userId};

    if (status) {
      filter.status = status;
    }

    if (customerId) {
      filter.customerId = customerId;
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) {
        filter.createdAt.$gte = new Date(from);
      }
      if (to) {
        filter.createdAt.$lte = new Date(to);
      }
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      const matchingCustomers = await Customer.find({
        userId,
        $or: [{name: searchRegex}, {phone: searchRegex}],
      })
        .select('_id')
        .lean();

      const customerIds = matchingCustomers.map(c => c._id);
      filter.$or = [{billNo: searchRegex}];
      if (customerIds.length > 0) {
        filter.$or.push({customerId: {$in: customerIds}});
      }
    }

    // Aggregate summary
    const summary = await Bill.aggregate([
      {$match: filter},
      {
        $group: {
          _id: null,
          totalCount: {$sum: 1},
          totalAmount: {$sum: '$grandTotal'},
          paidAmount: {$sum: '$paidAmount'},
          
          // Status breakdown
          paidCount: {
            $sum: {$cond: [{$eq: ['$status', 'paid']}, 1, 0]},
          },
          unpaidCount: {
            $sum: {$cond: [{$eq: ['$status', 'unpaid']}, 1, 0]},
          },
          partialCount: {
            $sum: {$cond: [{$eq: ['$status', 'partial']}, 1, 0]},
          },
          cancelledCount: {
            $sum: {$cond: [{$eq: ['$status', 'cancelled']}, 1, 0]},
          },

          // Amount by status
          paidTotal: {
            $sum: {$cond: [{$eq: ['$status', 'paid']}, '$grandTotal', 0]},
          },
          unpaidTotal: {
            $sum: {$cond: [{$eq: ['$status', 'unpaid']}, '$grandTotal', 0]},
          },
          partialTotal: {
            $sum: {$cond: [{$eq: ['$status', 'partial']}, '$grandTotal', 0]},
          },
        },
      },
    ]);

    const stats = summary[0] || {
      totalCount: 0,
      totalAmount: 0,
      paidAmount: 0,
      paidCount: 0,
      unpaidCount: 0,
      partialCount: 0,
      cancelledCount: 0,
      paidTotal: 0,
      unpaidTotal: 0,
      partialTotal: 0,
    };

    // Compute pending and overdue
    const pendingAmount = stats.totalAmount - stats.paidAmount;

    // Overdue calculation (bills with dueDate < now and pendingAmount > 0)
    const overdueFilter = {
      ...filter,
      dueDate: {$lt: new Date()},
      status: {$in: ['unpaid', 'partial']},
    };

    const overdueStats = await Bill.aggregate([
      {$match: overdueFilter},
      {
        $group: {
          _id: null,
          overdueCount: {$sum: 1},
          overdueAmount: {$sum: {$subtract: ['$grandTotal', '$paidAmount']}},
        },
      },
    ]);

    const overdue = overdueStats[0] || {overdueCount: 0, overdueAmount: 0};

    res.status(200).json({
      success: true,
      data: {
        totalCount: stats.totalCount,
        totalAmount: stats.totalAmount,
        paidAmount: stats.paidAmount,
        pendingAmount,
        overdueAmount: overdue.overdueAmount,
        overdueCount: overdue.overdueCount,
        statusBreakdown: {
          paid: {
            count: stats.paidCount,
            amount: stats.paidTotal,
          },
          unpaid: {
            count: stats.unpaidCount,
            amount: stats.unpaidTotal,
          },
          partial: {
            count: stats.partialCount,
            amount: stats.partialTotal,
          },
          cancelled: {
            count: stats.cancelledCount,
            amount: 0, // Cancelled bills don't contribute to amounts
          },
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single bill
 * GET /api/bills/:id
 */
exports.getBill = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {id} = req.params;

    const bill = await Bill.findOne({_id: id, userId})
      .populate('customerId', 'name phone')
      .lean();

    if (!bill) {
      throw new AppError('Bill not found', 404, 'NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: bill,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add payment to bill
 * PATCH /api/bills/:id/pay
 */
exports.addBillPayment = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {id} = req.params;
    const {amount, note} = req.body;

    // Get idempotencyKey from headers or body
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;

    console.log(
      `CTRL uid=srv_${Date.now()}_${Math.random().toString(36).slice(2, 10)} bill pay rid=${
        req.headers['x-request-id'] || 'NO_RID'
      } idem=${idempotencyKey || 'null'}`,
    );

    // Validate amount
    if (!amount || amount <= 0) {
      throw new AppError('Payment amount must be positive', 400, 'VALIDATION_ERROR');
    }

    // Find bill
    const bill = await Bill.findOne({_id: id, userId});
    if (!bill) {
      throw new AppError('Bill not found', 404, 'NOT_FOUND');
    }

    if (bill.status === 'cancelled') {
      throw new AppError('Cannot add payment to cancelled bill', 400, 'VALIDATION_ERROR');
    }

    // Check idempotency for ledger transaction
    const ledgerIdempotencyKey = idempotencyKey
      ? `${idempotencyKey}_ledger_debit`
      : `bill_${bill._id}_pay_${Date.now()}`;

    const existingLedgerTx = await LedgerTransaction.findOne({
      userId,
      idempotencyKey: ledgerIdempotencyKey,
    });

    if (existingLedgerTx) {
      console.log(`[Bill] Payment already processed (idempotent) for key=${ledgerIdempotencyKey}`);
      return res.status(200).json({
        success: true,
        data: bill,
        message: 'Payment already recorded (idempotent)',
      });
    }

    // Update bill
    const previousPaid = bill.paidAmount;
    bill.paidAmount = Math.min(bill.paidAmount + amount, bill.grandTotal);
    await bill.save();

    const actualPaymentAmount = bill.paidAmount - previousPaid;

    // Create ledger debit transaction (payment received)
    await LedgerTransaction.create({
      userId,
      customerId: bill.customerId,
      type: 'debit',
      amount: actualPaymentAmount,
      note: note || `Payment for Bill ${bill.billNo}`,
      metadata: {
        billId: bill._id,
        billNo: bill.billNo,
        source: 'bill_payment',
      },
      idempotencyKey: ledgerIdempotencyKey,
    });

    console.log(
      `[Bill] Added payment ₹${actualPaymentAmount} to bill ${bill.billNo}, status=${bill.status}`,
    );

    // Populate customer for response
    await bill.populate('customerId', 'name phone');

    res.status(200).json({
      success: true,
      data: bill,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel bill
 * PATCH /api/bills/:id/cancel
 */
exports.cancelBill = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {id} = req.params;

    const bill = await Bill.findOne({_id: id, userId});
    if (!bill) {
      throw new AppError('Bill not found', 404, 'NOT_FOUND');
    }

    if (bill.status === 'cancelled') {
      return res.status(200).json({
        success: true,
        data: bill,
        message: 'Bill already cancelled',
      });
    }

    bill.status = 'cancelled';
    await bill.save();

    console.log(`[Bill] Cancelled bill ${bill.billNo}`);

    res.status(200).json({
      success: true,
      data: bill,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBill: exports.createBill,
  listBills: exports.listBills,
  getBillsSummary: exports.getBillsSummary,
  getBill: exports.getBill,
  addBillPayment: exports.addBillPayment,
  cancelBill: exports.cancelBill,
};
