/**
 * Ledger controllers
 */
const LedgerTransaction = require('../models/LedgerTransaction');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');

/**
 * Get idempotency key from request
 */
const getIdempotencyKey = req => {
  return req.header('Idempotency-Key') || req.body.idempotencyKey || null;
};

/**
 * @route   GET /api/ledger/:customerId
 * @desc    Get all transactions for a customer
 * @access  Private
 */
exports.getCustomerTransactions = async (req, res, next) => {
  try {
    const {customerId} = req.params;

    // Verify customer exists and belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      userId: req.user._id,
    });

    if (!customer) {
      return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    }

    const transactions = await LedgerTransaction.find({
      userId: req.user._id,
      customerId,
    }).sort({createdAt: -1});

    res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/ledger/credit
 * @desc    Add credit transaction (customer owes business)
 * @access  Private
 */
exports.addCredit = async (req, res, next) => {
  try {
    const {customerId, amount, note} = req.body;
    const idempotencyKey = getIdempotencyKey(req);
    const requestId = req.header('X-Request-Id') || 'NO_RID';
    const uid = req._reqUid || 'NO_UID';

    // Controller entry log (suppress in LOG_FIN_ONLY mode)
    if (process.env.LOG_FIN_ONLY !== 'true') {
      console.log(
        `CTRL uid=${uid} ledger credit rid=${requestId} idem=${idempotencyKey}`,
      );
    }

    // Validate
    if (!customerId || !amount) {
      return next(
        new AppError(
          'Customer ID and amount are required',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    if (amount <= 0) {
      return next(
        new AppError('Amount must be positive', 400, 'VALIDATION_ERROR'),
      );
    }

    if (!idempotencyKey) {
      console.warn(
        'Credit transaction without idempotency key - allowing but logging',
      );
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await LedgerTransaction.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existing) {
        console.log(
          `Idempotent credit request: ${idempotencyKey} - returning existing`,
        );
        return res.status(200).json({
          success: true,
          data: existing,
        });
      }
    }

    // Verify customer exists and belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      userId: req.user._id,
    });

    if (!customer) {
      return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    }

    // Create transaction
    const transaction = await LedgerTransaction.create({
      userId: req.user._id,
      customerId,
      type: 'credit',
      amount,
      note: note || '',
      source: 'manual',
      idempotencyKey: idempotencyKey || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    res.status(201).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    // Handle duplicate key error from unique index
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      // Race condition: fetch and return existing
      const idempotencyKey = getIdempotencyKey(req);
      const existing = await LedgerTransaction.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existing) {
        return res.status(200).json({
          success: true,
          data: existing,
        });
      }
    }

    next(error);
  }
};

/**
 * @route   POST /api/ledger/debit
 * @desc    Add debit transaction (customer paid business)
 * @access  Private
 */
exports.addDebit = async (req, res, next) => {
  try {
    const {customerId, amount, note} = req.body;
    const idempotencyKey = getIdempotencyKey(req);
    const requestId = req.header('X-Request-Id') || 'NO_RID';
    const uid = req._reqUid || 'NO_UID';

    // Controller entry log (suppress in LOG_FIN_ONLY mode)
    if (process.env.LOG_FIN_ONLY !== 'true') {
      console.log(
        `CTRL uid=${uid} ledger debit rid=${requestId} idem=${idempotencyKey}`,
      );
    }

    // Validate
    if (!customerId || !amount) {
      return next(
        new AppError(
          'Customer ID and amount are required',
          400,
          'VALIDATION_ERROR',
        ),
      );
    }

    if (amount <= 0) {
      return next(
        new AppError('Amount must be positive', 400, 'VALIDATION_ERROR'),
      );
    }

    if (!idempotencyKey) {
      console.warn(
        'Debit transaction without idempotency key - allowing but logging',
      );
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await LedgerTransaction.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existing) {
        console.log(
          `Idempotent debit request: ${idempotencyKey} - returning existing`,
        );
        return res.status(200).json({
          success: true,
          data: existing,
        });
      }
    }

    // Verify customer exists and belongs to user
    const customer = await Customer.findOne({
      _id: customerId,
      userId: req.user._id,
    });

    if (!customer) {
      return next(new AppError('Customer not found', 404, 'NOT_FOUND'));
    }

    // Create transaction
    const transaction = await LedgerTransaction.create({
      userId: req.user._id,
      customerId,
      type: 'debit',
      amount,
      note: note || '',
      source: 'manual',
      idempotencyKey: idempotencyKey || `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    res.status(201).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    // Handle duplicate key error from unique index
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      const idempotencyKey = getIdempotencyKey(req);
      const existing = await LedgerTransaction.findOne({
        userId: req.user._id,
        idempotencyKey,
      });

      if (existing) {
        return res.status(200).json({
          success: true,
          data: existing,
        });
      }
    }

    next(error);
  }
};
