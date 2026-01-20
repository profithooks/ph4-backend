const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validation.middleware');
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
  deleteBill,
} = require('../controllers/bill.controller');
const {requireOwner} = require('../middleware/permission.middleware');

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

// Bill deletion (owner only) - Step 5
router.delete('/:id', validateObjectId('id'), requireOwner, deleteBill);

module.exports = router;
