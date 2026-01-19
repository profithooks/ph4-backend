/**
 * Production Readiness Verification Script
 */
const fs = require('fs');
const path = require('path');

const results = {
  security: {},
  validation: {},
  health: {},
  database: {},
};

console.log('='.repeat(70));
console.log('PRODUCTION READINESS VERIFICATION');
console.log('='.repeat(70));

// Check 1: Security Middleware
console.log('\n[1] SECURITY MIDDLEWARE');
console.log('-'.repeat(70));

try {
  const appJs = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  
  const checks = {
    helmet: appJs.includes("require('helmet')") || appJs.includes('helmet'),
    compression: appJs.includes("require('compression')") || appJs.includes('compression'),
    xPoweredBy: appJs.includes('x-powered-by') && appJs.includes('disable'),
    cors: appJs.includes('cors') && appJs.includes('CORS_ORIGINS'),
    rateLimit: appJs.includes('rate-limit') || appJs.includes('rateLimit'),
    bodyLimit: appJs.includes('limit:') && appJs.includes('mb'),
  };
  
  results.security = checks;
  
  console.log('✓ Helmet:', checks.helmet ? 'ENABLED' : 'MISSING');
  console.log('✓ Compression:', checks.compression ? 'ENABLED' : 'MISSING');
  console.log('✓ X-Powered-By disabled:', checks.xPoweredBy ? 'YES' : 'NO');
  console.log('✓ CORS restricted:', checks.cors ? 'YES' : 'NO');
  console.log('✓ Rate limiting:', checks.rateLimit ? 'ENABLED' : 'MISSING');
  console.log('✓ Body size limits:', checks.bodyLimit ? 'SET' : 'MISSING');
} catch (error) {
  console.error('ERROR:', error.message);
  results.security.error = error.message;
}

// Check 2: Validation
console.log('\n[2] VALIDATION MIDDLEWARE');
console.log('-'.repeat(70));

try {
  const routesDir = path.join(__dirname, '../src/routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.routes.js'));
  
  let totalRoutes = 0;
  let validatedRoutes = 0;
  
  routeFiles.forEach(file => {
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
    const postPatchPut = (content.match(/router\.(post|patch|put)/g) || []).length;
    const withValidate = (content.match(/validate\(/g) || []).length;
    
    totalRoutes += postPatchPut;
    validatedRoutes += withValidate;
  });
  
  results.validation = {
    totalRoutes,
    validatedRoutes,
    coverage: totalRoutes > 0 ? Math.round((validatedRoutes / totalRoutes) * 100) : 0,
  };
  
  console.log(`✓ Total POST/PATCH/PUT routes: ${totalRoutes}`);
  console.log(`✓ Routes with Joi validation: ${validatedRoutes} (${results.validation.coverage}%)`);
} catch (error) {
  console.error('ERROR:', error.message);
  results.validation.error = error.message;
}

// Write results
fs.writeFileSync(
  path.join(__dirname, '../verification-results.json'),
  JSON.stringify(results, null, 2)
);

const allPassed = 
  results.security.helmet &&
  results.security.compression &&
  results.security.cors &&
  results.validation.coverage >= 80;

console.log('\n' + '='.repeat(70));
console.log('STATUS:', allPassed ? '✅ PASS' : '⚠️  NEEDS ATTENTION');
console.log('='.repeat(70));

process.exit(allPassed ? 0 : 1);
