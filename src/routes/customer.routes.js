/**
 * Customer routes
 */
const express = require('express');
const {
  getCustomers,
  createCustomer,
  updateCustomer,
  getCustomerTimeline,
} = require('../controllers/customer.controller');
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validate.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  createCustomerSchema,
  updateCustomerSchema,
} = require('../validators/customer.validator');

const router = express.Router();

router.use(protect);

router.route('/').get(getCustomers).post(validate(createCustomerSchema), createCustomer);

router.route('/:id').put(validateObjectId('id'), validate(updateCustomerSchema), updateCustomer);

router.route('/:id/timeline').get(validateObjectId('id'), getCustomerTimeline);

module.exports = router;
