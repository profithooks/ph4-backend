/**
 * Ledger routes
 */
const express = require('express');
const {
  getCustomerTransactions,
  addCredit,
  addDebit,
} = require('../controllers/ledger.controller');
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  addCreditSchema,
  addDebitSchema,
} = require('../validators/ledger.validator');

const router = express.Router();

// Guard: Ensure all handlers are functions
const handlers = {getCustomerTransactions, addCredit, addDebit};
Object.entries(handlers).forEach(([name, fn]) => {
  if (typeof fn !== 'function') {
    throw new Error(
      `Route handler "${name}" is undefined in ledger.controller.js`,
    );
  }
});

router.use(protect);

router.get('/:customerId', validateObjectId('customerId'), getCustomerTransactions);
router.post('/credit', validate(addCreditSchema), addCredit);
router.post('/debit', validate(addDebitSchema), addDebit);

module.exports = router;
