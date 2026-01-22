/**
 * Today Controller
 * 
 * Daily chase list + money-at-risk dashboard
 * Step 6: Recovery Engine (Cash Return)
 * 
 * TIMEZONE: All date calculations use Asia/Kolkata (IST) as canonical timezone
 * SINGLE SOURCE OF TRUTH: Counters are ALWAYS derived from the chase list
 */
const asyncHandler = require('express-async-handler');
const Bill = require('../models/Bill');
const Customer = require('../models/Customer');
const RecoveryCase = require('../models/RecoveryCase');
const FollowUpTask = require('../models/FollowUpTask');
const LedgerTransaction = require('../models/LedgerTransaction');
const Notification = require('../models/Notification');
const NotificationAttempt = require('../models/NotificationAttempt');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {TODAY_UPCOMING_DAYS} = require('../config/app.config');
const {
  getNowIST,
  getStartOfDayIST,
  getEndOfDayIST,
  getDaysOverdueIST,
  bucketDateIST,
  diffDaysFromNowIST,
} = require('../utils/timezone.util');

/**
 * Get money-at-risk summary
 * GET /api/v1/today/summary?date=YYYY-MM-DD
 */
const getTodaySummary = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const dateParam = req.query.date; // Optional YYYY-MM-DD
  
  // CRITICAL: Use IST for all day boundaries
  const targetDate = dateParam ? new Date(dateParam) : getNowIST();
  const todayStartIST = getStartOfDayIST(targetDate);
  const todayEndIST = getEndOfDayIST(targetDate);
  const nowIST = getNowIST();
  
  // Compute total receivable (all unpaid amounts)
  const receivable = await computeReceivable(userId);
  
  // Compute overdue (bills with dueDate < nowIST)
  const overdue = await computeOverdue(userId, nowIST, todayStartIST);
  
  // Compute due today (bills with dueDate within today IST)
  const dueToday = await computeDueToday(userId, todayStartIST, todayEndIST);
  
  // Compute broken promises (promiseAt < nowIST, promiseStatus BROKEN/OVERDUE, unpaid)
  const brokenPromises = await computeBrokenPromises(userId, nowIST, todayStartIST);
  
  // Compute chase counts
  const chaseCounts = await computeChaseCounts(userId, todayStartIST, todayEndIST, nowIST);
  
  res.success({
    date: todayStartIST.toISOString().split('T')[0],
    moneyAtRisk: {
      totalReceivable: receivable.total,
      totalOverdue: overdue.total,
      dueTodayOutstanding: dueToday.total,
      brokenPromiseAmount: brokenPromises.total,
    },
    chaseCounts: {
      overdueCustomers: overdue.count,
      promisesDueToday: chaseCounts.promisesDueToday,
      followUpsDueToday: chaseCounts.followUpsDueToday,
      totalChaseItems: chaseCounts.totalChaseItems,
    },
    meta: {
      computedAt: nowIST.toISOString(),
      timezone: 'Asia/Kolkata',
      sources: ['Bills', 'Promises', 'FollowUps'],
      requestId: req.requestId,
    },
  });
});

/**
 * Get daily chase list (CANONICAL - Single Source of Truth)
 * GET /api/v1/today/chase?date=YYYY-MM-DD&limit=50
 * 
 * CRITICAL: Counters are ALWAYS derived from this chase list.
 * No separate counting logic exists.
 */
const getDailyChaseList = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const dateParam = req.query.date;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  
  // CRITICAL: Use IST for all day boundaries
  const targetDate = dateParam ? new Date(dateParam) : getNowIST();
  const todayStartIST = getStartOfDayIST(targetDate);
  const todayEndIST = getEndOfDayIST(targetDate);
  const nowIST = getNowIST();
  
  // Calculate UPCOMING cutoff (TODAY_UPCOMING_DAYS from now)
  const upcomingCutoffIST = new Date(todayEndIST.getTime() + (TODAY_UPCOMING_DAYS * 24 * 60 * 60 * 1000));
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Build canonical normalized chase list (by customer)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const chaseByCustomer = {}; // { customerId: { customerId, customerName, phone, items: [] } }
  
  // 1a. Fetch ALL pending bills (unpaid/partial) with dueDate in range
  const bills = await Bill.find({
    userId,
    isDeleted: {$ne: true},
    status: {$in: ['unpaid', 'partial']},
    dueDate: {$lte: upcomingCutoffIST}, // Include upcoming
  }).populate('customerId', 'name phone isDeleted').lean();
  
  // Get interest settings for interest computation on bills
  const BusinessSettings = require('../models/BusinessSettings');
  const interestService = require('../services/interest.service');
  const settings = await BusinessSettings.getOrCreate(userId);
  // Note: nowIST already defined above at line 98

  for (const bill of bills) {
    if (!bill.customerId || bill.customerId.isDeleted) continue;
    
    const customerId = bill.customerId._id.toString();
    const dueAt = bill.dueDate;
    const bucket = bucketDateIST(dueAt);
    const overdueDays = getDaysOverdueIST(dueAt);
    const amountDue = bill.grandTotal - (bill.paidAmount || 0);
    
    if (amountDue <= 0) continue; // Skip fully paid
    
    // Initialize customer if not exists
    if (!chaseByCustomer[customerId]) {
      chaseByCustomer[customerId] = {
        customerId: bill.customerId._id,
        customerName: bill.customerId.name,
        phone: bill.customerId.phone || null,
        items: [],
      };
    }
    
    // Compute interest summary for this bill (if interest enabled)
    let interestSummary = null;
    if (settings.interestEnabled) {
      const interestResult = interestService.computeBillInterest(bill, settings, nowIST);
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
    
    // Add bill item with interest summary
    chaseByCustomer[customerId].items.push({
      kind: 'BILL',
      id: bill._id,
      billId: bill._id,
      dueAt,
      overdueDays,
      bucket,
      title: `Bill #${bill.billNo}`,
      amountDue,
      interestSummary, // Add interest summary for WhatsApp messages
    });
  }
  
  // 1b. Fetch ALL pending promises with promiseAt in range
  const promiseCases = await RecoveryCase.find({
    userId,
    promiseAt: {$exists: true, $ne: null, $lte: upcomingCutoffIST},
    status: {$in: ['open', 'promised', 'active']},
  }).populate('customerId', 'name phone isDeleted').lean();
  
  for (const rcase of promiseCases) {
    if (!rcase.customerId || rcase.customerId.isDeleted) continue;
    
    const customerId = rcase.customerId._id.toString();
    const dueAt = rcase.promiseAt;
    const bucket = bucketDateIST(dueAt);
    const overdueDays = getDaysOverdueIST(dueAt);
    const amountDue = rcase.promiseAmount || rcase.outstandingSnapshot || 0;
    
    // Initialize customer if not exists
    if (!chaseByCustomer[customerId]) {
      chaseByCustomer[customerId] = {
        customerId: rcase.customerId._id,
        customerName: rcase.customerId.name,
        phone: rcase.customerId.phone || null,
        items: [],
      };
    }
    
    // Add promise item
    chaseByCustomer[customerId].items.push({
      kind: 'PROMISE',
      id: rcase._id,
      dueAt,
      overdueDays,
      bucket,
      title: `Promise: Pay ${amountDue > 0 ? '₹' + amountDue : ''}`,
      amountDue,
      promiseStatus: rcase.promiseStatus,
    });
  }
  
  // 1c. Fetch ALL pending followups with dueAt in range
  const followUpTasks = await FollowUpTask.find({
    userId,
    isDeleted: {$ne: true},
    status: 'pending',
    dueAt: {$lte: upcomingCutoffIST},
  }).populate('customerId', 'name phone isDeleted').lean();
  
  for (const task of followUpTasks) {
    if (!task.customerId || task.customerId.isDeleted) continue;
    
    const customerId = task.customerId._id.toString();
    const dueAt = task.dueAt;
    const bucket = bucketDateIST(dueAt);
    const overdueDays = getDaysOverdueIST(dueAt);
    const amountDue = task.balance || 0;
    
    // Initialize customer if not exists
    if (!chaseByCustomer[customerId]) {
      chaseByCustomer[customerId] = {
        customerId: task.customerId._id,
        customerName: task.customerId.name,
        phone: task.customerId.phone || null,
        items: [],
      };
    }
    
    // Add followup item
    chaseByCustomer[customerId].items.push({
      kind: 'FOLLOWUP',
      id: task._id,
      dueAt,
      overdueDays,
      bucket,
      title: task.title || 'Follow-up',
      amountDue,
      channel: task.channel,
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Compute totals per customer and determine customer bucket
  // ═══════════════════════════════════════════════════════════════════════════
  
  const chaseCustomers = [];
  
  for (const customerId in chaseByCustomer) {
    const customer = chaseByCustomer[customerId];
    
    // Compute totals by bucket
    const totals = {
      overdue: 0,
      today: 0,
      upcoming: 0,
      total: 0,
    };
    
    let highestUrgency = 'UPCOMING'; // Default to lowest urgency
    
    for (const item of customer.items) {
      totals.total += item.amountDue;
      
      if (item.bucket === 'OVERDUE') {
        totals.overdue += item.amountDue;
        highestUrgency = 'OVERDUE'; // Override to highest
      } else if (item.bucket === 'TODAY') {
        totals.today += item.amountDue;
        if (highestUrgency !== 'OVERDUE') {
          highestUrgency = 'TODAY';
        }
      } else if (item.bucket === 'UPCOMING') {
        totals.upcoming += item.amountDue;
        // Keep existing urgency
      }
    }
    
    // Customer bucket = highest urgency among items
    const customerBucket = highestUrgency;
    
    // Find worst overdue days (max)
    const maxOverdueDays = Math.max(0, ...customer.items.map(i => i.overdueDays));
    
    chaseCustomers.push({
      ...customer,
      totals,
      bucket: customerBucket,
      overdueDays: maxOverdueDays,
      itemCount: customer.items.length,
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Sort deterministically (urgency-first, overdue days, amount, ID)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const bucketPriority = {OVERDUE: 3, TODAY: 2, UPCOMING: 1};
  
  chaseCustomers.sort((a, b) => {
    // 1. Bucket priority (OVERDUE > TODAY > UPCOMING)
    if (bucketPriority[a.bucket] !== bucketPriority[b.bucket]) {
      return bucketPriority[b.bucket] - bucketPriority[a.bucket];
    }
    // 2. Overdue days desc
    if (a.overdueDays !== b.overdueDays) {
      return b.overdueDays - a.overdueDays;
    }
    // 3. Total amount desc
    if (a.totals.total !== b.totals.total) {
      return b.totals.total - a.totals.total;
    }
    // 4. Customer ID (stable)
    return a.customerId.toString().localeCompare(b.customerId.toString());
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Derive counters from SAME chase list (SINGLE SOURCE OF TRUTH)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const counters = {
    customers: {
      overdue: chaseCustomers.filter(c => c.bucket === 'OVERDUE').length,
      today: chaseCustomers.filter(c => c.bucket === 'TODAY').length,
      upcoming: chaseCustomers.filter(c => c.bucket === 'UPCOMING').length,
      total: chaseCustomers.length,
    },
    items: {
      overdue: chaseCustomers.reduce((sum, c) => sum + c.items.filter(i => i.bucket === 'OVERDUE').length, 0),
      today: chaseCustomers.reduce((sum, c) => sum + c.items.filter(i => i.bucket === 'TODAY').length, 0),
      upcoming: chaseCustomers.reduce((sum, c) => sum + c.items.filter(i => i.bucket === 'UPCOMING').length, 0),
      total: chaseCustomers.reduce((sum, c) => sum + c.items.length, 0),
    },
  };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Self-check (CRITICAL for correctness)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const computedTotal = counters.customers.overdue + counters.customers.today + counters.customers.upcoming;
  const explicitTotal = counters.customers.total;
  
  if (computedTotal !== explicitTotal) {
    logger.warn(`[CHASE COUNTER MISMATCH] requestId=${req.requestId} computed=${computedTotal} explicit=${explicitTotal} breakdown=${JSON.stringify(counters.customers)}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Apply limit
  // ═══════════════════════════════════════════════════════════════════════════
  
  const limitedCustomers = chaseCustomers.slice(0, limit);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6.5: Add recovery visibility (ADDITIVE - backward compatible)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const {getDeliveryStatus} = require('../services/deliveryAttempt.service');
  
  for (const customer of limitedCustomers) {
    // Find latest recovery task for this customer
    const recoveryTask = await FollowUpTask.findOne({
      userId,
      customerId: customer.customerId,
      source: {$regex: /^AUTO_RECOVERY_/},
      isDeleted: {$ne: true},
    })
      .sort({createdAt: -1})
      .lean();
    
    if (recoveryTask) {
      // Get delivery status
      const deliveryStatus = await getDeliveryStatus(recoveryTask._id);
      
      customer.recovery = {
        lastAttemptAt: deliveryStatus.lastAttemptAt,
        lastAttemptStatus: deliveryStatus.lastAttemptStatus,
        nextAttemptAt: deliveryStatus.nextAttemptAt,
        failedReason: deliveryStatus.failedReason,
        stepKey: recoveryTask.source.replace('AUTO_RECOVERY_', ''), // e.g., STEP_0, STEP_3
        escalationLevel: recoveryTask.escalationLevel,
      };
    } else {
      // No recovery task exists yet
      customer.recovery = {
        lastAttemptAt: null,
        lastAttemptStatus: null,
        nextAttemptAt: null,
        failedReason: null,
        stepKey: null,
        escalationLevel: 0,
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Generate backward-compatible chaseItems[] (DEPRECATED)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const chaseItems = [];
  
  for (const customer of limitedCustomers) {
    for (const item of customer.items) {
      chaseItems.push({
        // Customer context
        customerId: customer.customerId,
        customerName: customer.customerName,
        customerPhone: customer.phone,
        customerBucket: customer.bucket,
        
        // Item details
        kind: item.kind,
        itemId: item.id,
        dueAt: item.dueAt,
        overdueDays: item.overdueDays,
        bucket: item.bucket,
        title: item.title,
        amountDue: item.amountDue,
        
        // Optional fields by kind
        ...(item.billId && {billId: item.billId}),
        ...(item.promiseStatus && {promiseStatus: item.promiseStatus}),
        ...(item.channel && {channel: item.channel}),
        
        // Stable key for rendering
        key: `${customer.customerId}-${item.kind}-${item.id}`,
      });
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7.5: Compute interest totals (if interest policy enabled)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Note: settings already loaded above for bill items
  
  let interestTotals = null;
  if (settings.interestEnabled) {
    // Compute interest for overdue bills only
    const overdueBills = await Bill.find({
      userId,
      isDeleted: {$ne: true},
      status: {$in: ['unpaid', 'partial']},
      dueDate: {$exists: true, $ne: null, $lt: nowIST},
    }).lean();
    
    let overdueInterestAccrued = 0;
    let overdueInterestPerDay = 0;
    let todayInterestAccrued = 0;
    let todayInterestPerDay = 0;
    
    for (const bill of overdueBills) {
      const result = interestService.computeBillInterest(bill, settings, nowIST);
      if (result.interestAccrued > 0) {
        const dueDate = new Date(bill.dueDate);
        const bucket = bucketDateIST(dueDate);
        
        if (bucket === 'OVERDUE') {
          overdueInterestAccrued += result.interestAccrued;
          overdueInterestPerDay += result.interestPerDay;
        } else if (bucket === 'TODAY') {
          todayInterestAccrued += result.interestAccrued;
          todayInterestPerDay += result.interestPerDay;
        }
      }
    }
    
    interestTotals = {
      overdue: {
        interestAccrued: Math.round(overdueInterestAccrued),
        interestPerDay: Math.round(overdueInterestPerDay * 100) / 100,
      },
      today: {
        interestAccrued: Math.round(todayInterestAccrued),
        interestPerDay: Math.round(todayInterestPerDay * 100) / 100,
      },
      policy: {
        enabled: true,
        ratePctPerMonth: settings.interestRatePctPerMonth,
        graceDays: settings.interestGraceDays,
      },
    };
  } else {
    interestTotals = {
      overdue: {interestAccrued: 0, interestPerDay: 0},
      today: {interestAccrued: 0, interestPerDay: 0},
      policy: {enabled: false},
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: Return response (v2 contract with backward compatibility)
  // ═══════════════════════════════════════════════════════════════════════════
  
  res.success({
    date: todayStartIST.toISOString().split('T')[0],
    
    // New contract (v2)
    chaseCustomers: limitedCustomers,
    counters,
    interestTotals, // Add interest totals
    
    // Backward compatibility (DEPRECATED)
    chaseItems,
    
    total: chaseCustomers.length,
    returned: limitedCustomers.length,
    meta: {
      computedAt: nowIST.toISOString(),
      timezone: 'Asia/Kolkata', // CRITICAL: All business logic computed in IST
      upcomingDays: TODAY_UPCOMING_DAYS,
      contractVersion: 2,
      deprecatedFields: ['chaseItems'],
      sources: ['Bills', 'Promises', 'FollowUps'],
      requestId: req.requestId,
      
      // Recovery metadata (IST-CORRECT)
      recovery: {
        timezone: 'Asia/Kolkata',
        note: 'All recovery dates (lastAttemptAt, nextAttemptAt) stored as UTC but computed relative to IST',
      },
    },
  });
});

// ===== HELPER FUNCTIONS =====

/**
 * Compute total receivable (all unpaid amounts)
 */
async function computeReceivable(userId) {
  const bills = await Bill.find({
    userId,
    isDeleted: {$ne: true},
    status: {$in: ['unpaid', 'partial']},
  });
  
  let total = 0;
  let count = 0;
  
  for (const bill of bills) {
    const unpaid = bill.grandTotal - (bill.paidAmount || 0);
    if (unpaid > 0) {
      total += unpaid;
      count++;
    }
  }
  
  return {total, count};
}

/**
 * Compute overdue amount (using IST timezone)
 */
async function computeOverdue(userId, nowIST, todayStartIST) {
  const bills = await Bill.find({
    userId,
    isDeleted: {$ne: true},
    status: {$in: ['unpaid', 'partial']},
    dueDate: {$lt: todayStartIST}, // Bills due before start of today (IST)
  });
  
  let total = 0;
  const customerIds = new Set();
  
  for (const bill of bills) {
    const unpaid = bill.grandTotal - (bill.paidAmount || 0);
    if (unpaid > 0) {
      total += unpaid;
      customerIds.add(bill.customerId.toString());
    }
  }
  
  return {total, count: customerIds.size};
}

/**
 * Compute due today
 */
async function computeDueToday(userId, todayStart, todayEnd) {
  const bills = await Bill.find({
    userId,
    isDeleted: {$ne: true},
    status: {$in: ['unpaid', 'partial']},
    dueDate: {$gte: todayStart, $lte: todayEnd},
  });
  
  let total = 0;
  
  for (const bill of bills) {
    const unpaid = bill.grandTotal - (bill.paidAmount || 0);
    if (unpaid > 0) {
      total += unpaid;
    }
  }
  
  return {total, count: bills.length};
}

/**
 * Compute broken promises (using IST timezone)
 */
async function computeBrokenPromises(userId, nowIST, todayStartIST) {
  const cases = await RecoveryCase.find({
    userId,
    promiseAt: {$lt: todayStartIST}, // Promises before start of today (IST)
    promiseStatus: {$in: ['OVERDUE', 'BROKEN']},
    status: {$in: ['open', 'promised', 'active']},
  });
  
  let total = 0;
  
  for (const rcase of cases) {
    total += rcase.promiseAmount || 0;
  }
  
  return {total, count: cases.length};
}

/**
 * Compute chase counts (using IST timezone)
 */
async function computeChaseCounts(userId, todayStartIST, todayEndIST, nowIST) {
  // Promises due today (IST)
  const promisesToday = await RecoveryCase.countDocuments({
    userId,
    promiseAt: {$gte: todayStartIST, $lte: todayEndIST},
    status: {$in: ['open', 'promised', 'active']},
  });
  
  // Follow-ups due today (IST)
  const followUpsToday = await FollowUpTask.countDocuments({
    userId,
    isDeleted: {$ne: true},
    status: 'pending',
    dueAt: {$gte: todayStartIST, $lte: todayEndIST},
  });
  
  // Overdue bills (before start of today IST)
  const overdueBills = await Bill.countDocuments({
    userId,
    isDeleted: {$ne: true},
    status: {$in: ['unpaid', 'partial']},
    dueDate: {$lt: todayStartIST},
  });
  
  return {
    promisesDueToday: promisesToday,
    followUpsDueToday: followUpsToday,
    totalChaseItems: promisesToday + followUpsToday + overdueBills,
  };
}

/**
 * Get last attempt status for customers
 */
async function getLastAttemptStatuses(userId, customerIds) {
  if (!customerIds || customerIds.length === 0) return {};
  
  // Get last notification attempt per customer
  const attempts = await NotificationAttempt.aggregate([
    {
      $lookup: {
        from: 'notifications',
        localField: 'notificationId',
        foreignField: '_id',
        as: 'notification',
      },
    },
    {
      $unwind: '$notification',
    },
    {
      $match: {
        'notification.userId': userId,
        'notification.customerId': {$in: customerIds},
      },
    },
    {
      $sort: {createdAt: -1},
    },
    {
      $group: {
        _id: '$notification.customerId',
        status: {$first: '$status'},
        at: {$first: '$createdAt'},
      },
    },
  ]);
  
  const result = {};
  for (const attempt of attempts) {
    result[attempt._id.toString()] = {
      status: attempt.status,
      at: attempt.at,
    };
  }
  
  return result;
}

module.exports = {
  getTodaySummary,
  getDailyChaseList,
};
