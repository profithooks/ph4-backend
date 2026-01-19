/**
 * Customer controller
 */
const asyncHandler = require('express-async-handler');
const Customer = require('../models/Customer');
const AttemptLog = require('../models/AttemptLog');
const RecoveryCase = require('../models/RecoveryCase');
const RecoveryEvent = require('../models/RecoveryEvent');
const MessageEvent = require('../models/MessageEvent');
const Bill = require('../models/Bill');
const LedgerTransaction = require('../models/LedgerTransaction');
const FollowUpTask = require('../models/FollowUpTask');
const AppError = require('../utils/AppError');

// @desc    Get all customers
// @route   GET /api/customers
// @access  Private
const getCustomers = asyncHandler(async (req, res) => {
  const customers = await Customer.find({userId: req.user._id}).sort({
    createdAt: 1,
  });

  res.json({
    success: true,
    data: customers,
  });
});

// @desc    Create customer
// @route   POST /api/customers
// @access  Private
const createCustomer = asyncHandler(async (req, res) => {
  const {name, phone} = req.body;

  if (!name) {
    throw new AppError('Please provide customer name', 400, 'MISSING_NAME');
  }

  const customer = await Customer.create({
    userId: req.user._id,
    name: name.trim(),
    phone: phone ? phone.trim() : '',
  });

  res.status(201).json({
    success: true,
    data: customer,
  });
});

// @desc    Update customer
// @route   PUT /api/customers/:id
// @access  Private
const updateCustomer = asyncHandler(async (req, res) => {
  let customer = await Customer.findById(req.params.id);

  if (!customer) {
    throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  }

  // Verify ownership
  if (customer.userId.toString() !== req.user._id.toString()) {
    throw new AppError('Not authorized', 403, 'NOT_AUTHORIZED');
  }

  customer = await Customer.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  res.json({
    success: true,
    data: customer,
  });
});

// @desc    Get customer timeline (unified audit/proof view)
// @route   GET /api/customers/:id/timeline?limit=100
// @access  Private
const getCustomerTimeline = asyncHandler(async (req, res) => {
  const {id: customerId} = req.params;
  const limit = parseInt(req.query.limit, 10) || 100;

  // Verify customer exists and belongs to user
  const customer = await Customer.findOne({
    _id: customerId,
    userId: req.user._id,
  });

  if (!customer) {
    throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  }

  // Fetch events from all sources in parallel
  const [
    bills,
    ledgerTransactions,
    followUpTasks,
    attemptLogs,
    recoveryCases,
    messageEvents,
  ] = await Promise.all([
    // Bills
    Bill.find({
      userId: req.user._id,
      customerId,
    })
      .sort({createdAt: -1})
      .limit(limit)
      .lean(),

    // Ledger transactions (payments/credits)
    LedgerTransaction.find({
      userId: req.user._id,
      customerId,
    })
      .sort({createdAt: -1})
      .limit(limit)
      .lean(),

    // FollowUp tasks
    FollowUpTask.find({
      userId: req.user._id,
      customerId,
    })
      .sort({createdAt: -1})
      .limit(limit)
      .lean(),

    // AttemptLog
    AttemptLog.find({
      userId: req.user._id,
      customerId,
    })
      .sort({createdAt: -1})
      .limit(limit)
      .lean(),

    // RecoveryCase - needed to join with RecoveryEvent
    RecoveryCase.find({
      userId: req.user._id,
      customerId,
    })
      .select('_id')
      .lean(),

    // MessageEvent
    MessageEvent.find({
      userId: req.user._id,
      customerId,
    })
      .sort({createdAt: -1})
      .limit(limit)
      .lean(),
  ]);

  // Extract caseIds for RecoveryEvent query
  const caseIds = recoveryCases.map(c => c._id);

  // Fetch RecoveryEvents for these cases
  const recoveryEvents = caseIds.length > 0
    ? await RecoveryEvent.find({
        userId: req.user._id,
        caseId: {$in: caseIds},
      })
        .sort({createdAt: -1})
        .limit(limit)
        .lean()
    : [];

  // Normalize all events to common shape: {at (ms), type, title, subtitle, meta}
  const timeline = [];

  // Add Bill events
  bills.forEach(bill => {
    timeline.push({
      at: new Date(bill.createdAt).getTime(),
      type: 'BILL_CREATED',
      title: `Bill #${bill.billNo} created`,
      subtitle: `₹${bill.grandTotal} - ${bill.status}`,
      meta: {
        billId: bill._id,
        amount: bill.grandTotal,
        paidAmount: bill.paidAmount,
        status: bill.status,
        itemCount: bill.items?.length || 0,
      },
    });
  });

  // Add Ledger transaction events
  ledgerTransactions.forEach(txn => {
    const isPayment = txn.type === 'debit';
    timeline.push({
      at: new Date(txn.createdAt).getTime(),
      type: isPayment ? 'PAYMENT_RECEIVED' : 'CREDIT_ADDED',
      title: isPayment ? 'Payment received' : 'Credit added',
      subtitle: `₹${txn.amount}${txn.note ? ' - ' + txn.note : ''}`,
      meta: {
        txnId: txn._id,
        amount: txn.amount,
        txnType: txn.type,
        note: txn.note,
        source: txn.source,
      },
    });
  });

  // Add FollowUp task events
  followUpTasks.forEach(task => {
    let eventType = 'FOLLOWUP_CREATED';
    let title = 'Follow-up created';
    
    if (task.status === 'done' || task.status === 'DONE') {
      eventType = 'FOLLOWUP_DONE';
      title = 'Follow-up completed';
    } else if (task.status === 'snoozed' || task.status === 'SNOOZED') {
      eventType = 'FOLLOWUP_SNOOZED';
      title = 'Follow-up snoozed';
    }
    
    timeline.push({
      at: new Date(task.createdAt).getTime(),
      type: eventType,
      title,
      subtitle: task.title || task.note || `${task.channel || 'Follow-up'} task`,
      meta: {
        taskId: task._id,
        status: task.status,
        channel: task.channel,
        dueAt: task.dueAt,
        title: task.title,
        note: task.note,
      },
    });
  });

  // Add AttemptLog events
  attemptLogs.forEach(log => {
    timeline.push({
      at: new Date(log.createdAt).getTime(),
      type: 'CONTACT_ATTEMPT',
      title: `${log.channel} - ${log.outcome}`,
      subtitle: log.note || `Attempted ${log.channel.toLowerCase()} contact`,
      meta: {
        attemptId: log._id,
        channel: log.channel,
        outcome: log.outcome,
        note: log.note,
        promiseAt: log.promiseAt,
        entityType: log.entityType,
        entityId: log.entityId,
      },
    });
  });

  // Add RecoveryEvent events
  recoveryEvents.forEach(event => {
    let eventType = 'RECOVERY_EVENT';
    let title = 'Recovery event';
    let subtitle = '';
    
    if (event.type === 'PROMISE') {
      eventType = 'PROMISE_SET';
      title = 'Promise set';
      const promiseAt = event.payload?.promiseAt;
      subtitle = promiseAt 
        ? `Due ${new Date(promiseAt).toLocaleDateString()}` 
        : 'Payment promised';
    } else if (event.type === 'STATUS') {
      eventType = 'RECOVERY_STATUS_CHANGED';
      const newStatus = event.payload?.newStatus;
      title = `Status: ${newStatus || 'unknown'}`;
      subtitle = event.payload?.reason || 'Recovery status updated';
    }

    timeline.push({
      at: new Date(event.createdAt).getTime(),
      type: eventType,
      title,
      subtitle,
      meta: {
        eventId: event._id,
        eventType: event.type,
        caseId: event.caseId,
        payload: event.payload,
      },
    });
  });

  // Add MessageEvent events
  messageEvents.forEach(msg => {
    let eventType = 'MESSAGE_SENT';
    let statusEmoji = '';
    
    if (msg.status === 'DELIVERED') {
      eventType = 'MESSAGE_DELIVERED';
      statusEmoji = '✓';
    } else if (msg.status === 'FAILED') {
      eventType = 'MESSAGE_FAILED';
      statusEmoji = '✗';
    } else if (msg.status === 'SENT') {
      statusEmoji = '→';
    }
    
    timeline.push({
      at: new Date(msg.createdAt).getTime(),
      type: eventType,
      title: `${msg.channel} message ${statusEmoji}`,
      subtitle: `${msg.templateKey} - ${msg.status.toLowerCase()}`,
      meta: {
        messageId: msg._id,
        channel: msg.channel,
        templateKey: msg.templateKey,
        status: msg.status,
        payload: msg.payload,
      },
    });
  });

  // Sort by timestamp descending (ms)
  timeline.sort((a, b) => b.at - a.at);

  // Slice to limit
  const limitedTimeline = timeline.slice(0, limit);

  res.json({
    success: true,
    data: {
      customerId,
      customerName: customer.name,
      timeline: limitedTimeline,
      count: limitedTimeline.length,
    },
  });
});

module.exports = {
  getCustomers,
  createCustomer,
  updateCustomer,
  getCustomerTimeline,
};
