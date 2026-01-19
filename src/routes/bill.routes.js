const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validate.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  createBillSchema,
  addPaymentSchema,
  cancelBillSchema,
} = require('../validators/bill.validator');
const {
  createBill,
  listBills,
  getBillsSummary,
  getBill,
  addBillPayment,
  cancelBill,
} = require('../controllers/bill.controller');

// All bill routes require authentication
router.use(protect);

// Bill CRUD
router.post('/', validate(createBillSchema), createBill);
router.get('/', listBills);
router.get('/summary', getBillsSummary); // Must come before /:id
router.get('/:id', validateObjectId('id'), getBill);

// Bill actions
router.patch('/:id/pay', validateObjectId('id'), validate(addPaymentSchema), addBillPayment);
router.patch('/:id/cancel', validateObjectId('id'), validate(cancelBillSchema), cancelBill);

module.exports = router;
