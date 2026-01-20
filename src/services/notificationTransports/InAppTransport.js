/**
 * In-App Transport
 * 
 * "Sends" notifications by marking them as delivered
 * In-app notifications are already stored in Notification model
 * This transport just confirms delivery
 */
const BaseTransport = require('./BaseTransport');
const logger = require('../../utils/logger');

class InAppTransport extends BaseTransport {
  async send({notification, attempt, user, customer}) {
    logger.debug('[InAppTransport] Delivering notification', {
      notificationId: notification._id,
      userId: user._id,
      customerId: customer?._id,
      title: notification.title,
    });
    
    // In-app notifications are "delivered" by virtue of being stored
    // Just return success
    return {
      ok: true,
      providerMessageId: `in_app_${notification._id}`,
    };
  }
  
  getName() {
    return 'InAppTransport';
  }
}

module.exports = InAppTransport;
