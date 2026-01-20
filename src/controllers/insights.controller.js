/**
 * Insights Controller
 * 
 * Decision Intelligence: Aging buckets, cash-in forecast, defaulter risk
 * Step 7: Decision Intelligence
 * 
 * TIMEZONE: All date calculations use Asia/Kolkata (IST) as canonical timezone
 */
const asyncHandler = require('express-async-handler');
const Bill = require('../models/Bill');
const Customer = require('../models/Customer');
const RecoveryCase = require('../models/RecoveryCase');
const FollowUpTask = require('../models/FollowUpTask');
const LedgerTransaction = require('../models/LedgerTransaction');
const NotificationAttempt = require('../models/NotificationAttempt');
const ReliabilityEvent = require('../models/ReliabilityEvent');
const logger = require('../utils/logger');
const {getNowIST, getDaysOverdueIST} = require('../utils/timezone.util');

// In-memory cache (60s TTL per business)
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Get aging buckets
 * GET /api/v1/insights/aging?date=YYYY-MM-DD
 */
const getAgingBuckets = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const dateParam = req.query.date;
  
  try {
    // Check cache
    const cacheKey = `aging:${businessId}:${dateParam || 'today'}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.success(cached.data);
    }
    
    // CRITICAL: Use IST for all date calculations
    const nowIST = getNowIST();
    
    // Get all unpaid bills
    const bills = await Bill.find({
      userId,
      isDeleted: {$ne: true},
      status: {$in: ['unpaid', 'partial']},
      dueDate: {$exists: true, $ne: null},
    }).populate('customerId', 'name phone isDeleted').lean();
    
    // Compute aging per customer
    const customerAging = {};
    const totals = {
      b0_7: 0,
      b8_15: 0,
      b16_30: 0,
      b31_60: 0,
      b60p: 0,
    };
    
    for (const bill of bills) {
      if (!bill.customerId || bill.customerId.isDeleted) continue;
      
      const customerId = bill.customerId._id.toString();
      const unpaidAmount = bill.grandTotal - (bill.paidAmount || 0);
      
      if (unpaidAmount <= 0) continue;
      
      // CRITICAL: Use IST-aware overdue calculation
      const overdueDays = getDaysOverdueIST(bill.dueDate);
      
      if (overdueDays === 0) continue; // Not overdue yet
      
      // Initialize customer bucket
      if (!customerAging[customerId]) {
        customerAging[customerId] = {
          customerId: bill.customerId._id,
          customerName: bill.customerId.name,
          b0_7: 0,
          b8_15: 0,
          b16_30: 0,
          b31_60: 0,
          b60p: 0,
          totalOverdue: 0,
          worstBucket: 0,
          maxOverdueDays: 0,
        };
      }
      
      // Add to appropriate bucket
      if (overdueDays <= 7) {
        customerAging[customerId].b0_7 += unpaidAmount;
        totals.b0_7 += unpaidAmount;
        customerAging[customerId].worstBucket = Math.max(customerAging[customerId].worstBucket, 1);
      } else if (overdueDays <= 15) {
        customerAging[customerId].b8_15 += unpaidAmount;
        totals.b8_15 += unpaidAmount;
        customerAging[customerId].worstBucket = Math.max(customerAging[customerId].worstBucket, 2);
      } else if (overdueDays <= 30) {
        customerAging[customerId].b16_30 += unpaidAmount;
        totals.b16_30 += unpaidAmount;
        customerAging[customerId].worstBucket = Math.max(customerAging[customerId].worstBucket, 3);
      } else if (overdueDays <= 60) {
        customerAging[customerId].b31_60 += unpaidAmount;
        totals.b31_60 += unpaidAmount;
        customerAging[customerId].worstBucket = Math.max(customerAging[customerId].worstBucket, 4);
      } else {
        customerAging[customerId].b60p += unpaidAmount;
        totals.b60p += unpaidAmount;
        customerAging[customerId].worstBucket = 5;
      }
      
      customerAging[customerId].totalOverdue += unpaidAmount;
      customerAging[customerId].maxOverdueDays = Math.max(customerAging[customerId].maxOverdueDays, overdueDays);
    }
    
    // Convert to array and sort by totalOverdue desc
    const customers = Object.values(customerAging)
      .sort((a, b) => b.totalOverdue - a.totalOverdue)
      .slice(0, 50); // Top 50
    
    const result = {
      date: targetDate.toISOString().split('T')[0],
      totals,
      customers,
      customerCount: Object.keys(customerAging).length,
      meta: {
        computedAt: new Date().toISOString(),
        sources: ['Bills'],
        requestId: req.requestId,
      },
    };
    
    // Cache result
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });
    
    res.success(result);
  } catch (error) {
    logger.error('[Insights] Aging computation failed', error);
    
    // Log reliability event
    await ReliabilityEvent.create({
      requestId: req.requestId,
      at: new Date(),
      layer: 'backend',
      kind: 'ENGINE_FAIL',
      route: req.path,
      method: req.method,
      userId,
      businessId,
      entityType: 'INSIGHTS',
      code: 'AGING_COMPUTATION_FAILED',
      message: error.message,
      details: {stack: error.stack},
      retryable: true,
      status: 500,
    });
    
    throw error;
  }
});

/**
 * Get cash-in forecast
 * GET /api/v1/insights/forecast?date=YYYY-MM-DD
 */
const getCashInForecast = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const dateParam = req.query.date;
  
  try {
    // Check cache
    const cacheKey = `forecast:${businessId}:${dateParam || 'today'}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.success(cached.data);
    }
    
    const targetDate = dateParam ? new Date(dateParam) : new Date();
    const now = new Date();
    
    // Horizons
    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);
    
    const in30Days = new Date(now);
    in30Days.setDate(in30Days.getDate() + 30);
    
    // 1. Promise forecast
    const promisesIn7d = await RecoveryCase.find({
      userId,
      promiseAt: {$gte: now, $lte: in7Days},
      status: {$in: ['open', 'promised', 'active']},
      promiseAmount: {$gt: 0},
    }).lean();
    
    const promisesIn30d = await RecoveryCase.find({
      userId,
      promiseAt: {$gte: now, $lte: in30Days},
      status: {$in: ['open', 'promised', 'active']},
      promiseAmount: {$gt: 0},
    }).lean();
    
    const promises7d = promisesIn7d.reduce((sum, p) => sum + (p.promiseAmount || 0), 0);
    const promises30d = promisesIn30d.reduce((sum, p) => sum + (p.promiseAmount || 0), 0);
    
    // 2. Follow-up forecast (weighted)
    const followupsIn7d = await FollowUpTask.find({
      userId,
      isDeleted: {$ne: true},
      status: 'pending',
      dueAt: {$gte: now, $lte: in7Days},
    }).lean();
    
    const followupsIn30d = await FollowUpTask.find({
      userId,
      isDeleted: {$ne: true},
      status: 'pending',
      dueAt: {$gte: now, $lte: in30Days},
    }).lean();
    
    // Weights: FOLLOWUP=0.2, OVERDUE context in task, promises already counted
    const getFollowupWeight = (task) => {
      // If task is for promise, don't double count
      if (task.source && task.source.includes('PROMISE')) return 0;
      return 0.20; // Default followup weight
    };
    
    const followups7d = followupsIn7d.reduce((sum, f) => sum + (f.balance || 0) * getFollowupWeight(f), 0);
    const followups30d = followupsIn30d.reduce((sum, f) => sum + (f.balance || 0) * getFollowupWeight(f), 0);
    
    // 3. Historical velocity (best-effort)
    let velocity7d = 0;
    let velocity30d = 0;
    
    try {
      // Get payments in last 30 days
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentPayments = await LedgerTransaction.find({
        userId,
        type: 'debit', // Payments
        createdAt: {$gte: thirtyDaysAgo},
      }).lean();
      
      const totalCollected = recentPayments.reduce((sum, t) => sum + (t.amount || 0), 0);
      
      // Get overdue within horizons
      const overdueIn7d = await Bill.find({
        userId,
        isDeleted: {$ne: true},
        status: {$in: ['unpaid', 'partial']},
        dueDate: {$lt: now, $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)},
      }).lean();
      
      const overdueIn30d = await Bill.find({
        userId,
        isDeleted: {$ne: true},
        status: {$in: ['unpaid', 'partial']},
        dueDate: {$lt: now, $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)},
      }).lean();
      
      const overdueAmount7d = overdueIn7d.reduce((sum, b) => sum + (b.grandTotal - (b.paidAmount || 0)), 0);
      const overdueAmount30d = overdueIn30d.reduce((sum, b) => sum + (b.grandTotal - (b.paidAmount || 0)), 0);
      
      // Collection rate (conservative)
      if (totalCollected > 0 && overdueAmount30d > 0) {
        const collectionRate = totalCollected / overdueAmount30d;
        velocity7d = overdueAmount7d * collectionRate * 0.1; // Conservative 10% factor
        velocity30d = overdueAmount30d * collectionRate * 0.1;
      }
    } catch (velocityError) {
      logger.warn('[Insights] Velocity calculation failed, using 0', velocityError);
    }
    
    const result = {
      date: targetDate.toISOString().split('T')[0],
      forecast7: {
        promises: Math.round(promises7d),
        followups: Math.round(followups7d),
        velocityAdj: Math.round(velocity7d),
        total: Math.round(promises7d + followups7d + velocity7d),
      },
      forecast30: {
        promises: Math.round(promises30d),
        followups: Math.round(followups30d),
        velocityAdj: Math.round(velocity30d),
        total: Math.round(promises30d + followups30d + velocity30d),
      },
      assumptions: {
        followupWeights: {
          default: 0.20,
          promiseRelated: 0.0,
        },
        velocityWindowDays: 30,
        velocityFactor: 0.1,
      },
      meta: {
        computedAt: new Date().toISOString(),
        sources: ['Promises', 'FollowUps', 'Bills', 'LedgerTransactions'],
        requestId: req.requestId,
      },
    };
    
    // Cache result
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });
    
    res.success(result);
  } catch (error) {
    logger.error('[Insights] Forecast computation failed', error);
    
    // Log reliability event
    await ReliabilityEvent.create({
      requestId: req.requestId,
      at: new Date(),
      layer: 'backend',
      kind: 'ENGINE_FAIL',
      route: req.path,
      method: req.method,
      userId,
      businessId,
      entityType: 'INSIGHTS',
      code: 'FORECAST_COMPUTATION_FAILED',
      message: error.message,
      details: {stack: error.stack},
      retryable: true,
      status: 500,
    });
    
    throw error;
  }
});

/**
 * Get defaulter risk list
 * GET /api/v1/insights/defaulters?date=YYYY-MM-DD&limit=20
 */
const getDefaulterRiskList = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const dateParam = req.query.date;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  
  try {
    // Check cache
    const cacheKey = `defaulters:${businessId}:${dateParam || 'today'}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.success(cached.data);
    }
    
    const now = new Date();
    
    // Get all customers with overdue amounts
    const bills = await Bill.find({
      userId,
      isDeleted: {$ne: true},
      status: {$in: ['unpaid', 'partial']},
      dueDate: {$lt: now},
    }).populate('customerId', 'name phone isDeleted').lean();
    
    // Get recovery cases
    const recoveryCases = await RecoveryCase.find({
      userId,
      status: {$in: ['open', 'promised', 'active']},
    }).lean();
    
    // Get notification attempts (last 90 days)
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    // Compute per customer
    const customerRisks = {};
    
    // Process bills
    for (const bill of bills) {
      if (!bill.customerId || bill.customerId.isDeleted) continue;
      
      const customerId = bill.customerId._id.toString();
      const unpaidAmount = bill.grandTotal - (bill.paidAmount || 0);
      
      if (unpaidAmount <= 0) continue;
      
      if (!customerRisks[customerId]) {
        customerRisks[customerId] = {
          customerId: bill.customerId._id,
          customerName: bill.customerId.name,
          overdueAmount: 0,
          overdueDaysMax: 0,
          brokenPromisesCount: 0,
          lastPaymentDaysAgo: null,
          failedAttempts: 0,
          totalAttempts: 0,
          reasons: [],
        };
      }
      
      const dueDate = new Date(bill.dueDate);
      const overdueDays = Math.floor((now - dueDate) / (24 * 60 * 60 * 1000));
      
      customerRisks[customerId].overdueAmount += unpaidAmount;
      customerRisks[customerId].overdueDaysMax = Math.max(customerRisks[customerId].overdueDaysMax, overdueDays);
    }
    
    // Process recovery cases for broken promises
    const ninetyDaysAgoMs = ninetyDaysAgo.getTime();
    for (const rcase of recoveryCases) {
      const customerId = rcase.customerId.toString();
      if (!customerRisks[customerId]) continue;
      
      // Count broken promises in last 90 days
      if (rcase.brokenPromisesCount) {
        customerRisks[customerId].brokenPromisesCount += rcase.brokenPromisesCount;
      }
      
      // Check if current promise is broken
      if (rcase.promiseAt && rcase.promiseStatus === 'OVERDUE') {
        const promiseDate = new Date(rcase.promiseAt);
        if (promiseDate.getTime() >= ninetyDaysAgoMs) {
          customerRisks[customerId].brokenPromisesCount += 1;
        }
      }
    }
    
    // Compute last payment (best-effort)
    try {
      const customerIds = Object.keys(customerRisks).map(id => id);
      const recentPayments = await LedgerTransaction.aggregate([
        {
          $match: {
            userId,
            customerId: {$in: customerIds.map(id => require('mongoose').Types.ObjectId(id))},
            type: 'debit',
          },
        },
        {
          $sort: {createdAt: -1},
        },
        {
          $group: {
            _id: '$customerId',
            lastPayment: {$first: '$createdAt'},
          },
        },
      ]);
      
      for (const payment of recentPayments) {
        const customerId = payment._id.toString();
        if (customerRisks[customerId]) {
          const daysSince = Math.floor((now - new Date(payment.lastPayment)) / (24 * 60 * 60 * 1000));
          customerRisks[customerId].lastPaymentDaysAgo = daysSince;
        }
      }
    } catch (paymentError) {
      logger.warn('[Insights] Last payment calculation failed', paymentError);
    }
    
    // Compute risk scores
    const defaulters = [];
    const medianOverdue = 5000; // Business median, hardcoded for now
    
    for (const customerId in customerRisks) {
      const customer = customerRisks[customerId];
      let score = 0;
      const reasons = [];
      
      // +30 if overdueAmount > median
      if (customer.overdueAmount > medianOverdue) {
        score += 30;
        reasons.push(`High overdue amount (₹${Math.round(customer.overdueAmount).toLocaleString('en-IN')})`);
      }
      
      // +20 if overdueDaysMax >= 30
      if (customer.overdueDaysMax >= 30) {
        score += 20;
        reasons.push(`${customer.overdueDaysMax}+ days overdue`);
      }
      
      // +20 if brokenPromisesCount >= 2
      if (customer.brokenPromisesCount >= 2) {
        score += 20;
        reasons.push(`${customer.brokenPromisesCount} broken promises`);
      }
      
      // +15 if no payment in 60 days
      if (customer.lastPaymentDaysAgo !== null && customer.lastPaymentDaysAgo >= 60) {
        score += 15;
        reasons.push(`No payment ${customer.lastPaymentDaysAgo}+ days`);
      }
      
      // Cap at 100
      score = Math.min(score, 100);
      
      if (score > 0) {
        defaulters.push({
          customerId: customer.customerId,
          customerName: customer.customerName,
          score,
          overdueAmount: Math.round(customer.overdueAmount),
          overdueDaysMax: customer.overdueDaysMax,
          brokenPromisesCount: customer.brokenPromisesCount,
          lastPaymentDaysAgo: customer.lastPaymentDaysAgo,
          reasons,
        });
      }
    }
    
    // Sort by score desc
    defaulters.sort((a, b) => b.score - a.score);
    
    const result = {
      date: now.toISOString().split('T')[0],
      defaulters: defaulters.slice(0, limit),
      total: defaulters.length,
      returned: Math.min(defaulters.length, limit),
      scoringRules: {
        highOverdueAmount: {points: 30, threshold: medianOverdue},
        longOverdue: {points: 20, threshold: '30+ days'},
        brokenPromises: {points: 20, threshold: '2+'},
        noRecentPayment: {points: 15, threshold: '60+ days'},
      },
      meta: {
        computedAt: new Date().toISOString(),
        sources: ['Bills', 'Promises', 'LedgerTransactions'],
        requestId: req.requestId,
      },
    };
    
    // Cache result
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });
    
    res.success(result);
  } catch (error) {
    logger.error('[Insights] Defaulter computation failed', error);
    
    // Log reliability event
    await ReliabilityEvent.create({
      requestId: req.requestId,
      at: new Date(),
      layer: 'backend',
      kind: 'ENGINE_FAIL',
      route: req.path,
      method: req.method,
      userId,
      businessId,
      entityType: 'INSIGHTS',
      code: 'DEFAULTER_COMPUTATION_FAILED',
      message: error.message,
      details: {stack: error.stack},
      retryable: true,
      status: 500,
    });
    
    throw error;
  }
});

/**
 * Get business interest summary
 * GET /api/v1/insights/interest?date=YYYY-MM-DD&limit=50
 */
const getBusinessInterest = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const dateParam = req.query.date;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  
  try {
    // Check cache
    const cacheKey = `interest:${businessId}:${dateParam || 'today'}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.success(cached.data);
    }
    
    const targetDate = dateParam ? new Date(dateParam) : new Date();
    
    const interestService = require('../services/interest.service');
    const result = await interestService.computeBusinessInterest(userId, targetDate, limit);
    
    // Cache result
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });
    
    res.success(result);
  } catch (error) {
    logger.error('[Insights] Interest computation failed', error);
    
    // Log reliability event
    await ReliabilityEvent.create({
      requestId: req.requestId,
      at: new Date(),
      layer: 'backend',
      kind: 'ENGINE_FAIL',
      route: req.path,
      method: req.method,
      userId,
      businessId,
      entityType: 'INSIGHTS',
      code: 'INTEREST_COMPUTATION_FAILED',
      message: error.message,
      details: {stack: error.stack},
      retryable: true,
      status: 500,
    });
    
    throw error;
  }
});

/**
 * Get customer interest breakdown
 * GET /api/v1/customers/:id/interest?date=YYYY-MM-DD
 */
const getCustomerInterest = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  const customerId = req.params.id;
  const dateParam = req.query.date;
  
  try {
    const targetDate = dateParam ? new Date(dateParam) : new Date();
    
    const interestService = require('../services/interest.service');
    const result = await interestService.computeCustomerInterest(userId, customerId, targetDate);
    
    res.success(result);
  } catch (error) {
    logger.error('[Insights] Customer interest computation failed', error);
    throw error;
  }
});

/**
 * Get financial year summary
 * GET /api/v1/insights/financial-year?fyStart=YYYY-MM-DD&fyEnd=YYYY-MM-DD
 */
const getFinancialYearSummary = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const businessId = req.user.businessId || userId;
  
  try {
    const interestService = require('../services/interest.service');
    const BusinessSettings = require('../models/BusinessSettings');
    
    // Get settings
    const settings = await BusinessSettings.getOrCreate(userId, businessId);
    
    let fyStart, fyEnd;
    
    if (req.query.fyStart && req.query.fyEnd) {
      // Use provided dates
      fyStart = new Date(req.query.fyStart);
      fyEnd = new Date(req.query.fyEnd);
    } else {
      // Use current FY based on settings
      const currentFY = interestService.getCurrentFinancialYear(settings);
      fyStart = currentFY.fyStart;
      fyEnd = currentFY.fyEnd;
    }
    
    const result = await interestService.computeFinancialYearSummary(userId, fyStart, fyEnd);
    
    res.success(result);
  } catch (error) {
    logger.error('[Insights] FY summary computation failed', error);
    
    // Log reliability event
    await ReliabilityEvent.create({
      requestId: req.requestId,
      at: new Date(),
      layer: 'backend',
      kind: 'ENGINE_FAIL',
      route: req.path,
      method: req.method,
      userId,
      businessId,
      entityType: 'INSIGHTS',
      code: 'FY_SUMMARY_COMPUTATION_FAILED',
      message: error.message,
      details: {stack: error.stack},
      retryable: true,
      status: 500,
    });
    
    throw error;
  }
});

module.exports = {
  getAgingBuckets,
  getCashInForecast,
  getDefaulterRiskList,
  getBusinessInterest,
  getCustomerInterest,
  getFinancialYearSummary,
};
