/**
 * Pro Plans Configuration - Single Source of Truth
 * 
 * All amounts are in paise (INR smallest unit).
 * 1 Rupee = 100 paise
 * 
 * Edit amounts here to change pricing across the entire system.
 */

const PLANS = {
  monthly: {
    planId: 'monthly',
    label: 'Monthly',
    amountPaise: 29900, // ₹299
    currency: 'INR',
    durationDays: 30,
    displayPrice: '₹299',
    displayPeriod: 'month',
    savings: null,
  },
  quarterly: {
    planId: 'quarterly',
    label: 'Quarterly',
    amountPaise: 79900, // ₹799 (saves ₹98 vs 3x monthly)
    currency: 'INR',
    durationDays: 90,
    displayPrice: '₹799',
    displayPeriod: '3 months',
    savings: '₹98',
  },
  yearly: {
    planId: 'yearly',
    label: 'Yearly',
    amountPaise: 299900, // ₹2999 (saves ₹589 vs 12x monthly)
    currency: 'INR',
    durationDays: 365,
    displayPrice: '₹2999',
    displayPeriod: 'year',
    savings: '₹589',
  },
};

/**
 * Get all plans as array
 */
const getAllPlans = () => {
  return Object.values(PLANS);
};

/**
 * Get plan by ID
 */
const getPlanById = (planId) => {
  return PLANS[planId] || null;
};

/**
 * Validate plan ID
 */
const isValidPlanId = (planId) => {
  return PLANS.hasOwnProperty(planId);
};

module.exports = {
  PLANS,
  getAllPlans,
  getPlanById,
  isValidPlanId,
};
