/**
 * Message Delivery Service
 * State machine for message delivery with retry logic
 */
const MessageEvent = require('../models/MessageEvent');

/**
 * Enqueue a message event for delivery
 * @param {string} eventId - Message event ID
 * @returns {Promise<Object>} Updated event
 */
exports.enqueueEvent = async eventId => {
  const event = await MessageEvent.findById(eventId);
  
  if (!event) {
    throw new Error('Message event not found');
  }

  // Only enqueue if CREATED
  if (event.status !== 'CREATED') {
    return event;
  }

  // Transition CREATED -> QUEUED
  event.status = 'QUEUED';
  event.nextAttemptAt = event.nextAttemptAt || new Date();
  
  await event.save();
  
  return event;
};

/**
 * Lease next batch of messages ready for delivery
 * Uses optimistic locking to prevent concurrent processing
 * @param {number} limit - Max messages to lease
 * @returns {Promise<Array>} Leased message events
 */
exports.leaseNextBatch = async (limit = 20) => {
  const now = new Date();
  const leaseDuration = 60 * 1000; // 60 seconds
  const leaseExpiry = new Date(now.getTime() + leaseDuration);

  // Find messages ready for delivery
  // Status must be QUEUED or FAILED (for retry)
  // nextAttemptAt must be <= now
  // lockUntil must be missing or expired
  const query = {
    status: {$in: ['QUEUED', 'FAILED']},
    nextAttemptAt: {$lte: now},
    $or: [
      {lockUntil: {$exists: false}},
      {lockUntil: null},
      {lockUntil: {$lte: now}},
    ],
  };

  // Atomically acquire lease on batch
  const events = [];
  
  // Find candidates
  const candidates = await MessageEvent.find(query)
    .sort({nextAttemptAt: 1}) // Oldest first
    .limit(limit)
    .lean();

  // Atomically update each candidate with lease
  for (const candidate of candidates) {
    const updated = await MessageEvent.findOneAndUpdate(
      {
        _id: candidate._id,
        status: candidate.status,
        // Ensure no one else leased it in the meantime
        $or: [
          {lockUntil: {$exists: false}},
          {lockUntil: null},
          {lockUntil: {$lte: now}},
        ],
      },
      {
        $set: {lockUntil: leaseExpiry},
      },
      {new: true},
    );

    if (updated) {
      events.push(updated);
    }
  }

  return events;
};

/**
 * Deliver message via MOCK provider (simulation)
 * @param {Object} event - Message event
 * @returns {Promise<Object>} Updated event
 */
exports.deliverMock = async event => {
  const now = new Date();

  // Increment attempt count
  event.attemptCount = (event.attemptCount || 0) + 1;
  event.lastAttemptAt = now;

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // Mock delivery: 90% success rate
  const shouldSucceed = Math.random() > 0.1;

  if (shouldSucceed) {
    // Success path: QUEUED/FAILED -> SENT -> DELIVERED
    event.status = 'SENT';
    event.providerMessageId = `mock_${event._id}_${Date.now()}`;
    event.lastError = null;
    
    await event.save();

    // Immediately mark as delivered (mock provider confirms instantly)
    event.status = 'DELIVERED';
    event.lockUntil = null; // Clear lease
    
    await event.save();
    
    return event;
  } else {
    // Simulate failure
    const error = 'Mock provider: Simulated network error';
    return await exports.markFailed(event, error);
  }
};

/**
 * Mark message as failed with exponential backoff
 * @param {Object} event - Message event
 * @param {string} errorMessage - Error description
 * @returns {Promise<Object>} Updated event
 */
exports.markFailed = async (event, errorMessage) => {
  const now = new Date();

  event.status = 'FAILED';
  event.lastError = errorMessage;
  event.lockUntil = null; // Clear lease

  // Check if we should retry
  if (event.attemptCount < event.maxAttempts) {
    // Exponential backoff: 2^attemptCount minutes, max 60 minutes
    const backoffMinutes = Math.min(Math.pow(2, event.attemptCount), 60);
    event.nextAttemptAt = new Date(now.getTime() + backoffMinutes * 60 * 1000);
  } else {
    // Max attempts reached - no more retries
    event.nextAttemptAt = null;
  }

  await event.save();
  
  return event;
};

/**
 * Clear lease on message (for cleanup)
 * @param {string} eventId - Message event ID
 * @returns {Promise<Object>} Updated event
 */
exports.clearLease = async eventId => {
  return await MessageEvent.findByIdAndUpdate(
    eventId,
    {$unset: {lockUntil: 1}},
    {new: true},
  );
};

/**
 * Retry a failed message (manual)
 * @param {string} eventId - Message event ID
 * @returns {Promise<Object>} Updated event
 */
exports.retryMessage = async eventId => {
  const event = await MessageEvent.findById(eventId);
  
  if (!event) {
    throw new Error('Message event not found');
  }

  // Can only retry FAILED messages
  if (event.status !== 'FAILED') {
    throw new Error(`Cannot retry message with status: ${event.status}`);
  }

  // Reset for retry
  event.status = 'QUEUED';
  event.nextAttemptAt = new Date();
  event.lastError = null;
  event.lockUntil = null;

  await event.save();
  
  return event;
};
