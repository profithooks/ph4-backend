/**
 * Recovery routes
 */
const express = require('express');
const recoveryController = require('../controllers/recovery.controller');
const escalationController = require('../controllers/escalation.controller');
const {protect} = require('../middleware/auth.middleware');
const {checkWriteLimit} = require('../middleware/writeLimit.middleware');
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  openCaseSchema,
  setPromiseSchema,
  updateStatusSchema,
  autoKeepPromiseSchema,
  escalatePromiseSchema,
} = require('../validators/recovery.validator');

const router = express.Router();

// Debug: log exported functions
console.log('Recovery controller exports:', Object.keys(recoveryController));

router.use(protect);

// READ endpoints - no write limit
router.get('/', recoveryController.listRecoveryCases);
router.get('/:customerId', validateObjectId('customerId'), recoveryController.getRecoveryCase);

// WRITE endpoints - enforce daily limit for free users
router.post('/open', checkWriteLimit, validate(openCaseSchema), recoveryController.openCase);
router.post('/promise', checkWriteLimit, validate(setPromiseSchema), recoveryController.setPromise);
router.post('/status', checkWriteLimit, validate(updateStatusSchema), recoveryController.updateStatus);
router.post('/auto-keep', checkWriteLimit, validate(autoKeepPromiseSchema), recoveryController.autoKeepPromise);

// Escalation endpoint - write operation
router.post('/:caseId/escalate', validateObjectId('caseId'), checkWriteLimit, validate(escalatePromiseSchema), escalationController.escalatePromise);

module.exports = router;
