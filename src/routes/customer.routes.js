/**
 * Customer routes
 */
const express = require('express');
const multer = require('multer');
const {
  getCustomers,
  createCustomer,
  updateCustomer,
  getCustomerTimeline,
  deleteCustomer,
  importCustomersFromCSV,
  validateCustomersCSV,
} = require('../controllers/customer.controller');
const {getCustomerNotifications} = require('../controllers/notification.controller');
const {
  updateCustomerCreditPolicy,
  getCustomerCreditPolicy,
  getCustomerAudit,
} = require('../controllers/creditPolicy.controller');
const {getCustomerInterest} = require('../controllers/insights.controller');
const {requireOwner} = require('../middleware/permission.middleware');
const {protect} = require('../middleware/auth.middleware');
const {checkWriteLimit} = require('../middleware/writeLimit.middleware');
const {validate} = require('../middleware/validation.middleware');
const {validateObjectId} = require('../middleware/validateObjectId.middleware');
const {
  createCustomerSchema,
  updateCustomerSchema,
} = require('../validators/customer.validator');

const router = express.Router();

// Multer configuration for CSV file uploads
const upload = multer({
  storage: multer.memoryStorage(), // Store in memory as buffer
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept CSV and text files
    if (
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'text/plain' ||
      file.originalname.endsWith('.csv')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
});

router.use(protect);

// Customer import routes (must come before /:id routes)
router.post('/import', upload.single('file'), importCustomersFromCSV);
router.post('/import/validate', upload.single('file'), validateCustomersCSV);

// GET: read-only, no write limit
// POST: write operation, enforce limit
router.route('/')
  .get(getCustomers)
  .post(checkWriteLimit, validate(createCustomerSchema), createCustomer);

// PUT/DELETE: write operations, enforce limit
router.route('/:id')
  .put(validateObjectId('id'), checkWriteLimit, validate(updateCustomerSchema), updateCustomer)
  .delete(validateObjectId('id'), requireOwner, checkWriteLimit, deleteCustomer);

router.route('/:id/timeline').get(validateObjectId('id'), getCustomerTimeline);

router.route('/:id/notifications').get(validateObjectId('id'), getCustomerNotifications);

// Credit policy routes (Step 4: Hard Control)
router.route('/:id/credit-policy')
  .get(validateObjectId('id'), getCustomerCreditPolicy)
  .patch(validateObjectId('id'), updateCustomerCreditPolicy);

router.route('/:id/audit').get(validateObjectId('id'), getCustomerAudit);

// Interest route (Step 8: Interest Calculation)
router.route('/:id/interest').get(validateObjectId('id'), getCustomerInterest);

module.exports = router;
