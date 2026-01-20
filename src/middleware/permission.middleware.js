/**
 * Permission Check Middleware
 * 
 * Enforces role-based access control
 * Step 5: Staff Accountability
 */
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Get user role from request
 * 
 * Priority:
 * 1. req.user.role (if set by auth middleware)
 * 2. Assume OWNER if no role specified (for backwards compatibility)
 */
function getUserRole(req) {
  if (req.user && req.user.role) {
    return req.user.role;
  }
  
  // Default to OWNER for backwards compatibility
  // In production, all users should have explicit roles
  return 'OWNER';
}

/**
 * Require owner role
 * 
 * Usage: router.delete('/bills/:id', requireOwner, deleteBill)
 */
const requireOwner = (req, res, next) => {
  const role = getUserRole(req);
  
  if (role !== 'OWNER' && role !== 'ADMIN') {
    logger.warn('[Permission] Owner-only action attempted by non-owner', {
      userId: req.user._id,
      role,
      path: req.path,
      method: req.method,
    });
    
    throw new AppError(
      'Only business owners can perform this action',
      403,
      'OWNER_ONLY',
      {
        requiredRole: 'OWNER',
        userRole: role,
      }
    );
  }
  
  next();
};

/**
 * Require staff or above
 * 
 * Usage: router.post('/bills', requireStaff, createBill)
 */
const requireStaff = (req, res, next) => {
  const role = getUserRole(req);
  
  const allowedRoles = ['OWNER', 'ADMIN', 'STAFF'];
  
  if (!allowedRoles.includes(role)) {
    logger.warn('[Permission] Staff-only action attempted by unauthorized user', {
      userId: req.user._id,
      role,
      path: req.path,
      method: req.method,
    });
    
    throw new AppError(
      'Insufficient permissions',
      403,
      'AUTH_ERROR',
      {
        requiredRole: 'STAFF',
        userRole: role,
      }
    );
  }
  
  next();
};

/**
 * Attach user role to request
 * Call this after auth middleware
 */
const attachRole = (req, res, next) => {
  // Store role for easy access
  req.userRole = getUserRole(req);
  next();
};

/**
 * Check if user is owner
 */
function isOwner(req) {
  const role = getUserRole(req);
  return role === 'OWNER' || role === 'ADMIN';
}

module.exports = {
  requireOwner,
  requireStaff,
  attachRole,
  getUserRole,
  isOwner,
};
