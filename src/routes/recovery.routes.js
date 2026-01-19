/**
 * Recovery routes
 */
const express = require('express');
const recoveryController = require('../controllers/recovery.controller');
const escalationController = require('../controllers/escalation.controller');
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validate.middleware');
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

// List all recovery cases (optional: filter by customerId via query param)
router.get('/', recoveryController.listRecoveryCases);

// Get specific customer's active case
router.get('/:customerId', validateObjectId('customerId'), recoveryController.getRecoveryCase);

router.post('/open', validate(openCaseSchema), recoveryController.openCase);
router.post('/promise', validate(setPromiseSchema), recoveryController.setPromise);
router.post('/status', validate(updateStatusSchema), recoveryController.updateStatus);
router.post('/auto-keep', validate(autoKeepPromiseSchema), recoveryController.autoKeepPromise);

// Escalation endpoint
router.post('/:caseId/escalate', validateObjectId('caseId'), validate(escalatePromiseSchema), escalationController.escalatePromise);

module.exports = router;
