/**
 * Customer Import Service
 * 
 * Handles CSV parsing, validation, and bulk customer creation
 */
const { parse } = require('csv-parse/sync');
const Customer = require('../models/Customer');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Parse CSV content into rows
 * @param {string|Buffer} csvContent - CSV file content
 * @returns {Array} - Parsed rows as array of objects
 */
const parseCSV = (csvContent) => {
  try {
    const records = parse(csvContent, {
      columns: true, // Use first row as column names
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // Allow rows with different column counts
      bom: true, // Handle UTF-8 BOM
    });
    
    return records;
  } catch (error) {
    logger.error('[CustomerImport] CSV parse error', { error: error.message });
    throw new AppError(
      `Failed to parse CSV: ${error.message}`,
      400,
      'CSV_PARSE_ERROR'
    );
  }
};

/**
 * Validate a single customer row
 * @param {Object} row - CSV row
 * @param {number} rowIndex - Row index (for error reporting)
 * @returns {Object} - { valid: boolean, customer: object, error: string }
 */
const validateCustomerRow = (row, rowIndex) => {
  const errors = [];
  
  // Required: name
  if (!row.name || typeof row.name !== 'string' || !row.name.trim()) {
    errors.push('Name is required');
  }
  
  // Optional: mobile/phone (accept both column names)
  const mobile = row.mobile || row.phone || '';
  
  // Optional: email
  const email = row.email || '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Invalid email format');
  }
  
  // Optional: address
  const address = row.address || '';
  
  // Optional: openingBalance (must be a number if provided)
  let openingBalance = 0;
  if (row.openingBalance || row.opening_balance) {
    const balanceStr = (row.openingBalance || row.opening_balance).toString().trim();
    if (balanceStr) {
      openingBalance = parseFloat(balanceStr);
      if (isNaN(openingBalance)) {
        errors.push('Opening balance must be a number');
      }
    }
  }
  
  // Optional: tags (comma-separated string or array)
  let tags = [];
  if (row.tags) {
    if (typeof row.tags === 'string') {
      tags = row.tags.split(',').map(t => t.trim()).filter(t => t);
    } else if (Array.isArray(row.tags)) {
      tags = row.tags;
    }
  }
  
  if (errors.length > 0) {
    return {
      valid: false,
      customer: null,
      error: errors.join(', '),
      rowIndex,
    };
  }
  
  return {
    valid: true,
    customer: {
      name: row.name.trim(),
      phone: mobile.trim(),
      email: email.trim(),
      address: address.trim(),
      openingBalance,
      tags,
    },
    error: null,
    rowIndex,
  };
};

/**
 * Check if customer already exists (dedupe by mobile)
 * @param {string} userId - User ID
 * @param {string} mobile - Mobile number
 * @returns {Promise<Customer|null>} - Existing customer or null
 */
const findExistingCustomer = async (userId, mobile) => {
  if (!mobile || !mobile.trim()) {
    return null;
  }
  
  // Normalize phone for comparison (remove spaces, dashes, etc.)
  const normalizedPhone = mobile.trim().replace(/[\s\-()]/g, '');
  
  if (!normalizedPhone) {
    return null;
  }
  
  // Check for exact match or normalized match
  const existing = await Customer.findOne({
    userId,
    isDeleted: false,
    $or: [
      { phone: mobile.trim() },
      { phone: normalizedPhone },
    ],
  });
  
  return existing;
};

/**
 * Import customers from CSV data
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string|Buffer} params.csvContent - CSV file content
 * @param {Object} params.options - Import options
 * @param {boolean} params.options.skipDuplicates - Skip duplicates (default: true)
 * @param {boolean} params.options.updateDuplicates - Update duplicates (default: false)
 * @param {number} params.options.previewLimit - Limit for preview rows (default: 10)
 * @returns {Promise<Object>} - Import report
 */
const importCustomers = async ({ userId, csvContent, options = {} }) => {
  const {
    skipDuplicates = true,
    updateDuplicates = false,
    previewLimit = 10,
  } = options;
  
  // Parse CSV
  const rows = parseCSV(csvContent);
  
  if (!rows || rows.length === 0) {
    throw new AppError('CSV file is empty', 400, 'EMPTY_CSV');
  }
  
  logger.info('[CustomerImport] Starting import', {
    userId,
    rowCount: rows.length,
    skipDuplicates,
    updateDuplicates,
  });
  
  const results = {
    totalRows: rows.length,
    imported: [],
    skipped: [],
    updated: [],
    errors: [],
    previewRows: [],
  };
  
  // Generate preview rows (first N rows)
  results.previewRows = rows.slice(0, previewLimit).map((row, idx) => ({
    rowIndex: idx + 1,
    name: row.name || '',
    phone: row.mobile || row.phone || '',
    email: row.email || '',
  }));
  
  // Process each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 1;
    
    try {
      // Validate row
      const validation = validateCustomerRow(row, rowIndex);
      
      if (!validation.valid) {
        results.errors.push({
          rowIndex,
          row: { name: row.name, phone: row.mobile || row.phone },
          error: validation.error,
        });
        continue;
      }
      
      const customerData = validation.customer;
      
      // Check for duplicates
      const existing = await findExistingCustomer(userId, customerData.phone);
      
      if (existing) {
        if (updateDuplicates) {
          // Update existing customer
          const updated = await Customer.findByIdAndUpdate(
            existing._id,
            {
              name: customerData.name,
              email: customerData.email,
              address: customerData.address,
              // Note: Don't update phone as it's the dedupe key
            },
            { new: true }
          );
          
          results.updated.push({
            rowIndex,
            customerId: updated._id,
            name: updated.name,
            phone: updated.phone,
          });
          
          logger.info('[CustomerImport] Customer updated', {
            customerId: updated._id,
            rowIndex,
          });
        } else {
          // Skip duplicate
          results.skipped.push({
            rowIndex,
            name: customerData.name,
            phone: customerData.phone,
            reason: 'Duplicate mobile number',
            existingCustomerId: existing._id,
          });
        }
        continue;
      }
      
      // Create new customer
      const newCustomer = await Customer.create({
        userId,
        name: customerData.name,
        phone: customerData.phone,
        email: customerData.email,
        address: customerData.address,
        // Note: openingBalance and tags not in current schema
        // They would need schema changes if required
      });
      
      results.imported.push({
        rowIndex,
        customerId: newCustomer._id,
        name: newCustomer.name,
        phone: newCustomer.phone,
      });
      
      logger.info('[CustomerImport] Customer created', {
        customerId: newCustomer._id,
        rowIndex,
      });
      
    } catch (error) {
      logger.error('[CustomerImport] Row processing error', {
        rowIndex,
        error: error.message,
      });
      
      results.errors.push({
        rowIndex,
        row: { name: row.name, phone: row.mobile || row.phone },
        error: error.message || 'Unknown error',
      });
    }
  }
  
  logger.info('[CustomerImport] Import completed', {
    userId,
    totalRows: results.totalRows,
    importedCount: results.imported.length,
    skippedCount: results.skipped.length,
    updatedCount: results.updated.length,
    errorCount: results.errors.length,
  });
  
  return {
    success: true,
    totalRows: results.totalRows,
    importedCount: results.imported.length,
    skippedCount: results.skipped.length,
    updatedCount: results.updated.length,
    errorCount: results.errors.length,
    imported: results.imported,
    skipped: results.skipped,
    updated: results.updated,
    errors: results.errors,
    previewRows: results.previewRows,
  };
};

/**
 * Validate CSV format without importing
 * @param {string|Buffer} csvContent - CSV file content
 * @returns {Object} - Validation report
 */
const validateCSV = (csvContent) => {
  try {
    const rows = parseCSV(csvContent);
    
    if (!rows || rows.length === 0) {
      return {
        valid: false,
        error: 'CSV file is empty',
        rowCount: 0,
        previewRows: [],
      };
    }
    
    // Check for required columns
    const firstRow = rows[0];
    const hasName = 'name' in firstRow;
    
    if (!hasName) {
      return {
        valid: false,
        error: 'CSV must have a "name" column',
        rowCount: rows.length,
        previewRows: [],
      };
    }
    
    // Validate first 10 rows
    const previewRows = [];
    const errors = [];
    
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const validation = validateCustomerRow(rows[i], i + 1);
      previewRows.push({
        rowIndex: i + 1,
        name: rows[i].name || '',
        phone: rows[i].mobile || rows[i].phone || '',
        valid: validation.valid,
        error: validation.error,
      });
      
      if (!validation.valid) {
        errors.push({
          rowIndex: i + 1,
          error: validation.error,
        });
      }
    }
    
    return {
      valid: errors.length === 0,
      rowCount: rows.length,
      previewRows,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message || 'Failed to parse CSV',
      rowCount: 0,
      previewRows: [],
    };
  }
};

module.exports = {
  parseCSV,
  validateCustomerRow,
  findExistingCustomer,
  importCustomers,
  validateCSV,
};
