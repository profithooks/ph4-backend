/**
 * Promise Routes
 * 
 * Promise management (create/update/cancel)
 * Step 6: Recovery Engine (Cash Return)
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  createCustomerPromise,
  updatePromise,
  getCustomerPromise,
} = require('../controllers/promise.controller');

// All routes require authentication
router.use(protect);

/**
 * @route   POST /api/v1/customers/:id/promise
 * @desc    Create or update promise for customer
 * @body    {amount, dueAt, note?}
 * @access  Private
 */
router.post('/customers/:id/promise', validateObjectId('id'), createCustomerPromise);

/**
 * @route   GET /api/v1/customers/:id/promise
 * @desc    Get customer's active promise
 * @access  Private
 */
router.get('/customers/:id/promise', validateObjectId('id'), getCustomerPromise);

/**
 * @route   PATCH /api/v1/promises/:id
 * @desc    Update promise
 * @body    {amount?, dueAt?, note?, status?('ACTIVE'|'CANCELLED')}
 * @access  Private
 */
router.patch('/promises/:id', validateObjectId('id'), updatePromise);

module.exports = router;
