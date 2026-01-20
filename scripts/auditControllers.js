/**
 * Controller Audit Script
 * 
 * Scans all controllers to identify which ones need migration to envelope format
 * Usage: node scripts/auditControllers.js
 */

const fs = require('fs');
const path = require('path');

const CONTROLLERS_DIR = path.join(__dirname, '../src/controllers');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Analyze a controller file
 */
function analyzeController(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  
  // Check for res.success() usage (new envelope format)
  const hasResSuccess = content.includes('res.success(');
  
  // Check for res.json({ success: true }) (legacy format)
  const hasLegacySuccess = /res\.json\(\s*\{\s*success:\s*true/.test(content);
  const hasLegacyStatus = /res\.status\(\d+\)\.json\(\s*\{\s*success:\s*true/.test(content);
  
  // Count response statements
  const successCount = (content.match(/res\.success\(/g) || []).length;
  const legacyCount = (content.match(/res\.json\(\s*\{/g) || []).length;
  
  return {
    filename,
    hasResSuccess,
    hasLegacySuccess: hasLegacySuccess || hasLegacyStatus,
    successCount,
    legacyCount,
    needsMigration: (hasLegacySuccess || hasLegacyStatus) && !hasResSuccess,
    mixed: hasResSuccess && (hasLegacySuccess || hasLegacyStatus),
  };
}

/**
 * Main audit function
 */
function auditControllers() {
  console.log('\n' + '='.repeat(70));
  console.log('  Controller Envelope Format Audit');
  console.log('='.repeat(70) + '\n');
  
  const files = fs.readdirSync(CONTROLLERS_DIR)
    .filter(f => f.endsWith('.controller.js'));
  
  const results = files.map(f => 
    analyzeController(path.join(CONTROLLERS_DIR, f))
  );
  
  // Categorize
  const migrated = results.filter(r => r.hasResSuccess && !r.mixed);
  const needsMigration = results.filter(r => r.needsMigration);
  const mixed = results.filter(r => r.mixed);
  
  // Print migrated controllers
  if (migrated.length > 0) {
    console.log(`${colors.green}✓ Migrated (${migrated.length})${colors.reset}`);
    migrated.forEach(r => {
      console.log(`  ${r.filename} (${r.successCount} endpoints)`);
    });
    console.log();
  }
  
  // Print mixed controllers
  if (mixed.length > 0) {
    console.log(`${colors.yellow}⚠ Partially Migrated (${mixed.length})${colors.reset}`);
    mixed.forEach(r => {
      console.log(`  ${r.filename}`);
      console.log(`    - New format: ${r.successCount} endpoints`);
      console.log(`    - Legacy format: ${r.legacyCount} endpoints`);
    });
    console.log();
  }
  
  // Print controllers needing migration
  if (needsMigration.length > 0) {
    console.log(`${colors.red}✗ Needs Migration (${needsMigration.length})${colors.reset}`);
    needsMigration.forEach(r => {
      console.log(`  ${r.filename} (~${r.legacyCount} endpoints)`);
    });
    console.log();
  }
  
  // Summary
  console.log('='.repeat(70));
  console.log('Summary:');
  console.log(`  Total controllers: ${results.length}`);
  console.log(`  ${colors.green}Migrated: ${migrated.length}${colors.reset}`);
  console.log(`  ${colors.yellow}Partial: ${mixed.length}${colors.reset}`);
  console.log(`  ${colors.red}Pending: ${needsMigration.length}${colors.reset}`);
  console.log('='.repeat(70));
  
  // Migration instructions
  if (needsMigration.length > 0 || mixed.length > 0) {
    console.log('\nMigration Guide:');
    console.log('  Replace: res.json({ success: true, data: X })');
    console.log('  With:    res.success(X)');
    console.log();
    console.log('  Replace: res.status(201).json({ success: true, data: X })');
    console.log('  With:    res.success(X, 201)');
    console.log();
    console.log('Note: Error handling is automatic via error middleware');
    console.log('      Just throw AppError or let express-async-handler catch it\n');
  }
}

// Run audit
try {
  auditControllers();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
