/**
 * Aging Analytics Service
 * 
 * Compute aging buckets and recovery KPIs
 */
const Bill = require('../models/Bill');
const {
  getNowIST,
  getStartOfDayIST,
  getEndOfDayIST,
  diffDaysFromNowIST,
} = require('../utils/timezone.util');
const logger = require('../utils/logger');

/**
 * Compute aging buckets for unpaid bills
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Aging analytics
 */
const computeAgingAnalytics = async (userId) => {
  const nowIST = getNowIST();
  const todayStartIST = getStartOfDayIST(nowIST);
  const todayEndIST = getEndOfDayIST(nowIST);
  
  // Get all unpaid/partial bills
  const bills = await Bill.find({
    userId,
    isDeleted: {$ne: true},
    status: {$in: ['unpaid', 'partial']},
  });
  
  // Initialize buckets
  const buckets = {
    '0-7': {count: 0, amount: 0, label: '0-7 days'},
    '8-15': {count: 0, amount: 0, label: '8-15 days'},
    '16-30': {count: 0, amount: 0, label: '16-30 days'},
    '31-60': {count: 0, amount: 0, label: '31-60 days'},
    '61+': {count: 0, amount: 0, label: '61+ days'},
  };
  
  let totalPendingAmount = 0;
  let overdueCount = 0;
  let dueTodayCount = 0;
  let upcomingCount = 0;
  
  // Process each bill
  for (const bill of bills) {
    const pendingAmount = bill.grandTotal - (bill.paidAmount || 0);
    
    if (pendingAmount <= 0) continue;
    
    totalPendingAmount += pendingAmount;
    
    // Skip bills without due date
    if (!bill.dueDate) {
      upcomingCount++;
      continue;
    }
    
    const dueDate = new Date(bill.dueDate);
    
    // Check if due today
    if (dueDate >= todayStartIST && dueDate <= todayEndIST) {
      dueTodayCount++;
    }
    // Check if overdue
    else if (dueDate < todayStartIST) {
      overdueCount++;
    }
    // Otherwise upcoming
    else {
      upcomingCount++;
    }
    
    // Calculate days overdue/until due
    const daysFromNow = diffDaysFromNowIST(dueDate);
    const daysOverdue = -daysFromNow; // Negative means overdue
    
    // Bucket by days overdue (only for overdue bills)
    if (daysOverdue > 0) {
      if (daysOverdue <= 7) {
        buckets['0-7'].count++;
        buckets['0-7'].amount += pendingAmount;
      } else if (daysOverdue <= 15) {
        buckets['8-15'].count++;
        buckets['8-15'].amount += pendingAmount;
      } else if (daysOverdue <= 30) {
        buckets['16-30'].count++;
        buckets['16-30'].amount += pendingAmount;
      } else if (daysOverdue <= 60) {
        buckets['31-60'].count++;
        buckets['31-60'].amount += pendingAmount;
      } else {
        buckets['61+'].count++;
        buckets['61+'].amount += pendingAmount;
      }
    }
  }
  
  // Compute recovered this week (bills paid in last 7 days)
  const sevenDaysAgo = new Date(nowIST);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const paidBills = await Bill.find({
    userId,
    isDeleted: {$ne: true},
    status: 'paid',
    updatedAt: {$gte: sevenDaysAgo},
  });
  
  let recoveredThisWeekAmount = 0;
  for (const bill of paidBills) {
    recoveredThisWeekAmount += bill.grandTotal;
  }
  
  logger.info('[AgingAnalytics] Computed aging analytics', {
    userId,
    totalPendingAmount,
    overdueCount,
    dueTodayCount,
    upcomingCount,
    recoveredThisWeekAmount,
  });
  
  return {
    totalPendingAmount,
    buckets: [
      {key: '0-7', ...buckets['0-7']},
      {key: '8-15', ...buckets['8-15']},
      {key: '16-30', ...buckets['16-30']},
      {key: '31-60', ...buckets['31-60']},
      {key: '61+', ...buckets['61+']},
    ],
    overdueCount,
    dueTodayCount,
    upcomingCount,
    recoveredThisWeekAmount,
    computedAt: nowIST.toISOString(),
  };
};

module.exports = {
  computeAgingAnalytics,
};
