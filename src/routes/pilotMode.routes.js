/**
 * Pilot Mode Routes
 * 
 * Step 17: Launch Readiness - Local Pilot Mode
 */
const express = require('express');
const router = express.Router();
const { togglePilotMode, getPilotChecklist } = require('../controllers/pilotMode.controller');
const { protect } = require('../middleware/auth.middleware');
const { requireOwner } = require('../middleware/permission.middleware');

// Toggle pilot mode (owner only)
router.patch('/settings/pilot-mode', protect, requireOwner, togglePilotMode);

// Get pilot checklist
router.get('/pilot/checklist', protect, getPilotChecklist);

module.exports = router;
