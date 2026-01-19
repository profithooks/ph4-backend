#!/usr/bin/env node
/**
 * Proof Script: Verify Request Count via FIN Logs
 *
 * USAGE:
 * 1. Start this script: npm run prove:requests
 * 2. While it runs (15s window), in the mobile app:
 *    - Queue 1 ledger operation offline
 *    - Tap "Sync Now" 3 times rapidly
 * 3. Script will output summary:
 *    - PASS if each rid appears exactly once (no duplicate requests)
 *    - FAIL if any rid appears > 1 time (duplicate requests detected)
 *
 * EXIT CODES:
 * 0 = PASS (all rids unique)
 * 1 = FAIL (duplicate requests detected)
 */

const {spawn} = require('child_process');
const path = require('path');

const COLLECTION_DURATION = 15000; // 15 seconds
const PROOF_PORT = 5055; // Dedicated port for proof runs (avoids macOS ControlCenter on 5000)
const finLines = [];

console.log('========================================');
console.log('PROOF SCRIPT: Request Count Verification');
console.log('========================================\n');

// Spawn backend with LOG_FIN_ONLY=true and dedicated port
const serverPath = path.join(__dirname, '..', 'src', 'server.js');
const backend = spawn('node', [serverPath], {
  env: {
    ...process.env,
    LOG_FIN_ONLY: 'true',
    PORT: String(PROOF_PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let ready = false;

// Capture stdout
backend.stdout.on('data', data => {
  const lines = data.toString().split('\n');
  lines.forEach(line => {
    if (!line.trim()) return;

    // Check for server ready signal
    if (!ready && line.includes('Server running on port')) {
      ready = true;
      console.log(`✅ Backend READY on port ${PROOF_PORT}\n`);

      // Auto-ping backend to verify it's truly reachable
      const http = require('http');
      const pingUrl = `http://localhost:${PROOF_PORT}/api/health`;

      http
        .get(pingUrl, res => {
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log(`✅ Auto-ping OK ${res.statusCode}: /api/health\n`);
            } else {
              console.error(
                `❌ Auto-ping FAILED with status ${res.statusCode}: /api/health`,
              );
              console.error(`   Response: ${data}`);
              console.error(`   Backend READY but health check returned non-200.`);
              console.error(`   Exiting.\n`);
              backend.kill();
              process.exit(1);
            }
          });
        })
        .on('error', err => {
          console.error(`❌ Auto-ping FAILED: ${err.message}`);
          console.error(`   URL: ${pingUrl}`);
          console.error(
            `   Backend reported ready but /api/health is not reachable.`,
          );
          console.error(`   Exiting.\n`);
          backend.kill();
          process.exit(1);
        });

      console.log('👉 YOU HAVE 15 SECONDS:');
      console.log('   1. In the app, queue 1 ledger operation offline');
      console.log('   2. Tap "Sync Now" 3 times rapidly\n');
      console.log('Collecting FIN logs...\n');
      console.log('--- RAW FIN LOGS ---');
    }

    // Collect FIN lines
    if (line.startsWith('FIN')) {
      console.log(line);
      finLines.push(line);
    }
  });
});

// Capture stderr (errors)
backend.stderr.on('data', data => {
  const errMsg = data.toString();
  if (!errMsg.includes('DeprecationWarning')) {
    console.error('Backend Error:', errMsg);
  }
});

// After collection duration, analyze and exit
setTimeout(() => {
  backend.kill();

  console.log('\n--- COLLECTION COMPLETE ---\n');

  if (finLines.length === 0) {
    if (ready) {
      // Backend was ready but no FIN logs captured
      console.log('❌ NO FIN LOGS CAPTURED');
      console.log('Backend was ready but received no requests.');
      console.log('');
      console.log('Possible reasons:');
      console.log('  - Frontend API base URL does not match backend port');
      console.log(`  - Expected backend port: ${PROOF_PORT}`);
      console.log('  - Check src/config/env.js for correct port configuration');
      console.log('  - No sync operations were performed during 15s window\n');
      process.exit(1);
    } else {
      // Backend never became ready
      console.log('⚠️  BACKEND NEVER STARTED');
      console.log('Server did not print ready message.\n');
      process.exit(1);
    }
  }

  // Parse FIN lines
  const parsed = finLines.map(line => {
    const uidMatch = line.match(/uid=([\w]+)/);
    const ridMatch = line.match(/rid=([\w:]+)/);
    const statusMatch = line.match(/status=(\d+)/);
    const idemMatch = line.match(/idem=([\w_:]+)/);
    const pathMatch = line.match(/path=([\w/:]+)/);

    return {
      uid: uidMatch ? uidMatch[1] : 'UNKNOWN',
      rid: ridMatch ? ridMatch[1] : 'UNKNOWN',
      status: statusMatch ? statusMatch[1] : 'UNKNOWN',
      idem: idemMatch ? idemMatch[1] : 'UNKNOWN',
      path: pathMatch ? pathMatch[1] : 'UNKNOWN',
    };
  });

  // Filter: ledger only (/api/ledger/credit or /api/ledger/debit)
  const ledgerFIN = parsed.filter(
    p =>
      p.path === '/api/ledger/credit' ||
      p.path === '/api/ledger/debit',
  );

  // Compute statistics on LEDGER FIN only
  const totalLedgerFin = ledgerFIN.length;
  const uniqueUidsLedger = new Set(ledgerFIN.map(p => p.uid)).size;
  const ridCountsLedger = {};

  ledgerFIN.forEach(p => {
    ridCountsLedger[p.rid] = (ridCountsLedger[p.rid] || 0) + 1;
  });

  // Print summary
  console.log('========================================');
  console.log('             SUMMARY');
  console.log('========================================');
  console.log(`Total FIN logs:       ${parsed.length}`);
  console.log(`Ledger FIN logs:      ${totalLedgerFin}`);
  console.log(`Unique UIDs (ledger): ${uniqueUidsLedger}`);
  console.log('');

  // Check if any ledger requests were captured
  if (totalLedgerFin === 0) {
    console.log('❌ FAIL: No ledger FIN logs captured.');
    console.log('   App did not hit backend ledger endpoints during the window.');
    console.log('   Only /api/ledger/credit and /api/ledger/debit count as proof.\n');
    console.log('   To pass:');
    console.log('   1. Queue a ledger operation offline (Add Credit/Debit)');
    console.log('   2. Tap "Sync Now" while proof script is running\n');
    process.exit(1);
  }

  console.log('Request ID (rid) counts (ledger only):');

  let hasDuplicates = false;
  Object.entries(ridCountsLedger).forEach(([rid, count]) => {
    const marker = count > 1 ? '❌ DUPLICATE' : '✅';
    console.log(`  ${rid} => ${count} ${marker}`);
    if (count > 1) hasDuplicates = true;
  });

  console.log('');
  console.log('========================================');

  if (hasDuplicates) {
    console.log('❌ FAIL: Duplicate requests detected!');
    console.log('   The same rid appeared multiple times in ledger FIN logs.');
    console.log('   This means the frontend sent > 1 HTTP request');
    console.log('   for the same queued action (mutex bug).\n');
    process.exit(1);
  } else if (
    totalLedgerFin === uniqueUidsLedger &&
    totalLedgerFin === Object.keys(ridCountsLedger).length
  ) {
    console.log('✅ PASS: All ledger requests are unique!');
    console.log(`   ${totalLedgerFin} ledger FIN log(s) captured.`);
    console.log('   Each rid appeared exactly once.');
    console.log('   Mutex is working correctly.\n');
    process.exit(0);
  } else {
    console.log('⚠️  AMBIGUOUS: Review the counts above.');
    console.log('   - If totalLedgerFin == uniqueUids: Likely PASS');
    console.log('   - If totalLedgerFin > uniqueUids: Possible duplicates\n');
    process.exit(totalLedgerFin === uniqueUidsLedger ? 0 : 1);
  }
}, COLLECTION_DURATION);

// Handle script termination
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Script interrupted by user.');
  backend.kill();
  process.exit(1);
});

process.on('SIGTERM', () => {
  backend.kill();
  process.exit(1);
});

// Handle backend exit before timeout
backend.on('exit', (code, signal) => {
  if (!ready && code !== 0) {
    console.error(`\n❌ Backend exited early with code ${code}`);
    console.error('Check for port conflicts or startup errors.\n');
    process.exit(1);
  }
});
