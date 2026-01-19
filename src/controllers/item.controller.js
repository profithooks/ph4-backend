const Item = require('../models/Item');
const AppError = require('../utils/AppError');

/**
 * List items with search and pagination
 * GET /api/items?search=&limit=20&cursor=
 */
exports.listItems = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {search, limit = 20, cursor} = req.query;

    const pageLimit = Math.min(parseInt(limit, 10), 100);

    // Build filter
    const filter = {userId, isActive: true};

    // Search filter
    if (search && search.trim()) {
      const searchTerm = search.trim();
      // Use regex for prefix matching (faster than text search for short queries)
      filter.name = {$regex: new RegExp('^' + searchTerm, 'i')};
    }

    // Cursor pagination
    if (cursor) {
      filter._id = {$lt: cursor};
    }

    // Query items
    const items = await Item.find(filter)
      .select('_id name defaultPrice createdAt')
      .sort({createdAt: -1, _id: -1})
      .limit(pageLimit + 1)
      .lean();

    // Check if there are more results
    const hasMore = items.length > pageLimit;
    const results = hasMore ? items.slice(0, pageLimit) : items;

    // Generate next cursor
    const nextCursor = hasMore ? results[results.length - 1]._id : null;

    res.status(200).json({
      success: true,
      data: results,
      nextCursor,
      hasMore,
      count: results.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single item by ID
 * GET /api/items/:id
 */
exports.getItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {id} = req.params;

    const item = await Item.findOne({_id: id, userId}).lean();

    if (!item) {
      throw new AppError('Item not found', 404, 'NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new item
 * POST /api/items
 */
exports.createItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {name, defaultPrice} = req.body;

    // Validation
    if (!name || !name.trim()) {
      throw new AppError('Item name is required', 400, 'VALIDATION_ERROR');
    }

    if (defaultPrice !== undefined && defaultPrice !== null) {
      if (typeof defaultPrice !== 'number' || defaultPrice < 0) {
        throw new AppError('Default price must be a non-negative number', 400, 'VALIDATION_ERROR');
      }
    }

    // Create item (will fail if duplicate due to unique index)
    const item = await Item.create({
      userId,
      name: name.trim(),
      defaultPrice: defaultPrice !== undefined && defaultPrice !== null ? defaultPrice : null,
    });

    res.status(201).json({
      success: true,
      data: item,
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      throw new AppError('Item with this name already exists', 409, 'DUPLICATE_ITEM');
    }
    next(error);
  }
};

/**
 * Upsert item by name (find or create)
 * POST /api/items/upsert
 */
exports.upsertItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {name, defaultPrice} = req.body;

    // Validation
    if (!name || !name.trim()) {
      throw new AppError('Item name is required', 400, 'VALIDATION_ERROR');
    }

    if (defaultPrice !== undefined && defaultPrice !== null) {
      if (typeof defaultPrice !== 'number' || defaultPrice < 0) {
        throw new AppError('Default price must be a non-negative number', 400, 'VALIDATION_ERROR');
      }
    }

    // Use the static upsert method
    const item = await Item.upsertByName(
      userId,
      name.trim(),
      defaultPrice !== undefined && defaultPrice !== null ? defaultPrice : null
    );

    res.status(200).json({
      success: true,
      data: item,
      created: item.createdAt.getTime() === item.updatedAt.getTime(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update item
 * PATCH /api/items/:id
 */
exports.updateItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {id} = req.params;
    const {name, defaultPrice, isActive} = req.body;

    const item = await Item.findOne({_id: id, userId});

    if (!item) {
      throw new AppError('Item not found', 404, 'NOT_FOUND');
    }

    // Update fields
    if (name !== undefined && name.trim()) {
      item.name = name.trim();
    }

    if (defaultPrice !== undefined) {
      if (defaultPrice === null) {
        item.defaultPrice = null;
      } else if (typeof defaultPrice === 'number' && defaultPrice >= 0) {
        item.defaultPrice = defaultPrice;
      } else {
        throw new AppError('Default price must be a non-negative number or null', 400, 'VALIDATION_ERROR');
      }
    }

    if (isActive !== undefined) {
      item.isActive = Boolean(isActive);
    }

    await item.save();

    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    // Handle duplicate key error on name update
    if (error.code === 11000) {
      throw new AppError('Item with this name already exists', 409, 'DUPLICATE_ITEM');
    }
    next(error);
  }
};

/**
 * Delete (soft delete) item
 * DELETE /api/items/:id
 */
exports.deleteItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {id} = req.params;

    const item = await Item.findOne({_id: id, userId});

    if (!item) {
      throw new AppError('Item not found', 404, 'NOT_FOUND');
    }

    // Soft delete
    item.isActive = false;
    await item.save();

    res.status(200).json({
      success: true,
      data: item,
      message: 'Item deactivated',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listItems: exports.listItems,
  getItem: exports.getItem,
  createItem: exports.createItem,
  upsertItem: exports.upsertItem,
  updateItem: exports.updateItem,
  deleteItem: exports.deleteItem,
};
