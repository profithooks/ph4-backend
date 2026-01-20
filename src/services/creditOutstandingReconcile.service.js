/**
 * Credit Outstanding Reconciliation Service
 * 
 * PURPOSE: Prevent drift between Customer.creditOutstanding and actual bills
 * 
 * WHEN TO USE:
 * - Periodic background job (daily/weekly)
 * - After data migrations
 * - When investigating credit limit issues
 * - As part of integrity checks
 * 
 * RECONCILIATION ALGORITHM:
 * 1. Compute actual outstanding from Bills (source of truth)
 * 2. Compare with stored Customer.creditOutstanding
 * 3. Log mismatch as audit event if delta > 0
 * 4. Auto-fix if requested (atomic update)
 */

const Bill = require('../models/Bill');
const Customer = require('../models/Customer');
const {createAuditEvent} = require('./creditControl.service');
const logger = require('../utils/logger');

/**
 * Compute actual outstanding from Bills for a customer
 * 
 * SOURCE OF TRUTH: Bills collection
 * Outstanding = Sum of (grandTotal - paidAmount) for all non-cancelled, non-deleted bills
 * 
 * @param {string} userId - User ID
 * @param {string} customerId - Customer ID
 * @returns {Promise<number>} Actual outstanding amount
 */
async function computeOutstandingFromBills(userId, customerId) {
  try {
    const bills = await Bill.find({
      userId,
      customerId,
      status: {$ne: 'cancelled'}, // Exclude cancelled bills
      isDeleted: {$ne: true}, // Exclude soft-deleted bills
    }).lean();
    
    let actualOutstanding = 0;
    
    for (const bill of bills) {
      const unpaid = Math.max(0, bill.grandTotal - (bill.paidAmount || 0));
      actualOutstanding += unpaid;
    }
    
    // Round to 2 decimal places to avoid floating point issues
    actualOutstanding = Math.round(actualOutstanding * 100) / 100;
    
    return actualOutstanding;
  } catch (error) {
    logger.error('[CreditReconcile] Failed to compute outstanding from bills', error, {
      userId,
      customerId,
    });
    throw error;
  }
}

/**
 * Reconcile customer outstanding (compare stored vs actual)
 * 
 * RECONCILIATION FLOW:
 * 1. Load stored Customer.creditOutstanding
 * 2. Compute actual outstanding from Bills
 * 3. Compare and detect drift
 * 4. If mismatch: log CREDIT_OUTSTANDING_MISMATCH audit event
 * 5. If autoFix: atomically update to actual + log CREDIT_OUTSTANDING_RECONCILED
 * 
 * @param {string} userId - User ID
 * @param {string} customerId - Customer ID
 * @param {Object} options
 * @param {boolean} options.autoFix - Whether to fix mismatch automatically
 * @param {string} options.actorUserId - User ID of actor (for audit)
 * @param {string} options.requestId - Request ID (for audit)
 * @returns {Promise<Object>} { stored, actual, delta, fixed, customer }
 */
async function reconcileCustomerOutstanding(userId, customerId, options = {}) {
  const {autoFix = false, actorUserId = null, requestId = null} = options;
  
  try {
    // Load customer
    const customer = await Customer.findOne({_id: customerId, userId});
    
    if (!customer) {
      throw new Error('Customer not found');
    }
    
    // Get stored outstanding
    const storedOutstanding = customer.creditOutstanding || 0;
    
    // Compute actual outstanding from bills
    const actualOutstanding = await computeOutstandingFromBills(userId, customerId);
    
    // Compute delta
    const delta = Math.round((storedOutstanding - actualOutstanding) * 100) / 100;
    const absDelta = Math.abs(delta);
    
    // Check if drift exists (tolerance: ₹0.01 for floating point issues)
    const hasDrift = absDelta > 0.01;
    
    if (!hasDrift) {
      // No drift - all good!
      logger.debug('[CreditReconcile] No drift detected', {
        customerId,
        storedOutstanding,
        actualOutstanding,
      });
      
      return {
        stored: storedOutstanding,
        actual: actualOutstanding,
        delta: 0,
        fixed: false,
        hasDrift: false,
        customer,
      };
    }
    
    // DRIFT DETECTED!
    logger.warn('[CreditReconcile] DRIFT DETECTED', {
      customerId,
      storedOutstanding,
      actualOutstanding,
      delta,
      absDelta,
    });
    
    // Audit: CREDIT_OUTSTANDING_MISMATCH
    await createAuditEvent({
      action: 'CREDIT_OUTSTANDING_MISMATCH',
      userId: actorUserId || userId,
      actorRole: actorUserId ? 'OWNER' : 'SYSTEM',
      entityType: 'CUSTOMER',
      entityId: customerId,
      metadata: {
        storedOutstanding,
        actualOutstanding,
        delta,
        absDelta,
        autoFixRequested: autoFix,
      },
      requestId: requestId || 'reconcile',
    });
    
    let fixed = false;
    let updatedCustomer = customer;
    
    if (autoFix) {
      // ATOMIC FIX: Update customer.creditOutstanding to actual
      updatedCustomer = await Customer.findOneAndUpdate(
        {_id: customerId, userId},
        {$set: {creditOutstanding: actualOutstanding}},
        {new: true}
      );
      
      if (!updatedCustomer) {
        throw new Error('Failed to update customer outstanding');
      }
      
      fixed = true;
      
      // Audit: CREDIT_OUTSTANDING_RECONCILED
      await createAuditEvent({
        action: 'CREDIT_OUTSTANDING_RECONCILED',
        userId: actorUserId || userId,
        actorRole: actorUserId ? 'OWNER' : 'SYSTEM',
        entityType: 'CUSTOMER',
        entityId: customerId,
        metadata: {
          before: storedOutstanding,
          after: actualOutstanding,
          delta,
          correction: -delta, // Negative delta because we're fixing it
        },
        requestId: requestId || 'reconcile',
      });
      
      logger.info('[CreditReconcile] Outstanding FIXED', {
        customerId,
        before: storedOutstanding,
        after: actualOutstanding,
        delta,
      });
    }
    
    return {
      stored: storedOutstanding,
      actual: actualOutstanding,
      delta,
      fixed,
      hasDrift: true,
      customer: updatedCustomer,
    };
  } catch (error) {
    logger.error('[CreditReconcile] Reconciliation failed', error, {
      userId,
      customerId,
    });
    throw error;
  }
}

/**
 * Reconcile ALL customers for a business (batch reconciliation)
 * 
 * @param {string} userId - User ID
 * @param {Object} options
 * @param {boolean} options.autoFix - Whether to fix mismatches
 * @param {string} options.actorUserId - Actor user ID
 * @param {string} options.requestId - Request ID
 * @returns {Promise<Object>} { total, drifted, fixed, results }
 */
async function reconcileAllCustomers(userId, options = {}) {
  const {autoFix = false, actorUserId = null, requestId = null} = options;
  
  try {
    // Get all customers for this user
    const customers = await Customer.find({userId, isDeleted: {$ne: true}}).lean();
    
    logger.info('[CreditReconcile] Starting batch reconciliation', {
      userId,
      totalCustomers: customers.length,
      autoFix,
    });
    
    const results = [];
    let driftedCount = 0;
    let fixedCount = 0;
    
    for (const customer of customers) {
      try {
        const result = await reconcileCustomerOutstanding(userId, customer._id, {
          autoFix,
          actorUserId,
          requestId,
        });
        
        results.push({
          customerId: customer._id,
          customerName: customer.name,
          ...result,
        });
        
        if (result.hasDrift) {
          driftedCount++;
          if (result.fixed) {
            fixedCount++;
          }
        }
      } catch (error) {
        logger.error('[CreditReconcile] Failed to reconcile customer', error, {
          customerId: customer._id,
        });
        
        results.push({
          customerId: customer._id,
          customerName: customer.name,
          error: error.message,
        });
      }
    }
    
    logger.info('[CreditReconcile] Batch reconciliation complete', {
      userId,
      total: customers.length,
      drifted: driftedCount,
      fixed: fixedCount,
    });
    
    return {
      total: customers.length,
      drifted: driftedCount,
      fixed: fixedCount,
      results,
    };
  } catch (error) {
    logger.error('[CreditReconcile] Batch reconciliation failed', error, {
      userId,
    });
    throw error;
  }
}

module.exports = {
  computeOutstandingFromBills,
  reconcileCustomerOutstanding,
  reconcileAllCustomers,
};
