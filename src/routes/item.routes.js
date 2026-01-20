const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  createItemSchema,
  updateItemSchema,
  upsertItemSchema,
} = require('../validators/item.validator');
const {
  listItems,
  getItem,
  createItem,
  upsertItem,
  updateItem,
  deleteItem,
} = require('../controllers/item.controller');

// All item routes require authentication
router.use(protect);

// Item CRUD
router.get('/', listItems);
router.post('/', validate(createItemSchema), createItem);
router.post('/upsert', validate(upsertItemSchema), upsertItem); // Must come before /:id
router.get('/:id', validateObjectId('id'), getItem);
router.patch('/:id', validateObjectId('id'), validate(updateItemSchema), updateItem);
router.delete('/:id', validateObjectId('id'), deleteItem);

module.exports = router;
