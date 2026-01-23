/**
 * Firebase Push Transport
 * 
 * Sends push notifications via Firebase Cloud Messaging (FCM)
 * Only sends to trusted devices with valid FCM tokens
 */
const BaseTransport = require('./BaseTransport');
const Device = require('../../models/Device');
const NotificationAttempt = require('../../models/NotificationAttempt');
const {sendToTokens} = require('../push/fcmClient');
const logger = require('../../utils/logger');

class FirebasePushTransport extends BaseTransport {
  /**
   * Get title/body from notification or compute from kind
   * 
   * @param {Object} notification - Notification object
   * @returns {Object} { title, body }
   */
  _getTitleAndBody(notification) {
    // Prefer explicit title/body if present
    if (notification.title && notification.body) {
      return {
        title: notification.title,
        body: notification.body,
      };
    }

    // Fallback: compute from kind
    const kindTitles = {
      OVERDUE_ALERT: 'Overdue Payment',
      DUE_TODAY: 'Payment Due Today',
      PROMISE_DUE_TODAY: 'Promise Due Today',
      PROMISE_BROKEN: 'Promise Broken',
      FOLLOWUP_DUE: 'Follow-up Due',
      PAYMENT_RECEIVED: 'Payment Received',
      DEVICE_APPROVAL_REQUIRED: 'Device Approval Required',
      DAILY_SUMMARY: 'Daily Summary',
      CREDIT_LIMIT_WARN: 'Credit Limit Warning',
      // Legacy kinds (for backward compatibility)
      FOLLOWUP: 'Follow-up Reminder',
      PROMISE_REMINDER: 'Promise Reminder',
      OVERDUE: 'Overdue Payment',
      SYSTEM: 'System Notification',
      BILL_CREATED: 'Bill Created',
    };

    const title = kindTitles[notification.kind] || 'Notification';
    const body = notification.body || `You have a new ${notification.kind} notification`;

    return {title, body};
  }

  /**
   * Build FCM data payload from notification
   * Must match NOTIFICATIONS_SPEC.md schema
   * 
   * @param {Object} notification - Notification object
   * @returns {Object} Data payload
   */
  _buildDataPayload(notification) {
    const metadata = notification.metadata || {};
    
    // Extract entity info from metadata
    const entityId = metadata.billId || metadata.customerId || metadata.recoveryId || metadata.followupId || null;
    const entityType = metadata.billId ? 'bill' : 
                      (metadata.customerId || metadata.recoveryId || metadata.followupId) ? 'customer' : 
                      'system';
    
    // Build deeplink based on kind (matching NOTIFICATIONS_SPEC.md)
    let deeplink = 'ph4://today';
    if (metadata.customerId) {
      const customerId = String(metadata.customerId);
      
      if (notification.kind === 'OVERDUE_ALERT' || notification.kind === 'OVERDUE') {
        deeplink = `ph4://customer/${customerId}?tab=recovery`;
      } else if (notification.kind === 'PROMISE_DUE_TODAY' || notification.kind === 'PROMISE_BROKEN' || notification.kind === 'PROMISE_REMINDER') {
        deeplink = `ph4://customer/${customerId}?tab=promises`;
      } else if (notification.kind === 'FOLLOWUP_DUE' || notification.kind === 'FOLLOWUP') {
        deeplink = `ph4://customer/${customerId}?tab=followups`;
      } else if (notification.kind === 'CREDIT_LIMIT_WARN') {
        deeplink = `ph4://customer/${customerId}?tab=credit`;
      } else {
        deeplink = `ph4://customer/${customerId}`;
      }
    } else if (metadata.billId) {
      deeplink = `ph4://bill/${String(metadata.billId)}`;
    } else if (notification.kind === 'DUE_TODAY') {
      deeplink = 'ph4://today?filter=dueToday';
    } else if (notification.kind === 'DEVICE_APPROVAL_REQUIRED') {
      deeplink = 'ph4://security?tab=devices';
    }

    return {
      kind: notification.kind,
      entityType,
      entityId: entityId ? String(entityId) : 'system',
      customerId: metadata.customerId ? String(metadata.customerId) : null,
      billId: metadata.billId ? String(metadata.billId) : null,
      occurredAt: notification.createdAt ? new Date(notification.createdAt).toISOString() : new Date().toISOString(),
      idempotencyKey: notification.idempotencyKey || `${notification.kind}_${notification._id}`,
      deeplink,
    };
  }

  /**
   * Send notification via FCM
   * 
   * @param {Object} params
   * @param {Object} params.notification - Notification object
   * @param {Object} params.attempt - NotificationAttempt object
   * @param {Object} params.user - User object
   * @param {Object} params.customer - Customer object (optional)
   * @returns {Promise<Object>} { ok: true, providerMessageId }
   */
  async send({notification, attempt, user, customer}) {
    try {
      // Fetch trusted devices with FCM tokens
      const deviceQuery = {
        userId: user._id,
        fcmToken: {$ne: null, $exists: true},
      };

      // Trust logic: prefer status field if exists, else check isTrusted method, else conservative (all non-blocked)
      // Device model has status: 'TRUSTED', 'PENDING', 'BLOCKED'
      // We only send to TRUSTED devices
      deviceQuery.status = 'TRUSTED';

      const devices = await Device.find(deviceQuery).lean();

      if (devices.length === 0) {
        logger.debug('[FirebasePushTransport] No trusted devices with FCM tokens found', {
          userId: user._id,
          notificationId: notification._id,
        });

        // Return success but with no tokens (not an error, just no recipients)
        return {
          ok: true,
          providerMessageId: `fcm_no_tokens_${notification._id}`,
        };
      }

      const tokens = devices.map(d => d.fcmToken).filter(Boolean);

      if (tokens.length === 0) {
        logger.debug('[FirebasePushTransport] No valid FCM tokens found', {
          userId: user._id,
          deviceCount: devices.length,
        });

        return {
          ok: true,
          providerMessageId: `fcm_no_tokens_${notification._id}`,
        };
      }

      // Get title/body
      const {title, body} = this._getTitleAndBody(notification);

      // Build data payload
      const data = this._buildDataPayload(notification);

      // Send via FCM
      const result = await sendToTokens({
        tokens,
        title,
        body,
        data,
      });

      // Handle token cleanup (remove invalid tokens)
      const invalidTokens = result.responses
        .filter(r => !r.success && r.shouldRemoveToken)
        .map(r => r.token);

      if (invalidTokens.length > 0) {
        await Device.updateMany(
          {fcmToken: {$in: invalidTokens}},
          {
            $set: {
              fcmToken: null,
              fcmTokenUpdatedAt: null,
            },
          }
        );

        logger.info('[FirebasePushTransport] Cleaned up invalid FCM tokens', {
          invalidTokenCount: invalidTokens.length,
          userId: user._id,
        });
      }

      // Log attempt results
      // Store aggregated result in attempt if project logs per-channel
      // For now, we'll log success if at least one token succeeded
      const hasSuccess = result.successCount > 0;

      if (!hasSuccess && result.failureCount > 0) {
        // All failed - determine if retryable
        const allRetryable = result.responses.every(r => r.isRetryable);
        const firstError = result.responses[0];

        if (!allRetryable) {
          // Some are permanent failures (invalid tokens)
          // We've already cleaned them up, so mark as sent (partial success)
          // But log the error for visibility
          logger.warn('[FirebasePushTransport] All tokens failed, but some were invalid (cleaned up)', {
            notificationId: notification._id,
            failureCount: result.failureCount,
            errorCode: firstError?.errorCode,
          });

          // Return success since we handled the failures
          return {
            ok: true,
            providerMessageId: `fcm_all_failed_cleaned_${notification._id}`,
          };
        }

        // All failures are retryable - throw to trigger retry
        const error = new Error(`All FCM sends failed: ${firstError?.errorMessage || 'Unknown error'}`);
        error.code = firstError?.errorCode || 'FCM_SEND_FAILED';
        error.retryable = true;
        throw error;
      }

      // Success (at least one token succeeded)
      logger.info('[FirebasePushTransport] Notification sent successfully', {
        notificationId: notification._id,
        successCount: result.successCount,
        failureCount: result.failureCount,
        totalTokens: tokens.length,
      });

      // Create per-token attempt logs if needed (for detailed tracking)
      // For now, we'll just return aggregated success
      // The main attempt will be updated by the worker

      return {
        ok: true,
        providerMessageId: `fcm_${result.successCount}_success_${notification._id}`,
      };
    } catch (error) {
      logger.error('[FirebasePushTransport] Failed to send notification', {
        error: error.message,
        notificationId: notification._id,
        userId: user._id,
      });

      // Re-throw to let worker handle retry logic
      throw error;
    }
  }

  getName() {
    return 'FirebasePushTransport';
  }

  async isAvailable() {
    // Check if Firebase is configured
    const {isFirebaseConfigured} = require('../../config/firebase');
    return isFirebaseConfigured();
  }
}

module.exports = FirebasePushTransport;
