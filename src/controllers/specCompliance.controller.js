/**
 * Spec Compliance Controller
 * 
 * Dev-only endpoint to check spec mapping compliance
 * Step 14: Control Spec Compliance Gate
 */
const {getAllSpecCodes} = require('../spec/ph4SpecRegistry');
const {getAllRoutes, getComplianceStatus, getRoutesBySpecCode} = require('../spec/routeRegistry');
const logger = require('../utils/logger');

/**
 * GET /api/v1/dev/spec-compliance
 * 
 * Returns spec compliance report
 * Dev-only endpoint (guarded by NODE_ENV check in routes)
 */
const getSpecCompliance = (req, res) => {
  try {
    const specs = getAllSpecCodes();
    const routes = getAllRoutes();
    const status = getComplianceStatus();

    // Group routes by spec code
    const specMapping = {};
    specs.forEach((spec) => {
      specMapping[spec.code] = {
        spec,
        routes: getRoutesBySpecCode(spec.code),
      };
    });

    const response = {
      timestamp: new Date().toISOString(),
      compliant: status.compliant,
      summary: {
        totalSpecs: specs.length,
        totalRoutes: status.total,
        mappedRoutes: status.mapped,
        unmappedRoutes: status.unmapped,
      },
      specs: specMapping,
      unmappedRoutes: status.unmappedRoutes,
      status: status.compliant ? 'PASS' : 'FAIL',
    };

    logger.info('[SpecCompliance] Compliance check', {
      requestId: req.requestId,
      compliant: status.compliant,
      unmappedCount: status.unmapped,
    });

    res.json({
      ok: true,
      requestId: req.requestId,
      data: response,
    });
  } catch (error) {
    logger.error('[SpecCompliance] Check failed', {
      requestId: req.requestId,
      error: error.message,
    });

    res.status(500).json({
      ok: false,
      requestId: req.requestId,
      error: {
        code: 'SPEC_COMPLIANCE_ERROR',
        message: 'Failed to check spec compliance',
        details: error.message,
      },
    });
  }
};

/**
 * GET /api/v1/dev/spec-codes
 * 
 * Returns all spec codes with metadata
 * Dev-only endpoint
 */
const getSpecCodes = (req, res) => {
  try {
    const specs = getAllSpecCodes();

    // Group by pillar
    const byPillar = specs.reduce((acc, spec) => {
      if (!acc[spec.pillar]) {
        acc[spec.pillar] = [];
      }
      acc[spec.pillar].push(spec);
      return acc;
    }, {});

    res.json({
      ok: true,
      requestId: req.requestId,
      data: {
        specs,
        byPillar,
        total: specs.length,
      },
    });
  } catch (error) {
    logger.error('[SpecCompliance] Get spec codes failed', {
      requestId: req.requestId,
      error: error.message,
    });

    res.status(500).json({
      ok: false,
      requestId: req.requestId,
      error: {
        code: 'SPEC_CODES_ERROR',
        message: 'Failed to get spec codes',
        details: error.message,
      },
    });
  }
};

module.exports = {
  getSpecCompliance,
  getSpecCodes,
};
