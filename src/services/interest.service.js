/**
 * Interest Service
 * 
 * Overlay interest computation (does not mutate bills)
 * Step 8: Interest Calculation + Financial Year
 */
const Bill = require('../models/Bill');
const BusinessSettings = require('../models/BusinessSettings');
const LedgerTransaction = require('../models/LedgerTransaction');
const logger = require('../utils/logger');

/**
 * Compute interest for a single bill
 * 
 * @param {Object} bill - Bill document
 * @param {Object} settings - BusinessSettings
 * @param {Date} asOfDate - Computation date
 * @returns {Object} { principal, interest, overdueDays, graceDays, effectiveDays }
 */
const computeBillInterest = (bill, settings, asOfDate = new Date()) => {
  // Return zero if interest disabled
  if (!settings.interestEnabled) {
    return {
      principal: 0,
      interest: 0,
      overdueDays: 0,
      graceDays: 0,
      effectiveDays: 0,
    };
  }
  
  // Skip if no due date or not overdue
  if (!bill.dueDate) {
    return {principal: 0, interest: 0, overdueDays: 0, graceDays: 0, effectiveDays: 0};
  }
  
  const dueDate = new Date(bill.dueDate);
  const now = asOfDate;
  
  // Calculate overdue days
  const overdueDays = Math.floor((now - dueDate) / (24 * 60 * 60 * 1000));
  
  // Not overdue yet
  if (overdueDays <= 0) {
    return {principal: 0, interest: 0, overdueDays: 0, graceDays: 0, effectiveDays: 0};
  }
  
  // Apply grace period
  const graceDays = settings.interestGraceDays || 0;
  const effectiveDays = Math.max(0, overdueDays - graceDays);
  
  // No interest if within grace
  if (effectiveDays <= 0) {
    return {principal: 0, interest: 0, overdueDays, graceDays, effectiveDays: 0};
  }
  
  // Calculate principal (unpaid amount)
  const principal = bill.grandTotal - (bill.paidAmount || 0);
  
  if (principal <= 0) {
    return {principal: 0, interest: 0, overdueDays, graceDays, effectiveDays};
  }
  
  // Calculate interest (DAILY_SIMPLE)
  const ratePctPerMonth = settings.interestRatePctPerMonth || 0;
  const dailyRate = (ratePctPerMonth / 100) / 30;
  
  let interest = principal * dailyRate * effectiveDays;
  
  // Apply cap
  const capPct = settings.interestCapPctOfPrincipal || 100;
  const maxInterest = principal * (capPct / 100);
  interest = Math.min(interest, maxInterest);
  
  // Apply rounding (NEAREST_RUPEE)
  interest = Math.round(interest);
  
  return {
    principal: Math.round(principal),
    interest,
    overdueDays,
    graceDays,
    effectiveDays,
  };
};

/**
 * Compute interest for a customer
 * 
 * @param {String} userId - User ID
 * @param {String} customerId - Customer ID
 * @param {Date} asOfDate - Computation date
 * @returns {Promise<Object>}
 */
const computeCustomerInterest = async (userId, customerId, asOfDate = new Date()) => {
  try {
    // Get settings
    const settings = await BusinessSettings.getOrCreate(userId);
    
    // Get overdue bills for customer
    const bills = await Bill.find({
      userId,
      customerId,
      isDeleted: {$ne: true},
      status: {$in: ['unpaid', 'partial']},
      dueDate: {$exists: true, $ne: null, $lt: asOfDate},
    })
      .populate('customerId', 'name phone')
      .lean();
    
    // Compute interest per bill
    const billInterests = [];
    let totalPrincipal = 0;
    let totalInterest = 0;
    let maxOverdueDays = 0;
    
    for (const bill of bills) {
      const result = computeBillInterest(bill, settings, asOfDate);
      
      if (result.principal > 0) {
        billInterests.push({
          billId: bill._id,
          billNo: bill.billNo,
          dueDate: bill.dueDate,
          principal: result.principal,
          interest: result.interest,
          overdueDays: result.overdueDays,
          effectiveDays: result.effectiveDays,
        });
        
        totalPrincipal += result.principal;
        totalInterest += result.interest;
        maxOverdueDays = Math.max(maxOverdueDays, result.overdueDays);
      }
    }
    
    // Sort by interest desc
    billInterests.sort((a, b) => b.interest - a.interest);
    
    return {
      customerId,
      customerName: bills[0]?.customerId?.name || 'Unknown',
      totalPrincipal: Math.round(totalPrincipal),
      totalInterest: Math.round(totalInterest),
      billCount: billInterests.length,
      maxOverdueDays,
      bills: billInterests.slice(0, 20), // Top 20
      settings: {
        enabled: settings.interestEnabled,
        ratePctPerMonth: settings.interestRatePctPerMonth,
        graceDays: settings.interestGraceDays,
        basis: settings.interestBasis,
        rounding: settings.interestRounding,
        capPct: settings.interestCapPctOfPrincipal,
      },
      computedAt: asOfDate.toISOString(),
    };
  } catch (error) {
    logger.error('[Interest] Customer computation failed', error);
    throw error;
  }
};

/**
 * Compute interest for business (all customers)
 * 
 * @param {String} userId - User ID
 * @param {Date} asOfDate - Computation date
 * @param {Number} limit - Max customers to return
 * @returns {Promise<Object>}
 */
const computeBusinessInterest = async (userId, asOfDate = new Date(), limit = 50) => {
  try {
    // Get settings
    const settings = await BusinessSettings.getOrCreate(userId);
    
    // Get all overdue bills
    const bills = await Bill.find({
      userId,
      isDeleted: {$ne: true},
      status: {$in: ['unpaid', 'partial']},
      dueDate: {$exists: true, $ne: null, $lt: asOfDate},
    })
      .populate('customerId', 'name phone isDeleted')
      .lean();
    
    // Group by customer
    const customerInterests = {};
    
    for (const bill of bills) {
      if (!bill.customerId || bill.customerId.isDeleted) continue;
      
      const customerId = bill.customerId._id.toString();
      const result = computeBillInterest(bill, settings, asOfDate);
      
      if (result.principal > 0) {
        if (!customerInterests[customerId]) {
          customerInterests[customerId] = {
            customerId: bill.customerId._id,
            customerName: bill.customerId.name,
            totalPrincipal: 0,
            totalInterest: 0,
            billCount: 0,
            maxOverdueDays: 0,
          };
        }
        
        customerInterests[customerId].totalPrincipal += result.principal;
        customerInterests[customerId].totalInterest += result.interest;
        customerInterests[customerId].billCount += 1;
        customerInterests[customerId].maxOverdueDays = Math.max(
          customerInterests[customerId].maxOverdueDays,
          result.overdueDays
        );
      }
    }
    
    // Compute business totals
    let businessTotalPrincipal = 0;
    let businessTotalInterest = 0;
    
    for (const customerId in customerInterests) {
      businessTotalPrincipal += customerInterests[customerId].totalPrincipal;
      businessTotalInterest += customerInterests[customerId].totalInterest;
    }
    
    // Convert to array and sort by interest desc
    const customers = Object.values(customerInterests)
      .map(c => ({
        ...c,
        totalPrincipal: Math.round(c.totalPrincipal),
        totalInterest: Math.round(c.totalInterest),
      }))
      .sort((a, b) => b.totalInterest - a.totalInterest)
      .slice(0, limit);
    
    return {
      date: asOfDate.toISOString().split('T')[0],
      totals: {
        principal: Math.round(businessTotalPrincipal),
        interest: Math.round(businessTotalInterest),
        customerCount: Object.keys(customerInterests).length,
        billCount: bills.length,
      },
      customers,
      settings: {
        enabled: settings.interestEnabled,
        ratePctPerMonth: settings.interestRatePctPerMonth,
        graceDays: settings.interestGraceDays,
        basis: settings.interestBasis,
        rounding: settings.interestRounding,
        capPct: settings.interestCapPctOfPrincipal,
      },
      computedAt: asOfDate.toISOString(),
    };
  } catch (error) {
    logger.error('[Interest] Business computation failed', error);
    throw error;
  }
};

/**
 * Compute financial year summary
 * 
 * @param {String} userId - User ID
 * @param {Date} fyStart - FY start date
 * @param {Date} fyEnd - FY end date or asOfDate
 * @returns {Promise<Object>}
 */
const computeFinancialYearSummary = async (userId, fyStart, fyEnd) => {
  try {
    const settings = await BusinessSettings.getOrCreate(userId);
    
    // Opening (bills created before FY start that remain unpaid)
    const openingBills = await Bill.find({
      userId,
      isDeleted: {$ne: true},
      status: {$in: ['unpaid', 'partial']},
      createdAt: {$lt: fyStart},
    }).lean();
    
    let openingReceivable = 0;
    let openingOverdue = 0;
    let openingInterest = 0;
    
    for (const bill of openingBills) {
      const unpaid = bill.grandTotal - (bill.paidAmount || 0);
      openingReceivable += unpaid;
      
      // Check if overdue at FY start
      if (bill.dueDate && new Date(bill.dueDate) < fyStart) {
        openingOverdue += unpaid;
        
        // Compute interest at FY start
        const result = computeBillInterest(bill, settings, fyStart);
        openingInterest += result.interest;
      }
    }
    
    // Closing (current state)
    const closingBills = await Bill.find({
      userId,
      isDeleted: {$ne: true},
      status: {$in: ['unpaid', 'partial']},
    }).lean();
    
    let closingReceivable = 0;
    let closingOverdue = 0;
    let closingInterest = 0;
    
    for (const bill of closingBills) {
      const unpaid = bill.grandTotal - (bill.paidAmount || 0);
      closingReceivable += unpaid;
      
      // Check if overdue now
      if (bill.dueDate && new Date(bill.dueDate) < fyEnd) {
        closingOverdue += unpaid;
        
        // Compute interest now
        const result = computeBillInterest(bill, settings, fyEnd);
        closingInterest += result.interest;
      }
    }
    
    // Collections during FY (best-effort)
    let collectionsDuringFY = null;
    
    try {
      const payments = await LedgerTransaction.find({
        userId,
        type: 'debit', // Payments
        createdAt: {$gte: fyStart, $lte: fyEnd},
      }).lean();
      
      collectionsDuringFY = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    } catch (error) {
      logger.warn('[Interest] Collections calculation failed', error);
      collectionsDuringFY = null;
    }
    
    return {
      financialYear: {
        start: fyStart.toISOString().split('T')[0],
        end: fyEnd.toISOString().split('T')[0],
      },
      opening: {
        receivableOutstanding: Math.round(openingReceivable),
        overdueAmount: Math.round(openingOverdue),
        interestAccrued: Math.round(openingInterest),
      },
      closing: {
        receivableOutstanding: Math.round(closingReceivable),
        overdueAmount: Math.round(closingOverdue),
        interestAccrued: Math.round(closingInterest),
      },
      collections: collectionsDuringFY !== null ? Math.round(collectionsDuringFY) : null,
      assumptions: {
        openingMethod: 'Bills created before FY start, unpaid as of now',
        closingMethod: 'All unpaid bills as of closing date',
        collectionsSource: collectionsDuringFY !== null ? 'LedgerTransaction (debit)' : 'Insufficient data',
        interestBasis: settings.interestBasis,
        interestEnabled: settings.interestEnabled,
      },
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('[Interest] FY summary computation failed', error);
    throw error;
  }
};

/**
 * Get current financial year dates based on settings
 * 
 * @param {Object} settings - BusinessSettings
 * @param {Date} asOfDate - Reference date
 * @returns {Object} { fyStart, fyEnd }
 */
const getCurrentFinancialYear = (settings, asOfDate = new Date()) => {
  const fyStartMonth = settings.financialYearStartMonth || 4; // April default
  const currentYear = asOfDate.getFullYear();
  const currentMonth = asOfDate.getMonth() + 1; // 1-12
  
  let fyStartYear, fyEndYear;
  
  if (currentMonth >= fyStartMonth) {
    // In current FY
    fyStartYear = currentYear;
    fyEndYear = currentYear + 1;
  } else {
    // In previous FY
    fyStartYear = currentYear - 1;
    fyEndYear = currentYear;
  }
  
  const fyStart = new Date(fyStartYear, fyStartMonth - 1, 1, 0, 0, 0, 0);
  const fyEnd = new Date(fyEndYear, fyStartMonth - 1, 0, 23, 59, 59, 999); // Last day of previous month
  
  return {fyStart, fyEnd};
};

module.exports = {
  computeBillInterest,
  computeCustomerInterest,
  computeBusinessInterest,
  computeFinancialYearSummary,
  getCurrentFinancialYear,
};
