/**
 * PH4 Control Spec Registry
 * 
 * Authoritative list of all PH4 control capabilities (P0-P4)
 * Every feature/endpoint MUST map to at least one spec code
 * 
 * Step 14: Control Spec Compliance Gate
 */

/**
 * PH4 Control Specification Codes
 * 
 * LOCKED - Do NOT change these without product review
 */
const SPEC_CODES = {
  // P0: Reliability
  P0_REL_001: {
    code: 'P0_REL_001',
    pillar: 'P0_RELIABILITY',
    title: 'Zero silent failures',
    description: 'All writes, reminders, notifications must be visible and traceable end-to-end',
  },
  P0_REL_002: {
    code: 'P0_REL_002',
    pillar: 'P0_RELIABILITY',
    title: 'Offline deterministic sync',
    description: 'Offline-first with deterministic replay and conflict handling',
  },
  P0_REL_003: {
    code: 'P0_REL_003',
    pillar: 'P0_RELIABILITY',
    title: 'Delivery status visibility',
    description: 'Notification delivery status (sent/failed/retry) with visible timelines',
  },

  // P1: Hard Control
  P1_CTRL_001: {
    code: 'P1_CTRL_001',
    pillar: 'P1_HARD_CONTROL',
    title: 'Per-customer hard credit limits',
    description: 'Set and enforce credit limits per customer',
  },
  P1_CTRL_002: {
    code: 'P1_CTRL_002',
    pillar: 'P1_HARD_CONTROL',
    title: 'Auto-block billing on breach',
    description: 'Automatically block new credit bills when limit breached',
  },
  P1_CTRL_003: {
    code: 'P1_CTRL_003',
    pillar: 'P1_HARD_CONTROL',
    title: 'Owner override with audit trail',
    description: 'Allow owner to override blocks with mandatory reason and audit',
  },
  P1_CTRL_004: {
    code: 'P1_CTRL_004',
    pillar: 'P1_HARD_CONTROL',
    title: 'Staff accountability (no silent edits/deletes)',
    description: 'All edits/deletes create immutable audit events, prevent silent changes',
  },

  // P1: Recovery Engine
  P1_REC_001: {
    code: 'P1_REC_001',
    pillar: 'P1_RECOVERY_ENGINE',
    title: 'Escalation-based follow-ups',
    description: 'Automatic follow-up escalation based on overdue status',
  },
  P1_REC_002: {
    code: 'P1_REC_002',
    pillar: 'P1_RECOVERY_ENGINE',
    title: 'Daily who-to-chase list',
    description: 'Daily actionable chase list sorted deterministically',
  },
  P1_REC_003: {
    code: 'P1_REC_003',
    pillar: 'P1_RECOVERY_ENGINE',
    title: 'Money-at-risk dashboard',
    description: 'Real-time visibility of total receivable, overdue, broken promises',
  },
  P1_REC_004: {
    code: 'P1_REC_004',
    pillar: 'P1_RECOVERY_ENGINE',
    title: 'Promise tracking with consequences',
    description: 'Track promises with automatic consequence marking (broken)',
  },

  // P2: Decision Intelligence
  P2_INT_001: {
    code: 'P2_INT_001',
    pillar: 'P2_DECISION_INTELLIGENCE',
    title: 'Aging buckets',
    description: 'Categorize overdue amounts into 0-7, 8-15, 16-30, 31-60, 60+ day buckets',
  },
  P2_INT_002: {
    code: 'P2_INT_002',
    pillar: 'P2_DECISION_INTELLIGENCE',
    title: 'Interest calculation configurable',
    description: 'Automatic interest calculation with configurable rules (rate, grace, cap)',
  },
  P2_INT_003: {
    code: 'P2_INT_003',
    pillar: 'P2_DECISION_INTELLIGENCE',
    title: 'Annual opening/closing clarity',
    description: 'Financial year opening/closing snapshots with collections tracking',
  },
  P2_INT_004: {
    code: 'P2_INT_004',
    pillar: 'P2_DECISION_INTELLIGENCE',
    title: 'Cash-in forecast 7/30',
    description: 'Forecast incoming cash for 7-day and 30-day horizons',
  },
  P2_INT_005: {
    code: 'P2_INT_005',
    pillar: 'P2_DECISION_INTELLIGENCE',
    title: 'Defaulter risk list',
    description: 'Rule-based scoring and ranking of high-risk customers',
  },

  // P3: Trust & Survival
  P3_TRUST_001: {
    code: 'P3_TRUST_001',
    pillar: 'P3_TRUST_SURVIVAL',
    title: 'Account recovery beyond phone',
    description: 'Recovery PIN and email-based account recovery if phone lost',
  },
  P3_TRUST_002: {
    code: 'P3_TRUST_002',
    pillar: 'P3_TRUST_SURVIVAL',
    title: 'Device binding + auto-lock',
    description: 'Device binding enforcement and app-level auto-lock for security',
  },
  P3_TRUST_003: {
    code: 'P3_TRUST_003',
    pillar: 'P3_TRUST_SURVIVAL',
    title: 'Data export + restore guarantee',
    description: 'Complete data export with checksums and safe restore',
  },

  // P4: Fairness & Support
  P4_FAIR_001: {
    code: 'P4_FAIR_001',
    pillar: 'P4_FAIRNESS_SUPPORT',
    title: 'No ads',
    description: 'Policy: No ads in the product, ever',
  },
  P4_FAIR_002: {
    code: 'P4_FAIR_002',
    pillar: 'P4_FAIRNESS_SUPPORT',
    title: 'No surprise paywalls on core usage',
    description: 'Core features (billing, ledger, recovery) never paywalled',
  },
  P4_FAIR_003: {
    code: 'P4_FAIR_003',
    pillar: 'P4_FAIRNESS_SUPPORT',
    title: 'Clear pricing boundaries',
    description: 'Transparent plan limits with soft caps, not hard blocks on core',
  },
  P4_FAIR_004: {
    code: 'P4_FAIR_004',
    pillar: 'P4_FAIRNESS_SUPPORT',
    title: 'Support with SLA',
    description: 'Support ticketing system with SLA tracking and accountability',
  },
};

/**
 * Get all spec codes as array
 */
const getAllSpecCodes = () => {
  return Object.values(SPEC_CODES);
};

/**
 * Get spec codes by pillar
 */
const getSpecCodesByPillar = (pillar) => {
  return Object.values(SPEC_CODES).filter((spec) => spec.pillar === pillar);
};

/**
 * Validate spec code exists
 */
const isValidSpecCode = (code) => {
  return SPEC_CODES.hasOwnProperty(code);
};

/**
 * Assert that spec mappings are valid
 * Throws error if any code is invalid
 */
const assertSpecMapping = (codes) => {
  if (!Array.isArray(codes)) {
    throw new Error('Spec codes must be an array');
  }

  const invalid = codes.filter((code) => !isValidSpecCode(code));
  if (invalid.length > 0) {
    throw new Error(`Invalid spec codes: ${invalid.join(', ')}`);
  }

  return true;
};

/**
 * Get spec details by code
 */
const getSpecDetails = (code) => {
  return SPEC_CODES[code] || null;
};

/**
 * Pillars enum
 */
const PILLARS = {
  P0_RELIABILITY: 'P0_RELIABILITY',
  P1_HARD_CONTROL: 'P1_HARD_CONTROL',
  P1_RECOVERY_ENGINE: 'P1_RECOVERY_ENGINE',
  P2_DECISION_INTELLIGENCE: 'P2_DECISION_INTELLIGENCE',
  P3_TRUST_SURVIVAL: 'P3_TRUST_SURVIVAL',
  P4_FAIRNESS_SUPPORT: 'P4_FAIRNESS_SUPPORT',
};

module.exports = {
  SPEC_CODES,
  PILLARS,
  getAllSpecCodes,
  getSpecCodesByPillar,
  isValidSpecCode,
  assertSpecMapping,
  getSpecDetails,
};
