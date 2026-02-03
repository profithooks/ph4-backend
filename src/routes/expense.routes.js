const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {createExpenseSchema, updateExpenseSchema} = require('../validators/expense.validator');
const controller = require('../controllers/expense.controller');

router.use(protect);

router.post('/', validate(createExpenseSchema), controller.createOrUpsert);
router.get('/', controller.list);
router.patch('/:id', validateObjectId('id'), validate(updateExpenseSchema), controller.update);
router.delete('/:id', validateObjectId('id'), controller.remove);

module.exports = router;
