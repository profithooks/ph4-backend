/**
 * Customer Import Smoke Test
 * 
 * Tests the customer import functionality locally
 * 
 * Usage:
 *   node scripts/import-customers-smoke.js
 */

const mongoose = require('mongoose');
const Customer = require('../src/models/Customer');
const User = require('../src/models/User');
const { importCustomers, validateCSV } = require('../src/services/customerImport.service');

// Sample CSV data for testing
const SAMPLE_CSV = `name,mobile,email,address
John Doe,9876543210,john@example.com,123 Main St
Jane Smith,9876543211,jane@example.com,456 Oak Ave
Bob Wilson,9876543212,bob@example.com,789 Pine Rd
Alice Brown,9876543213,,101 Maple Dr
Charlie Davis,9876543214,charlie@example.com,
Test User,,test@example.com,Test Address
Invalid Email,9876543215,invalid-email,Some Address`;

const SAMPLE_CSV_WITH_DUPLICATES = `name,mobile,email,address
John Doe,9876543210,john@example.com,123 Main St
John Duplicate,9876543210,john2@example.com,456 Oak Ave
Jane Smith,9876543211,jane@example.com,789 Pine Rd`;

const SAMPLE_CSV_EMPTY = `name,mobile,email,address`;

const SAMPLE_CSV_INVALID = `name,mobile,email,address
,9876543210,john@example.com,123 Main St
Missing Name,9876543211,invalid-email-format,456 Oak Ave`;

// Database connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/ph4-test';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Create test user
const createTestUser = async () => {
  try {
    // Check if test user exists
    let testUser = await User.findOne({ email: 'test-import@example.com' });
    
    if (!testUser) {
      testUser = await User.create({
        name: 'Test Import User',
        email: 'test-import@example.com',
        password: 'testpass123',
        mobile: '+919999999999',
        planStatus: 'trial',
      });
      console.log('✅ Created test user:', testUser._id);
    } else {
      console.log('✅ Using existing test user:', testUser._id);
    }
    
    return testUser;
  } catch (error) {
    console.error('❌ Error creating test user:', error.message);
    throw error;
  }
};

// Clean up test data
const cleanupTestData = async (userId) => {
  try {
    // Delete all customers for test user
    const result = await Customer.deleteMany({ userId });
    console.log(`✅ Cleaned up ${result.deletedCount} test customers`);
  } catch (error) {
    console.error('❌ Error cleaning up:', error.message);
  }
};

// Test 1: Validate CSV format
const testValidateCSV = () => {
  console.log('\n📋 Test 1: Validate CSV Format');
  console.log('='.repeat(50));
  
  try {
    const result = validateCSV(SAMPLE_CSV);
    console.log('✅ CSV validation passed');
    console.log('   - Total rows:', result.rowCount);
    console.log('   - Valid:', result.valid);
    console.log('   - Preview rows:', result.previewRows.length);
    
    return true;
  } catch (error) {
    console.error('❌ CSV validation failed:', error.message);
    return false;
  }
};

// Test 2: Import valid CSV
const testImportValidCSV = async (userId) => {
  console.log('\n📋 Test 2: Import Valid CSV');
  console.log('='.repeat(50));
  
  try {
    const result = await importCustomers({
      userId,
      csvContent: SAMPLE_CSV,
      options: {
        skipDuplicates: true,
        updateDuplicates: false,
      },
    });
    
    console.log('✅ Import completed successfully');
    console.log('   - Total rows:', result.totalRows);
    console.log('   - Imported:', result.importedCount);
    console.log('   - Skipped:', result.skippedCount);
    console.log('   - Errors:', result.errorCount);
    
    if (result.errors.length > 0) {
      console.log('   - Error details:');
      result.errors.forEach(err => {
        console.log(`     Row ${err.rowIndex}: ${err.error}`);
      });
    }
    
    return result.importedCount > 0;
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    return false;
  }
};

// Test 3: Import with duplicates (skip)
const testImportWithDuplicates = async (userId) => {
  console.log('\n📋 Test 3: Import with Duplicates (Skip Mode)');
  console.log('='.repeat(50));
  
  try {
    const result = await importCustomers({
      userId,
      csvContent: SAMPLE_CSV_WITH_DUPLICATES,
      options: {
        skipDuplicates: true,
        updateDuplicates: false,
      },
    });
    
    console.log('✅ Import with duplicates completed');
    console.log('   - Total rows:', result.totalRows);
    console.log('   - Imported:', result.importedCount);
    console.log('   - Skipped:', result.skippedCount);
    console.log('   - Errors:', result.errorCount);
    
    if (result.skipped.length > 0) {
      console.log('   - Skipped details:');
      result.skipped.forEach(item => {
        console.log(`     Row ${item.rowIndex}: ${item.name} - ${item.reason}`);
      });
    }
    
    return result.skippedCount > 0;
  } catch (error) {
    console.error('❌ Duplicate handling failed:', error.message);
    return false;
  }
};

// Test 4: Import empty CSV (should fail gracefully)
const testImportEmptyCSV = async (userId) => {
  console.log('\n📋 Test 4: Import Empty CSV');
  console.log('='.repeat(50));
  
  try {
    await importCustomers({
      userId,
      csvContent: SAMPLE_CSV_EMPTY,
      options: {},
    });
    
    console.error('❌ Should have thrown error for empty CSV');
    return false;
  } catch (error) {
    if (error.code === 'EMPTY_CSV') {
      console.log('✅ Empty CSV correctly rejected');
      return true;
    } else {
      console.error('❌ Unexpected error:', error.message);
      return false;
    }
  }
};

// Test 5: Import invalid CSV (validation errors)
const testImportInvalidCSV = async (userId) => {
  console.log('\n📋 Test 5: Import Invalid CSV');
  console.log('='.repeat(50));
  
  try {
    const result = await importCustomers({
      userId,
      csvContent: SAMPLE_CSV_INVALID,
      options: {},
    });
    
    console.log('✅ Import completed with validation errors');
    console.log('   - Total rows:', result.totalRows);
    console.log('   - Imported:', result.importedCount);
    console.log('   - Errors:', result.errorCount);
    
    if (result.errors.length > 0) {
      console.log('   - Error details:');
      result.errors.forEach(err => {
        console.log(`     Row ${err.rowIndex}: ${err.error}`);
      });
    }
    
    return result.errorCount > 0;
  } catch (error) {
    console.error('❌ Invalid CSV handling failed:', error.message);
    return false;
  }
};

// Test 6: Verify imported customers in database
const testVerifyImportedCustomers = async (userId) => {
  console.log('\n📋 Test 6: Verify Imported Customers');
  console.log('='.repeat(50));
  
  try {
    const customers = await Customer.find({ userId, isDeleted: false });
    
    console.log('✅ Found customers in database:', customers.length);
    
    // Show first 3 customers
    customers.slice(0, 3).forEach(customer => {
      console.log(`   - ${customer.name} (${customer.phone || 'no phone'})`);
    });
    
    return customers.length > 0;
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    return false;
  }
};

// Main test runner
const runTests = async () => {
  console.log('\n🧪 Customer Import Smoke Tests');
  console.log('='.repeat(50));
  
  await connectDB();
  
  const testUser = await createTestUser();
  const userId = testUser._id;
  
  // Clean up before tests
  await cleanupTestData(userId);
  
  const results = {
    test1: testValidateCSV(),
    test2: await testImportValidCSV(userId),
    test3: await testImportWithDuplicates(userId),
    test4: await testImportEmptyCSV(userId),
    test5: await testImportInvalidCSV(userId),
    test6: await testVerifyImportedCustomers(userId),
  };
  
  // Summary
  console.log('\n📊 Test Summary');
  console.log('='.repeat(50));
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  console.log(`Passed: ${passed}/${total}`);
  
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test}`);
  });
  
  // Clean up after tests (optional - comment out to inspect data)
  // await cleanupTestData(userId);
  
  await mongoose.connection.close();
  console.log('\n✅ Tests completed and database connection closed');
  
  // Exit with appropriate code
  process.exit(passed === total ? 0 : 1);
};

// Run tests if executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('❌ Test runner error:', error);
    process.exit(1);
  });
}

module.exports = { runTests };
