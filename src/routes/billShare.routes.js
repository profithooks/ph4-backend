const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {requirePro} = require('../middleware/requirePro.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  createBillShareLink,
  revokeBillShareLink,
} = require('../controllers/billShare.controller');

// All routes require authentication and Pro plan
router.use(protect);
router.use(requirePro);

// Create or get share link
router.post(
  '/:id/share-link',
  validateObjectId('id'),
  createBillShareLink,
);

// Revoke share link
router.delete(
  '/:id/share-link',
  validateObjectId('id'),
  revokeBillShareLink,
);

module.exports = router;
