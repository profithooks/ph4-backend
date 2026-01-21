/**
 * Follow-up routes
 */
const express = require('express');
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {checkWriteLimit} = require('../middleware/writeLimit.middleware');
const {
  createTaskSchema,
  autoGenerateSchema,
} = require('../validators/followup.validator');
const {
  getCustomerTasks,
  listAllTasks,
  createTask,
  autoGenerateFollowups,
} = require('../controllers/followup.controller');
const {protect} = require('../middleware/auth.middleware');

const router = express.Router();

// Guard: Ensure all handlers are functions
const handlers = {getCustomerTasks, listAllTasks, createTask, autoGenerateFollowups};
Object.entries(handlers).forEach(([name, fn]) => {
  if (typeof fn !== 'function') {
    throw new Error(
      `Route handler "${name}" is undefined in followup.controller.js`,
    );
  }
});

router.use(protect);

// READ endpoints - no write limit
router.get('/', listAllTasks);
router.get('/:customerId', validateObjectId('customerId'), getCustomerTasks);

// WRITE endpoints - enforce daily limit for free users
router.post('/', checkWriteLimit, validate(createTaskSchema), createTask);
router.post('/auto-generate', checkWriteLimit, validate(autoGenerateSchema), autoGenerateFollowups);

module.exports = router;
