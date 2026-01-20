/**
 * Migration Runner
 * 
 * Runs pending database migrations
 * Step 15: Release Candidate
 * 
 * Usage: npm run migrate
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const Migration = require('../src/models/Migration');

/**
 * ANSI colors
 */
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

const log = (msg, color = 'reset') => {
  console.log(`${colors[color]}${msg}${colors.reset}`);
};

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
 * Get all migration files
 */
async function getMigrationFiles() {
  const migrationsDir = path.join(__dirname, '../migrations');
  
  try {
    const files = await fs.readdir(migrationsDir);
    return files
      .filter((f) => f.endsWith('.js'))
      .sort(); // Sort by filename (001, 002, 003, etc.)
  } catch (error) {
    log('❌ Failed to read migrations directory', 'red');
    log(error.message, 'red');
    return [];
  }
}

/**
 * Get applied migrations
 */
async function getAppliedMigrations() {
  const applied = await Migration.find({status: 'SUCCESS'}).sort({appliedAt: 1});
  return new Set(applied.map((m) => m.name));
}

/**
 * Run a single migration
 */
async function runMigration(migrationFile) {
  const migrationPath = path.join(__dirname, '../migrations', migrationFile);
  const migration = require(migrationPath);

  const startTime = Date.now();
  
  try {
    log(`\n🔄 Running: ${migration.name}`, 'blue');
    
    // Run migration
    await migration.up(mongoose.connection.db);
    
    const durationMs = Date.now() - startTime;
    
    // Record migration
    await Migration.create({
      name: migration.name,
      appliedAt: new Date(),
      durationMs,
      status: 'SUCCESS',
    });
    
    log(`✅ Completed in ${durationMs}ms`, 'green');
    return true;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    
    log(`❌ Migration failed: ${error.message}`, 'red');
    
    // Record failed migration
    await Migration.create({
      name: migration.name,
      appliedAt: new Date(),
      durationMs,
      status: 'FAILED',
      error: error.message,
    });
    
    return false;
  }
}

/**
 * Main migration function
 */
async function migrate() {
  log('\n🗄️  Database Migration Runner\n', 'blue');

  try {
    await connectDB();

    // Get all migration files
    const migrationFiles = await getMigrationFiles();
    log(`Found ${migrationFiles.length} migration file(s)`, 'blue');

    if (migrationFiles.length === 0) {
      log('No migrations to run', 'yellow');
      process.exit(0);
    }

    // Get applied migrations
    const appliedMigrations = await getAppliedMigrations();
    log(`${appliedMigrations.size} migration(s) already applied`, 'blue');

    // Find pending migrations
    const pendingMigrations = migrationFiles.filter((file) => {
      const migration = require(path.join(__dirname, '../migrations', file));
      return !appliedMigrations.has(migration.name);
    });

    if (pendingMigrations.length === 0) {
      log('\n✅ All migrations are up to date', 'green');
      process.exit(0);
    }

    log(`\n${pendingMigrations.length} pending migration(s) to run:\n`, 'yellow');

    // Run pending migrations
    let success = 0;
    let failed = 0;

    for (const file of pendingMigrations) {
      const result = await runMigration(file);
      if (result) {
        success++;
      } else {
        failed++;
        log('\n❌ Migration failed, stopping', 'red');
        break;
      }
    }

    // Summary
    log('\n' + '='.repeat(50), 'blue');
    if (failed === 0) {
      log(`✅ All migrations completed successfully (${success}/${pendingMigrations.length})`, 'green');
      log('='.repeat(50) + '\n', 'blue');
      process.exit(0);
    } else {
      log(`❌ Migrations failed (${success} success, ${failed} failed)`, 'red');
      log('='.repeat(50) + '\n', 'blue');
      process.exit(1);
    }
  } catch (error) {
    log('\n❌ Migration runner failed:', 'red');
    log(error.message, 'red');
    log(error.stack, 'red');
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run migrations
migrate();
