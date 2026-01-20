/**
 * Customer routes
 */
const express = require('express');
const {
  getCustomers,
  createCustomer,
  updateCustomer,
  getCustomerTimeline,
  deleteCustomer,
} = require('../controllers/customer.controller');
const {getCustomerNotifications} = require('../controllers/notification.controller');
const {
  updateCustomerCreditPolicy,
  getCustomerCreditPolicy,
  getCustomerAudit,
} = require('../controllers/creditPolicy.controller');
const {getCustomerInterest} = require('../controllers/insights.controller');
const {requireOwner} = require('../middleware/permission.middleware');
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  createCustomerSchema,
  updateCustomerSchema,
} = require('../validators/customer.validator');

const router = express.Router();

router.use(protect);

router.route('/').get(getCustomers).post(validate(createCustomerSchema), createCustomer);

router.route('/:id')
  .put(validateObjectId('id'), validate(updateCustomerSchema), updateCustomer)
  .delete(validateObjectId('id'), requireOwner, deleteCustomer);

router.route('/:id/timeline').get(validateObjectId('id'), getCustomerTimeline);

router.route('/:id/notifications').get(validateObjectId('id'), getCustomerNotifications);

// Credit policy routes (Step 4: Hard Control)
router.route('/:id/credit-policy')
  .get(validateObjectId('id'), getCustomerCreditPolicy)
  .patch(validateObjectId('id'), updateCustomerCreditPolicy);

router.route('/:id/audit').get(validateObjectId('id'), getCustomerAudit);

// Interest route (Step 8: Interest Calculation)
router.route('/:id/interest').get(validateObjectId('id'), getCustomerInterest);

module.exports = router;
