/**
 * Follow-up routes
 */
const express = require('express');
const {validate} = require('../middleware/validate.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
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

// List all tasks (optional: filter by customerId via query param)
router.get('/', listAllTasks);

// Get specific customer's tasks
router.get('/:customerId', validateObjectId('customerId'), getCustomerTasks);

router.post('/', validate(createTaskSchema), createTask);
router.post('/auto-generate', validate(autoGenerateSchema), autoGenerateFollowups);

module.exports = router;
