const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {requirePro} = require('../middleware/requirePro.middleware');
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

// ============================================================
// READ ENDPOINTS - All users can VIEW bills (read-only)
// ============================================================
router.get('/', listBills);
router.get('/summary', getBillsSummary); // Must come before /:id
router.get('/:id', validateObjectId('id'), getBill);

// ============================================================
// WRITE ENDPOINTS - Pro/Trial only, NO daily write counting
// (Bills don't count as "customer writes", they're Pro-gated)
// ============================================================

// Create bill - Pro/Trial only
router.post('/', requirePro, validate(createBillSchema), createBill);

// Bill actions - Pro/Trial only
router.patch('/:id/pay', validateObjectId('id'), requirePro, validate(addPaymentSchema), addBillPayment);
router.patch('/:id/cancel', validateObjectId('id'), requirePro, validate(cancelBillSchema), cancelBill);

// Bill deletion - Pro/Trial only + owner permission
router.delete('/:id', validateObjectId('id'), requireOwner, requirePro, deleteBill);

module.exports = router;
