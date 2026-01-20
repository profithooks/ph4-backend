/**
 * Verify Database Indexes
 * 
 * Ensures all required indexes exist for production performance
 * Step 12: Production Readiness
 * 
 * Usage: node scripts/verifyIndexes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../src/utils/logger');

// Import all models (this ensures indexes are defined)
const ReliabilityEvent = require('../src/models/ReliabilityEvent');
const AuditEvent = require('../src/models/AuditEvent');
const Notification = require('../src/models/Notification');
const NotificationAttempt = require('../src/models/NotificationAttempt');
const IdempotencyKey = require('../src/models/IdempotencyKey');
const ExportJob = require('../src/models/ExportJob');
const RestoreJob = require('../src/models/RestoreJob');
const SupportTicket = require('../src/models/SupportTicket');
const SupportTicketMessage = require('../src/models/SupportTicketMessage');
const Bill = require('../src/models/Bill');
const Customer = require('../src/models/Customer');
const FollowUpTask = require('../src/models/FollowUpTask');
const RecoveryCase = require('../src/models/RecoveryCase');
const Device = require('../src/models/Device');

/**
 * Critical indexes that must exist for production
 */
const REQUIRED_INDEXES = {
  reliabilityevents: [
    {businessId: 1, at: -1},
    {requestId: 1},
    {userId: 1, at: -1},
  ],
  auditevents: [
    {businessId: 1, createdAt: -1},
    {businessId: 1, customerId: 1, createdAt: -1},
    {entityType: 1, entityId: 1},
    {expiresAt: 1}, // TTL
  ],
  notificationattempts: [
    {notificationId: 1},
    {status: 1, nextAttemptAt: 1},
    {leasedUntil: 1},
    {businessId: 1, status: 1},
  ],
  idempotencykeys: [
    {key: 1}, // unique
  ],
  exportjobs: [
    {businessId: 1, createdAt: -1},
    {status: 1, createdAt: 1},
    {expiresAt: 1}, // TTL
  ],
  restorejobs: [
    {requestedBy: 1, createdAt: -1},
    {status: 1, createdAt: 1},
  ],
  supporttickets: [
    {businessId: 1, status: 1, createdAt: -1},
    {status: 1, dueAt: 1},
    {userId: 1, createdAt: -1},
  ],
  supportticketmessages: [
    {ticketId: 1, createdAt: 1},
  ],
  bills: [
    {userId: 1, isDeleted: 1, status: 1, dueDate: -1},
    {userId: 1, customerId: 1, isDeleted: 1},
  ],
  customers: [
    {userId: 1, isDeleted: 1},
  ],
  followuptasks: [
    {userId: 1, isDeleted: 1, status: 1, dueAt: 1},
  ],
  recoverycases: [
    {userId: 1, status: 1, promiseAt: 1},
  ],
  devices: [
    {userId: 1, deviceId: 1}, // unique composite
    {businessId: 1, status: 1},
  ],
};

/**
 * Connect to database
 */
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

/**
 * Check if an index exists on a collection
 */
function hasIndex(existingIndexes, requiredIndex) {
  return existingIndexes.some((existing) => {
    const existingKey = existing.key;
    const requiredKeys = Object.keys(requiredIndex);
    const existingKeys = Object.keys(existingKey);

    if (requiredKeys.length !== existingKeys.length) return false;

    return requiredKeys.every(
      (key) => existingKey[key] === requiredIndex[key]
    );
  });
}

/**
 * Verify indexes for all collections
 */
async function verifyIndexes() {
  console.log('\n🔍 Verifying database indexes...\n');

  const db = mongoose.connection.db;
  let allPresent = true;

  for (const [collectionName, requiredIndexes] of Object.entries(REQUIRED_INDEXES)) {
    try {
      const collection = db.collection(collectionName);
      const existingIndexes = await collection.indexes();

      console.log(`📋 Collection: ${collectionName}`);

      for (const requiredIndex of requiredIndexes) {
        if (hasIndex(existingIndexes, requiredIndex)) {
          console.log(`  ✅ ${JSON.stringify(requiredIndex)}`);
        } else {
          console.log(`  ❌ MISSING: ${JSON.stringify(requiredIndex)}`);
          allPresent = false;
        }
      }

      console.log('');
    } catch (error) {
      console.log(`  ⚠️  Collection does not exist (will be created on first use)\n`);
    }
  }

  return allPresent;
}

/**
 * Create missing indexes
 */
async function createIndexes() {
  console.log('🔧 Creating missing indexes...\n');

  try {
    // Mongoose will create indexes defined in schemas
    await Promise.all([
      ReliabilityEvent.createIndexes(),
      AuditEvent.createIndexes(),
      Notification.createIndexes(),
      NotificationAttempt.createIndexes(),
      IdempotencyKey.createIndexes(),
      ExportJob.createIndexes(),
      RestoreJob.createIndexes(),
      SupportTicket.createIndexes(),
      SupportTicketMessage.createIndexes(),
      Bill.createIndexes(),
      Customer.createIndexes(),
      FollowUpTask.createIndexes(),
      RecoveryCase.createIndexes(),
      Device.createIndexes(),
    ]);

    console.log('✅ All indexes created successfully\n');
  } catch (error) {
    console.error('❌ Index creation failed:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await connectDB();

    const allPresent = await verifyIndexes();

    if (!allPresent) {
      console.log('⚠️  Some indexes are missing\n');
      console.log('Creating indexes...\n');
      await createIndexes();
      console.log('✅ Index verification complete. Re-checking...\n');
      await verifyIndexes();
    } else {
      console.log('✅ All required indexes are present\n');
    }

    console.log('🎉 Index verification complete!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Index verification failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {verifyIndexes, createIndexes};
