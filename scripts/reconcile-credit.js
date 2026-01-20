/**
 * Credit Outstanding Reconciliation Script
 * 
 * PURPOSE: Detect and fix drift between Customer.creditOutstanding and actual Bills
 * 
 * USAGE:
 *   # Dry run (detect drift, no fixes)
 *   npm run reconcile-credit
 * 
 *   # Auto-fix mode (fixes detected drift)
 *   npm run reconcile-credit -- --fix
 * 
 *   # Single customer
 *   npm run reconcile-credit -- --customerId=<id>
 * 
 *   # Single customer with auto-fix
 *   npm run reconcile-credit -- --customerId=<id> --fix
 * 
 * WHEN TO RUN:
 * - After data migrations
 * - Weekly as preventive maintenance
 * - When investigating credit limit issues
 * - Before production deployment
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const {
  reconcileCustomerOutstanding,
  reconcileAllCustomers,
} = require('../src/services/creditOutstandingReconcile.service');

/**
 * ANSI colors
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = (msg, color = 'reset') => {
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    fix: false,
    customerId: null,
  };
  
  for (const arg of args) {
    if (arg === '--fix') {
      options.fix = true;
    } else if (arg.startsWith('--customerId=')) {
      options.customerId = arg.split('=')[1];
    }
  }
  
  return options;
}

/**
 * Connect to database
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    log('✅ Connected to MongoDB', 'green');
  } catch (error) {
    log('❌ MongoDB connection failed', 'red');
    log(error.message, 'red');
    process.exit(1);
  }
}

/**
 * Disconnect from database
 */
async function disconnectDB() {
  try {
    await mongoose.disconnect();
    log('✅ Disconnected from MongoDB', 'green');
  } catch (error) {
    log('❌ Disconnect failed', 'red');
    log(error.message, 'red');
  }
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  return `₹${amount.toFixed(2)}`;
}

/**
 * Run reconciliation
 */
async function run() {
  const options = parseArgs();
  
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║                                                              ║', 'cyan');
  log('║      CREDIT OUTSTANDING RECONCILIATION                       ║', 'cyan');
  log('║                                                              ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝\n', 'cyan');
  
  log(`Mode: ${options.fix ? 'AUTO-FIX ✅' : 'DRY RUN (detect only)'}`, options.fix ? 'green' : 'yellow');
  if (options.customerId) {
    log(`Target: Single customer (${options.customerId})`, 'blue');
  } else {
    log('Target: ALL customers for ALL users', 'blue');
  }
  log('');
  
  await connectDB();
  
  try {
    if (options.customerId) {
      // Single customer reconciliation
      await reconcileSingleCustomer(options.customerId, options.fix);
    } else {
      // Batch reconciliation for all users
      await reconcileAllUsers(options.fix);
    }
    
    log('\n✅ Reconciliation complete!', 'green');
  } catch (error) {
    log('\n❌ Reconciliation failed!', 'red');
    log(error.message, 'red');
    console.error(error);
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

/**
 * Reconcile single customer
 */
async function reconcileSingleCustomer(customerId, autoFix) {
  const Customer = require('../src/models/Customer');
  
  log('Loading customer...', 'blue');
  const customer = await Customer.findById(customerId);
  
  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }
  
  log(`Customer: ${customer.name} (${customerId})`, 'blue');
  log('');
  
  const result = await reconcileCustomerOutstanding(customer.userId, customerId, {
    autoFix,
    actorUserId: null, // System
    requestId: 'reconcile_script',
  });
  
  printCustomerResult({
    customerId,
    customerName: customer.name,
    ...result,
  });
}

/**
 * Reconcile all users
 */
async function reconcileAllUsers(autoFix) {
  log('Loading all users...', 'blue');
  const users = await User.find({}).lean();
  
  log(`Found ${users.length} user(s)\n`, 'blue');
  
  let totalCustomers = 0;
  let totalDrifted = 0;
  let totalFixed = 0;
  
  for (const user of users) {
    log(`\n${'─'.repeat(60)}`, 'cyan');
    log(`User: ${user.name} (${user.email})`, 'cyan');
    log(`${'─'.repeat(60)}`, 'cyan');
    
    const result = await reconcileAllCustomers(user._id, {
      autoFix,
      actorUserId: null,
      requestId: 'reconcile_script',
    });
    
    totalCustomers += result.total;
    totalDrifted += result.drifted;
    totalFixed += result.fixed;
    
    log(`\nCustomers: ${result.total}`, 'blue');
    log(`Drifted: ${result.drifted}`, result.drifted > 0 ? 'yellow' : 'green');
    log(`Fixed: ${result.fixed}`, result.fixed > 0 ? 'green' : 'reset');
    
    // Print detailed results for drifted customers
    const driftedCustomers = result.results.filter(r => r.hasDrift);
    if (driftedCustomers.length > 0) {
      log('\nDRIFTED CUSTOMERS:', 'yellow');
      for (const customer of driftedCustomers) {
        printCustomerResult(customer);
      }
    }
  }
  
  // Summary
  log('\n╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║                      SUMMARY                                 ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  log(`Total Customers: ${totalCustomers}`, 'blue');
  log(`Drifted: ${totalDrifted} (${((totalDrifted / totalCustomers) * 100).toFixed(1)}%)`, totalDrifted > 0 ? 'yellow' : 'green');
  log(`Fixed: ${totalFixed}`, totalFixed > 0 ? 'green' : 'reset');
  
  if (totalDrifted > 0 && !autoFix) {
    log('\n⚠️  Run with --fix flag to automatically fix drift', 'yellow');
  }
}

/**
 * Print customer reconciliation result
 */
function printCustomerResult(result) {
  const {customerId, customerName, stored, actual, delta, fixed, hasDrift, error} = result;
  
  if (error) {
    log(`  ❌ ${customerName || customerId}: ERROR - ${error}`, 'red');
    return;
  }
  
  if (!hasDrift) {
    log(`  ✅ ${customerName}: No drift (${formatCurrency(actual)})`, 'green');
    return;
  }
  
  const deltaSign = delta > 0 ? '+' : '';
  const status = fixed ? '🔧 FIXED' : '⚠️  DRIFT';
  const color = fixed ? 'green' : 'yellow';
  
  log(`  ${status} ${customerName}:`, color);
  log(`       Stored:  ${formatCurrency(stored)}`, color);
  log(`       Actual:  ${formatCurrency(actual)}`, color);
  log(`       Delta:   ${deltaSign}${formatCurrency(delta)}`, color);
  log('');
}

// Run script
run().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
