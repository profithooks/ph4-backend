const mongoose = require('mongoose');

/**
 * Item Model - Catalog of items/products for bills
 * Scoped by userId (businessId)
 */
const itemSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    defaultPrice: {
      type: Number,
      default: null,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index: one item name per business
itemSchema.index({userId: 1, normalizedName: 1}, {unique: true});

// Index for queries
itemSchema.index({userId: 1, createdAt: -1});

// Text index for search (optional but recommended for better search)
itemSchema.index({name: 'text'});

// Normalize name before saving
itemSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    // Normalize: lowercase, trim, collapse multiple spaces
    this.normalizedName = this.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }
  next();
});

/**
 * Static method: Upsert item by normalized name
 * @param {ObjectId} userId - Business/user ID
 * @param {String} name - Item name
 * @param {Number} defaultPrice - Optional default price
 * @returns {Object} - Item document
 */
itemSchema.statics.upsertByName = async function (userId, name, defaultPrice = null) {
  const normalizedName = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

  // Try to find existing item
  let item = await this.findOne({userId, normalizedName});

  if (item) {
    // Item exists
    // Only update defaultPrice if it's currently null and a price is provided
    if (item.defaultPrice === null && defaultPrice !== null) {
      item.defaultPrice = defaultPrice;
      await item.save();
    }
    return item;
  }

  // Create new item
  item = await this.create({
    userId,
    name: name.trim(),
    normalizedName,
    defaultPrice: defaultPrice !== null ? defaultPrice : null,
  });

  return item;
};

// Index creation logging
itemSchema.on('index', (error) => {
  if (error) {
    console.error('[Item] Index build error:', error);
  } else {
    console.log('[Item] Indexes built successfully');
  }
});

const Item = mongoose.model('Item', itemSchema);

module.exports = Item;
