/**
 * Settings routes
 */
const express = require('express');
const router = express.Router();
const {protect} = require('../middleware/auth.middleware');
const {validate} = require('../middleware/validate.middleware');
const {updateSettingsSchema} = require('../validators/settings.validator');
const {getSettings, updateSettings} = require('../controllers/settings.controller');

// All routes are protected
router.use(protect);

// GET /api/settings - Get settings (auto-create if missing)
router.get('/', getSettings);

// PUT /api/settings - Update settings (partial)
router.put('/', validate(updateSettingsSchema), updateSettings);

module.exports = router;
