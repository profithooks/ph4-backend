/**
 * Migration: Add Indexes
 * 
 * Creates all required indexes for performance
 * Step 15: Release Candidate
 */

module.exports = {
  name: '001_add_indexes',

  async up(db) {
    console.log('Running migration: 001_add_indexes');

    // ReliabilityEvents
    await db.collection('reliabilityevents').createIndex({businessId: 1, at: -1});
    await db.collection('reliabilityevents').createIndex({requestId: 1});
    await db.collection('reliabilityevents').createIndex({userId: 1, at: -1});

    // AuditEvents
    await db.collection('auditevents').createIndex({businessId: 1, createdAt: -1});
    await db.collection('auditevents').createIndex({businessId: 1, customerId: 1, createdAt: -1});
    await db.collection('auditevents').createIndex({entityType: 1, entityId: 1});
    await db.collection('auditevents').createIndex({expiresAt: 1}, {expireAfterSeconds: 0});

    // NotificationAttempts
    await db.collection('notificationattempts').createIndex({notificationId: 1});
    await db.collection('notificationattempts').createIndex({status: 1, nextAttemptAt: 1});
    await db.collection('notificationattempts').createIndex({leasedUntil: 1});
    await db.collection('notificationattempts').createIndex({businessId: 1, status: 1});

    // IdempotencyKeys
    await db.collection('idempotencykeys').createIndex({key: 1}, {unique: true});

    // ExportJobs
    await db.collection('exportjobs').createIndex({businessId: 1, createdAt: -1});
    await db.collection('exportjobs').createIndex({status: 1, createdAt: 1});
    await db.collection('exportjobs').createIndex({expiresAt: 1}, {expireAfterSeconds: 0});

    // RestoreJobs
    await db.collection('restorejobs').createIndex({requestedBy: 1, createdAt: -1});
    await db.collection('restorejobs').createIndex({status: 1, createdAt: 1});

    // SupportTickets
    await db.collection('supporttickets').createIndex({businessId: 1, status: 1, createdAt: -1});
    await db.collection('supporttickets').createIndex({status: 1, dueAt: 1});
    await db.collection('supporttickets').createIndex({userId: 1, createdAt: -1});

    // SupportTicketMessages
    await db.collection('supportticketmessages').createIndex({ticketId: 1, createdAt: 1});

    // Bills
    await db.collection('bills').createIndex({userId: 1, isDeleted: 1, status: 1, dueDate: -1});
    await db.collection('bills').createIndex({userId: 1, customerId: 1, isDeleted: 1});

    // Customers
    await db.collection('customers').createIndex({userId: 1, isDeleted: 1});

    // FollowUpTasks
    await db.collection('followuptasks').createIndex({userId: 1, isDeleted: 1, status: 1, dueAt: 1});

    // RecoveryCases
    await db.collection('recoverycases').createIndex({userId: 1, status: 1, promiseAt: 1});

    // Devices
    await db.collection('devices').createIndex({userId: 1, deviceId: 1}, {unique: true});
    await db.collection('devices').createIndex({businessId: 1, status: 1});

    console.log('✅ Indexes created successfully');
  },

  async down(db) {
    // Optional: Define rollback if needed
    console.log('Rollback not implemented for 001_add_indexes');
  },
};
