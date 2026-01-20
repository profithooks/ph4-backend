/**
 * Entitlement Middleware
 * 
 * Check plan limits and feature access
 * Step 11: Fairness & Support
 */
const BusinessSettings = require('../models/BusinessSettings');
const logger = require('../utils/logger');

/**
 * Check if premium insights are enabled for business
 * 
 * @param {Object} req - Express request
 * @returns {Promise<Boolean>}
 */
const checkPremiumInsights = async (req) => {
  try {
    const userId = req.user._id;
    const businessId = req.user.businessId || userId;
    
    const settings = await BusinessSettings.findOne({userId: businessId});
    
    if (!settings) {
      return false;
    }
    
    return settings.premiumInsightsEnabled === true;
  } catch (error) {
    logger.error('[Entitlement] Check premium insights failed', error);
    return false;
  }
};

/**
 * Get customer cap for insights
 * 
 * @param {Object} req - Express request
 * @returns {Promise<Number>}
 */
const getInsightsCustomerCap = async (req) => {
  try {
    const userId = req.user._id;
    const businessId = req.user.businessId || userId;
    
    const settings = await BusinessSettings.findOne({userId: businessId});
    
    if (!settings) {
      return 50; // Default FREE cap
    }
    
    if (settings.premiumInsightsEnabled) {
      return Infinity; // PRO = unlimited
    }
    
    return settings.premiumInsightsCustomerCap || 50;
  } catch (error) {
    logger.error('[Entitlement] Get customer cap failed', error);
    return 50;
  }
};

/**
 * Middleware to require premium insights
 * Returns error if not entitled
 */
const requirePremiumInsights = async (req, res, next) => {
  try {
    const hasPremium = await checkPremiumInsights(req);
    
    if (!hasPremium) {
      return res.status(403).json({
        ok: false,
        requestId: req.requestId,
        error: {
          code: 'PLAN_LIMIT',
          message: 'This feature requires a Pro plan. Business-level summaries remain available.',
          retryable: false,
          details: {
            feature: 'Premium Insights',
            currentPlan: 'FREE',
            requiredPlan: 'PRO',
          },
        },
      });
    }
    
    next();
  } catch (error) {
    logger.error('[Entitlement] Middleware error', error);
    next(error);
  }
};

/**
 * Apply customer cap to insights results
 * Used in controllers to limit customer lists
 */
const applyInsightsCap = async (req, customers) => {
  try {
    const cap = await getInsightsCustomerCap(req);
    
    if (cap === Infinity || customers.length <= cap) {
      return {
        customers,
        capped: false,
      };
    }
    
    return {
      customers: customers.slice(0, cap),
      capped: true,
      cap,
      total: customers.length,
      upgrade: {
        message: 'Upgrade to Pro to see all customers',
        feature: 'Full Customer Insights',
      },
    };
  } catch (error) {
    logger.error('[Entitlement] Apply cap failed', error);
    return {
      customers,
      capped: false,
    };
  }
};

module.exports = {
  checkPremiumInsights,
  getInsightsCustomerCap,
  requirePremiumInsights,
  applyInsightsCap,
};
