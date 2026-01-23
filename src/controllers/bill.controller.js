const Bill = require('../models/Bill');
const LedgerTransaction = require('../models/LedgerTransaction');
const Customer = require('../models/Customer');
const Item = require('../models/Item');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
  checkCreditLimit,
  createAuditEvent,
} = require('../services/creditControl.service');
const {auditCreate, auditUpdate, auditDelete} = require('../services/auditHelper.service');
const {getUserRole} = require('../middleware/permission.middleware');

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
 * 
 * ROCKEFELLER-GRADE CREDIT ENFORCEMENT:
 * - Atomically reserves credit BEFORE bill creation (no race conditions)
 * - If bill creation fails, credit is rolled back atomically
 * - Audit trail for all credit decisions (PASSED/BLOCKED/OVERRIDE)
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

    // ═══════════════════════════════════════════════════════════════════════
    // ROCKEFELLER-GRADE ATOMIC CREDIT LIMIT ENFORCEMENT
    // ═══════════════════════════════════════════════════════════════════════
    
    const unpaidAmount = grandTotal - (paidAmount || 0);
    let creditReserved = false;
    
    if (unpaidAmount > 0) {
      const {atomicReserveCredit, atomicReleaseCredit} = require('../services/creditControlAtomic.service');
      
      // Check for owner override
      const ownerOverride = req.headers['x-owner-override'] === 'true';
      const overrideReason = req.body.overrideReason;
      
      // ATOMIC OPERATION: Reserve credit (check + increment in single atomic operation)
      const reserveResult = await atomicReserveCredit({
        userId,
        customerId,
        delta: unpaidAmount,
        override: ownerOverride && overrideReason,
        overrideReason,
        billId: 'pending', // Will be updated after bill created
        requestId: req.requestId,
      });
      
      if (!reserveResult.success) {
        // BLOCKED: Credit limit exceeded
        // Audit event already logged in atomicReserveCredit
        
        throw new AppError(
          'Credit limit exceeded',
          409,
          'CREDIT_LIMIT_EXCEEDED',
          {
            ...reserveResult.details,
            requiredOverride: customer.creditLimitAllowOverride,
          }
        );
      }
      
      creditReserved = true;
      logger.info('[Bill] Credit reserved atomically', {
        customerId,
        unpaidAmount,
        newOutstanding: reserveResult.customer.creditOutstanding,
      });
    }

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

    // ═══════════════════════════════════════════════════════════════════════
    // CREATE BILL (with atomic rollback on failure)
    // ═══════════════════════════════════════════════════════════════════════
    
    let bill;
    try {
      bill = await Bill.create({
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
    } catch (billCreateError) {
      // ROLLBACK: Release reserved credit atomically
      if (creditReserved) {
        const {atomicReleaseCredit} = require('../services/creditControlAtomic.service');
        await atomicReleaseCredit({
          userId,
          customerId,
          delta: unpaidAmount,
          reason: 'ROLLBACK_BILL_CREATE_FAILED',
          billId: null,
          requestId: req.requestId,
        });
        
        logger.warn('[Bill] Credit rollback executed - bill creation failed', {
          customerId,
          unpaidAmount,
          error: billCreateError.message,
        });
      }
      
      throw billCreateError; // Re-throw original error
    }

    // Auto-create ledger transaction if unpaid amount > 0
    // (unpaidAmount already computed for credit limit check above)
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
      
      // NOTE: Audit events for credit (PASSED/BLOCKED/OVERRIDE) already logged
      // by atomicReserveCredit service - no duplicate logging needed here
    }
    
    // AUDIT EVENT: Bill Created (Step 5)
    await auditCreate({
      action: 'BILL_CREATED',
      actorUserId: userId,
      actorRole: getUserRole(req),
      entityType: 'BILL',
      entity: bill,
      customerId: bill.customerId,
      businessId: req.user.businessId,
      metadata: {
        billNo: bill.billNo,
        billAmount: bill.grandTotal,
        customerName: customer.name,
      },
      requestId: req.requestId,
    });

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
    const filter = {
      userId,
      isDeleted: false, // Step 5: Exclude soft-deleted bills
    };

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

    // Get interest settings for interest computation
    const BusinessSettings = require('../models/BusinessSettings');
    const interestService = require('../services/interest.service');
    const settings = await BusinessSettings.getOrCreate(userId);
    const now = new Date();

    // Compute virtual fields manually for lean queries + interest summary
    const enrichedResults = results.map(bill => {
      const pendingAmount = Math.max(0, bill.grandTotal - bill.paidAmount);
      const isOverdue =
        bill.dueDate &&
        bill.status !== 'paid' &&
        bill.status !== 'cancelled' &&
        new Date(bill.dueDate) < new Date() &&
        pendingAmount > 0;

      // Compute interest summary (only if interest enabled)
      let interestSummary = null;
      if (settings.interestEnabled) {
        const interestResult = interestService.computeBillInterest(bill, settings, now);
        if (interestResult.interestAccrued > 0) {
          interestSummary = {
            interestAccrued: interestResult.interestAccrued,
            interestPerDay: interestResult.interestPerDay,
            totalWithInterest: interestResult.totalWithInterest,
            startsAt: interestResult.startsAt,
            daysAccruing: interestResult.daysAccruing,
          };
        } else {
          // Include zero interest summary if policy enabled but no interest yet
          interestSummary = {
            interestAccrued: 0,
            interestPerDay: interestResult.interestPerDay,
            totalWithInterest: interestResult.totalWithInterest,
            startsAt: interestResult.startsAt,
            daysAccruing: 0,
          };
        }
      }

      return {
        ...bill,
        pendingAmount,
        isOverdue,
        interestSummary, // Add interest summary
      };
    });

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
 * Includes interest detail when interest policy is enabled
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

    // Get interest settings and compute interest detail
    const BusinessSettings = require('../models/BusinessSettings');
    const interestService = require('../services/interest.service');
    const settings = await BusinessSettings.getOrCreate(userId);
    const now = new Date();

    // Compute interest detail
    let interestDetail = null;
    if (settings.interestEnabled) {
      const interestResult = interestService.computeBillInterest(bill, settings, now);
      
      interestDetail = {
        enabled: true,
        policy: {
          ratePctPerMonth: settings.interestRatePctPerMonth,
          graceDays: settings.interestGraceDays,
          capPctOfPrincipal: settings.interestCapPctOfPrincipal,
          basis: settings.interestBasis,
          rounding: settings.interestRounding,
        },
        computation: {
          principalBase: interestResult.principalBase,
          interestAccrued: interestResult.interestAccrued,
          interestPerDay: interestResult.interestPerDay,
          totalWithInterest: interestResult.totalWithInterest,
          startsAt: interestResult.startsAt,
          daysAccruing: interestResult.daysAccruing,
          overdueDays: interestResult.overdueDays,
          graceDays: interestResult.graceDays,
        },
        computedAt: now.toISOString(),
      };
    } else {
      interestDetail = {
        enabled: false,
        policy: null,
        computation: {
          principalBase: Math.max(0, bill.grandTotal - (bill.paidAmount || 0)),
          interestAccrued: 0,
          interestPerDay: 0,
          totalWithInterest: Math.max(0, bill.grandTotal - (bill.paidAmount || 0)),
          startsAt: null,
          daysAccruing: 0,
          overdueDays: 0,
          graceDays: 0,
        },
        computedAt: now.toISOString(),
      };
    }

    res.status(200).json({
      success: true,
      data: {
        ...bill,
        interestDetail, // Add interest detail
      },
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

    // ═══════════════════════════════════════════════════════════════════════
    // ATOMIC CREDIT RELEASE: Payment reduces outstanding
    // ═══════════════════════════════════════════════════════════════════════
    
    const previousPaid = bill.paidAmount;
    const newPaidAmount = Math.min(bill.paidAmount + amount, bill.grandTotal);
    const actualPaymentAmount = newPaidAmount - previousPaid;
    
    // Atomically release credit (payment received)
    if (actualPaymentAmount > 0) {
      const {atomicReleaseCredit} = require('../services/creditControlAtomic.service');
      await atomicReleaseCredit({
        userId,
        customerId: bill.customerId,
        delta: actualPaymentAmount,
        reason: 'PAYMENT',
        billId: bill._id,
        requestId: req.requestId,
      });
    }
    
    // Update bill
    bill.paidAmount = newPaidAmount;
    await bill.save();

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
      `[Bill] Payment ₹${actualPaymentAmount} recorded, credit released atomically, status=${bill.status}`,
    );

    // Generate PAYMENT_RECEIVED notification (non-blocking, must not fail payment)
    if (actualPaymentAmount > 0) {
      const {generatePaymentReceivedNotification} = require('../services/notifications/generators/paymentReceived');
      generatePaymentReceivedNotification({
        billId: bill._id,
        userId,
      }).catch(error => {
        // Swallow errors - payment must succeed even if notification fails
        logger.error('[Bill] Failed to generate payment notification', {
          error: error.message,
          billId: bill._id,
          userId,
        });
      });
    }

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

    const billBefore = await Bill.findOne({
      _id: id,
      userId,
      isDeleted: false, // Step 5: Can't cancel deleted bill
    });
    
    if (!billBefore) {
      throw new AppError('Bill not found', 404, 'NOT_FOUND');
    }

    if (billBefore.status === 'cancelled') {
      return res.status(200).json({
        success: true,
        data: billBefore,
        message: 'Bill already cancelled',
      });
    }

    billBefore.status = 'cancelled';
    await billBefore.save();

    console.log(`[Bill] Cancelled bill ${billBefore.billNo}`);
    
    // AUDIT EVENT: Bill Status Changed (Step 5)
    await auditUpdate({
      action: 'BILL_STATUS_CHANGED',
      actorUserId: userId,
      actorRole: getUserRole(req),
      entityType: 'BILL',
      beforeEntity: {_id: billBefore._id, status: 'unpaid'}, // Simplified before state
      afterEntity: billBefore,
      customerId: billBefore.customerId,
      businessId: req.user.businessId,
      metadata: {
        billNo: billBefore.billNo,
        statusChange: 'unpaid → cancelled',
      },
      requestId: req.requestId,
    });

    res.status(200).json({
      success: true,
      data: billBefore,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Soft-delete a bill (owner only)
 * DELETE /api/bills/:id
 */
exports.deleteBill = async (req, res, next) => {
  try {
    const {id} = req.params;
    const {reason} = req.body;
    const userId = req.user.id;
    
    // Require reason
    if (!reason || !reason.trim()) {
      throw new AppError(
        'Delete reason is required',
        400,
        'REASON_REQUIRED'
      );
    }
    
    // Get bill
    const bill = await Bill.findOne({
      _id: id,
      userId,
      isDeleted: false,
    });
    
    if (!bill) {
      throw new AppError('Bill not found', 404, 'NOT_FOUND');
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ATOMIC CREDIT RELEASE: Deleted bill's unpaid amount released
    // ═══════════════════════════════════════════════════════════════════════
    
    const unpaidAmount = bill.grandTotal - bill.paidAmount;
    if (unpaidAmount > 0) {
      const {atomicReleaseCredit} = require('../services/creditControlAtomic.service');
      await atomicReleaseCredit({
        userId,
        customerId: bill.customerId,
        delta: unpaidAmount,
        reason: 'BILL_DELETED',
        billId: bill._id,
        requestId: req.requestId,
      });
      
      logger.info('[Bill] Credit released for deleted bill', {
        billId: bill._id,
        unpaidAmount,
      });
    }
    
    // Soft delete
    bill.isDeleted = true;
    bill.deletedAt = new Date();
    bill.deletedBy = userId;
    bill.deleteReason = reason.trim();
    
    await bill.save();
    
    // Audit event
    await auditDelete({
      action: 'BILL_DELETED',
      actorUserId: userId,
      actorRole: getUserRole(req),
      entityType: 'BILL',
      entity: bill,
      customerId: bill.customerId,
      businessId: req.user.businessId,
      reason: reason.trim(),
      metadata: {
        billNo: bill.billNo,
        billAmount: bill.grandTotal,
      },
      requestId: req.requestId,
    });
    
    logger.info('[Bill] Bill soft-deleted', {
      billId: bill._id,
      billNo: bill.billNo,
      reason: reason.trim(),
    });
    
    res.json({
      success: true,
      message: 'Bill deleted',
      data: {billId: bill._id},
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
  deleteBill: exports.deleteBill,
};
