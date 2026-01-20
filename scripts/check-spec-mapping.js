/**
 * Spec Mapping CI Check
 * 
 * Fails build if any routes are missing spec code mappings
 * 
 * Usage: node scripts/check-spec-mapping.js
 * 
 * Step 14: Control Spec Compliance Gate
 */
const {getAllSpecCodes, isValidSpecCode} = require('../src/spec/ph4SpecRegistry');
const {getComplianceStatus, getAllRoutes} = require('../src/spec/routeRegistry');

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Print colored message
 */
const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

/**
 * Main check function
 */
async function checkSpecMapping() {
  log('\n🔍 PH4 Spec Mapping Compliance Check\n', 'cyan');

  try {
    // Get compliance status
    const status = getComplianceStatus();
    const specs = getAllSpecCodes();
    const routes = getAllRoutes();

    // Print summary
    log('📊 Summary:', 'blue');
    log(`   Total Spec Codes: ${specs.length}`);
    log(`   Total Routes: ${status.total}`);
    log(`   Control Routes: ${status.controlRoutes}`, 'cyan');
    log(`   Core Routes: ${status.coreRoutes}`, 'cyan');
    log(`   Unmapped Routes: ${status.unmapped}`, status.unmapped > 0 ? 'red' : 'green');

    // Validate all spec codes in routes
    log('\n🔬 Validating spec codes in routes...', 'blue');
    let invalidCodesFound = false;

    routes.forEach((route) => {
      route.specCodes.forEach((code) => {
        if (!isValidSpecCode(code)) {
          if (!invalidCodesFound) {
            log('\n❌ Invalid spec codes found:', 'red');
            invalidCodesFound = true;
          }
          log(`   ${route.method} ${route.path} -> ${code} (INVALID)`, 'red');
        }
      });
    });

    if (!invalidCodesFound) {
      log('   ✅ All spec codes are valid', 'green');
    }

    // Check for unmapped routes
    if (status.unmappedRoutes.length > 0) {
      log('\n❌ Unmapped Routes Found:', 'red');
      log('   The following routes are missing spec code mappings:\n', 'yellow');

      status.unmappedRoutes.forEach((route) => {
        log(`   ${route.method.padEnd(6)} ${route.path}`, 'yellow');
        log(`          Description: ${route.description || 'N/A'}`, 'yellow');
      });

      log('\n⚠️  Action Required:', 'yellow');
      log('   1. Add the route to src/spec/routeRegistry.js in ROUTE_SPECS array', 'yellow');
      log('   2. If this is a core feature (not control), use: specCodes: []', 'yellow');
      log('   3. If this is a control feature, use: specCodes: ["P0_REL_001", ...]', 'yellow');
      log('\n   Note: Empty arrays ([]) for core routes are OK and will not fail the build.', 'yellow');
    }

    // Print compliance status
    log('\n' + '='.repeat(60), 'blue');
    if (status.compliant && !invalidCodesFound) {
      log('✅ SPEC COMPLIANCE: PASS', 'green');
      log('='.repeat(60) + '\n', 'blue');
      log('All routes are properly mapped to spec codes.', 'green');
      log('Product is compliant with PH4 control specifications.\n', 'green');
      process.exit(0);
    } else {
      log('❌ SPEC COMPLIANCE: FAIL', 'red');
      log('='.repeat(60) + '\n', 'blue');
      
      if (invalidCodesFound) {
        log('Invalid spec codes found in route mappings.', 'red');
      }
      
      if (status.unmapped > 0) {
        log(`${status.unmapped} route(s) are missing spec code mappings.`, 'red');
      }
      
      log('\nBuild failed. Fix the issues above and try again.\n', 'red');
      process.exit(1);
    }
  } catch (error) {
    log('\n❌ Spec mapping check failed:', 'red');
    log(error.message, 'red');
    log('\n' + error.stack, 'red');
    process.exit(1);
  }
}

// Run check
checkSpecMapping();
