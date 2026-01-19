/**
 * Message Delivery Worker
 * Processes queued messages in batches
 */
const {
  leaseNextBatch,
  deliverMock,
  clearLease,
} = require('../services/messageDelivery.service');

/**
 * Process one batch of messages
 * Safe for concurrent execution (uses lease mechanism)
 * @returns {Promise<Object>} Processing stats
 */
exports.runOnce = async () => {
  const startTime = Date.now();
  const stats = {
    leased: 0,
    delivered: 0,
    failed: 0,
    errors: 0,
  };

  try {
    // Lease next batch (max 20)
    const events = await leaseNextBatch(20);
    stats.leased = events.length;

    if (events.length === 0) {
      console.log('[MessageWorker] No messages to process');
      return stats;
    }

    console.log(`[MessageWorker] Processing ${events.length} messages`);

    // Process each message
    for (const event of events) {
      try {
        const result = await deliverMock(event);
        
        if (result.status === 'DELIVERED') {
          stats.delivered++;
        } else if (result.status === 'FAILED') {
          stats.failed++;
        }
      } catch (error) {
        console.error(
          `[MessageWorker] Error processing event ${event._id}:`,
          error.message,
        );
        stats.errors++;
        
        // Clear lease on error to allow retry
        try {
          await clearLease(event._id);
        } catch (clearError) {
          console.error(
            `[MessageWorker] Failed to clear lease for ${event._id}:`,
            clearError.message,
          );
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[MessageWorker] Batch complete in ${duration}ms:`,
      stats,
    );

    return stats;
  } catch (error) {
    console.error('[MessageWorker] Batch processing failed:', error);
    throw error;
  }
};
