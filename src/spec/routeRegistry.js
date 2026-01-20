/**
 * Route Registry
 * 
 * Central registry of all routes and their spec mappings
 * Step 14: Control Spec Compliance Gate
 */

/**
 * Route registry
 * Each entry: { method, path, specCodes, description }
 */
const ROUTE_SPECS = [
  // P0: Reliability
  {method: 'GET', path: '/api/v1/diagnostics/reliability', specCodes: ['P0_REL_001'], description: 'Get reliability events'},
  {method: 'POST', path: '/api/v1/diagnostics/reliability', specCodes: ['P0_REL_001'], description: 'Create reliability event'},
  {method: 'GET', path: '/api/v1/diagnostics/sync', specCodes: ['P0_REL_002'], description: 'Get sync queue status'},
  {method: 'POST', path: '/api/v1/diagnostics/sync/retry', specCodes: ['P0_REL_002'], description: 'Retry failed sync operations'},
  {method: 'GET', path: '/api/v1/notifications', specCodes: ['P0_REL_003'], description: 'Get notifications inbox'},
  {method: 'GET', path: '/api/v1/notifications/:id', specCodes: ['P0_REL_003'], description: 'Get notification details'},
  {method: 'GET', path: '/api/v1/customers/:id/notifications', specCodes: ['P0_REL_003'], description: 'Get customer notifications'},

  // P1: Hard Control
  {method: 'PATCH', path: '/api/v1/customers/:id/credit-policy', specCodes: ['P1_CTRL_001'], description: 'Update credit policy'},
  {method: 'GET', path: '/api/v1/customers/:id/credit-policy', specCodes: ['P1_CTRL_001'], description: 'Get credit policy'},
  {method: 'POST', path: '/api/v1/bills', specCodes: ['P1_CTRL_002', 'P1_CTRL_003'], description: 'Create bill (with breach check + override)'},
  {method: 'GET', path: '/api/v1/audit', specCodes: ['P1_CTRL_004'], description: 'Get audit log'},
  {method: 'GET', path: '/api/v1/audit/:id', specCodes: ['P1_CTRL_004'], description: 'Get audit event'},
  {method: 'GET', path: '/api/v1/audit/stats', specCodes: ['P1_CTRL_004'], description: 'Get audit stats'},
  {method: 'GET', path: '/api/v1/customers/:id/audit', specCodes: ['P1_CTRL_004'], description: 'Get customer audit log'},
  {method: 'DELETE', path: '/api/v1/bills/:id', specCodes: ['P1_CTRL_004'], description: 'Delete bill (with audit)'},
  {method: 'DELETE', path: '/api/v1/customers/:id', specCodes: ['P1_CTRL_004'], description: 'Delete customer (with audit)'},

  // P1: Recovery Engine
  {method: 'GET', path: '/api/v1/today/summary', specCodes: ['P1_REC_002', 'P1_REC_003'], description: 'Get Today summary (chase + money-at-risk)'},
  {method: 'GET', path: '/api/v1/today/chase', specCodes: ['P1_REC_002'], description: 'Get daily chase list'},
  {method: 'POST', path: '/api/v1/customers/:id/promise', specCodes: ['P1_REC_004'], description: 'Create customer promise'},
  {method: 'GET', path: '/api/v1/customers/:id/promise', specCodes: ['P1_REC_004'], description: 'Get customer promise'},
  {method: 'PATCH', path: '/api/v1/promises/:id', specCodes: ['P1_REC_004'], description: 'Update promise'},

  // P2: Decision Intelligence
  {method: 'GET', path: '/api/v1/insights/aging', specCodes: ['P2_INT_001'], description: 'Get aging buckets'},
  {method: 'GET', path: '/api/v1/insights/forecast', specCodes: ['P2_INT_004'], description: 'Get cash-in forecast'},
  {method: 'GET', path: '/api/v1/insights/defaulters', specCodes: ['P2_INT_005'], description: 'Get defaulter risk list'},
  {method: 'GET', path: '/api/v1/insights/interest', specCodes: ['P2_INT_002'], description: 'Get business interest'},
  {method: 'GET', path: '/api/v1/customers/:id/interest', specCodes: ['P2_INT_002'], description: 'Get customer interest'},
  {method: 'GET', path: '/api/v1/insights/financial-year', specCodes: ['P2_INT_003'], description: 'Get financial year summary'},
  {method: 'GET', path: '/api/v1/settings/interest-policy', specCodes: ['P2_INT_002'], description: 'Get interest policy'},
  {method: 'PATCH', path: '/api/v1/settings/interest-policy', specCodes: ['P2_INT_002'], description: 'Update interest policy'},

  // P3: Trust & Survival
  {method: 'POST', path: '/api/auth/recover/init', specCodes: ['P3_TRUST_001'], description: 'Initialize account recovery'},
  {method: 'POST', path: '/api/auth/recover/verify', specCodes: ['P3_TRUST_001'], description: 'Verify recovery PIN'},
  {method: 'POST', path: '/api/auth/recover/approve-device', specCodes: ['P3_TRUST_001'], description: 'Approve device via recovery'},
  {method: 'GET', path: '/api/v1/security/recovery', specCodes: ['P3_TRUST_001'], description: 'Get recovery settings'},
  {method: 'POST', path: '/api/v1/security/recovery/enable', specCodes: ['P3_TRUST_001'], description: 'Enable recovery'},
  {method: 'POST', path: '/api/v1/security/recovery/disable', specCodes: ['P3_TRUST_001'], description: 'Disable recovery'},
  {method: 'GET', path: '/api/v1/security/devices', specCodes: ['P3_TRUST_002'], description: 'Get devices'},
  {method: 'POST', path: '/api/v1/security/devices/:id/approve', specCodes: ['P3_TRUST_002'], description: 'Approve device'},
  {method: 'POST', path: '/api/v1/security/devices/:id/block', specCodes: ['P3_TRUST_002'], description: 'Block device'},
  {method: 'POST', path: '/api/v1/backup/export', specCodes: ['P3_TRUST_003'], description: 'Export backup'},
  {method: 'GET', path: '/api/v1/backup/export/:id', specCodes: ['P3_TRUST_003'], description: 'Get export job status'},
  {method: 'GET', path: '/api/v1/backup/export/:id/download', specCodes: ['P3_TRUST_003'], description: 'Download export'},
  {method: 'POST', path: '/api/v1/backup/restore/init', specCodes: ['P3_TRUST_003'], description: 'Initialize restore'},
  {method: 'POST', path: '/api/v1/backup/restore/:id/upload', specCodes: ['P3_TRUST_003'], description: 'Upload restore file'},
  {method: 'GET', path: '/api/v1/backup/restore/:id', specCodes: ['P3_TRUST_003'], description: 'Get restore job status'},

  // P4: Fairness & Support
  {method: 'GET', path: '/api/v1/settings/plan', specCodes: ['P4_FAIR_002', 'P4_FAIR_003'], description: 'Get plan details'},
  {method: 'POST', path: '/api/v1/support/tickets', specCodes: ['P4_FAIR_004'], description: 'Create support ticket'},
  {method: 'GET', path: '/api/v1/support/tickets', specCodes: ['P4_FAIR_004'], description: 'List support tickets'},
  {method: 'GET', path: '/api/v1/support/tickets/:id', specCodes: ['P4_FAIR_004'], description: 'Get ticket details'},
  {method: 'POST', path: '/api/v1/support/tickets/:id/messages', specCodes: ['P4_FAIR_004'], description: 'Add ticket message'},
  {method: 'GET', path: '/api/v1/support/admin/tickets', specCodes: ['P4_FAIR_004'], description: 'List all tickets (admin)'},
  {method: 'PATCH', path: '/api/v1/support/admin/tickets/:id/status', specCodes: ['P4_FAIR_004'], description: 'Update ticket status (admin)'},

  // Core endpoints (not control features, but must be mapped)
  {method: 'GET', path: '/health', specCodes: [], description: 'Health check (infrastructure)'},
  {method: 'GET', path: '/ready', specCodes: [], description: 'Readiness check (infrastructure)'},
  {method: 'GET', path: '/status', specCodes: [], description: 'Status check (infrastructure)'},
  {method: 'POST', path: '/api/auth/login', specCodes: [], description: 'Core auth (not control feature)'},
  {method: 'POST', path: '/api/auth/signup', specCodes: [], description: 'Core auth (not control feature)'},
  {method: 'GET', path: '/api/customers', specCodes: [], description: 'Core feature (not control)'},
  {method: 'POST', path: '/api/customers', specCodes: [], description: 'Core feature (not control)'},
  {method: 'GET', path: '/api/customers/:id', specCodes: [], description: 'Core feature (not control)'},
  {method: 'PATCH', path: '/api/customers/:id', specCodes: [], description: 'Core feature (not control)'},
];

/**
 * Get all registered routes
 */
const getAllRoutes = () => {
  return ROUTE_SPECS;
};

/**
 * Find routes missing spec codes (unmapped)
 * Note: Routes with empty arrays ([]) are "core features, not control" and are OK
 * Only routes without the specCodes field are truly unmapped
 */
const getUnmappedRoutes = () => {
  return ROUTE_SPECS.filter((route) => !route.hasOwnProperty('specCodes'));
};

/**
 * Find routes by spec code
 */
const getRoutesBySpecCode = (specCode) => {
  return ROUTE_SPECS.filter((route) => route.specCodes.includes(specCode));
};

/**
 * Get compliance status
 */
const getComplianceStatus = () => {
  const total = ROUTE_SPECS.length;
  const unmapped = getUnmappedRoutes();
  const controlRoutes = ROUTE_SPECS.filter((route) => route.specCodes && route.specCodes.length > 0);
  const coreRoutes = ROUTE_SPECS.filter((route) => route.specCodes && route.specCodes.length === 0);

  return {
    total,
    controlRoutes: controlRoutes.length,
    coreRoutes: coreRoutes.length,
    unmapped: unmapped.length,
    compliant: unmapped.length === 0,
    unmappedRoutes: unmapped,
  };
};

module.exports = {
  ROUTE_SPECS,
  getAllRoutes,
  getUnmappedRoutes,
  getRoutesBySpecCode,
  getComplianceStatus,
};
