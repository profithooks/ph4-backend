/**
 * Customer model
 */
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Please provide customer name'],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for common queries
customerSchema.index({userId: 1, createdAt: -1}); // List customers (most recent first)
customerSchema.index({userId: 1, name: 1}); // Search by name
customerSchema.index({userId: 1, phone: 1}); // Search by phone

// Text index for search functionality
customerSchema.index({name: 'text', phone: 'text'});

// Index creation logging
customerSchema.on('index', (error) => {
  if (error) {
    console.error('[Customer] Index build error:', error);
  } else {
    console.log('[Customer] Indexes built successfully');
  }
});

module.exports = mongoose.model('Customer', customerSchema);
