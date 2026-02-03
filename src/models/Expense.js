const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema(
  {
    businessId: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true},
    clientId: {type: String, required: true},
    amount: {type: Number, required: true, min: 0.01},
    category: {type: String, default: 'General'},
    spentAt: {type: Date, required: true},
    note: {type: String},
    paymentMode: {type: String, enum: ['cash', 'upi', 'card', 'bank', 'other', null], default: null},
    vendor: {type: String},
    tags: [{type: String}],
  },
  {timestamps: true}
);

ExpenseSchema.index({businessId: 1, spentAt: -1});
ExpenseSchema.index({businessId: 1, clientId: 1}, {unique: true});

module.exports = mongoose.model('Expense', ExpenseSchema);
