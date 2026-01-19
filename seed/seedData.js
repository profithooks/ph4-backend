/**
 * Seed script for PH4 - Creates test data for load testing
 * Usage: node seed/seedData.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Models
const User = require('../src/models/User');
const Customer = require('../src/models/Customer');
const Item = require('../src/models/Item');
const Bill = require('../src/models/Bill');
const LedgerTransaction = require('../src/models/LedgerTransaction');

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/ph4';

const SEED_CONFIG = {
  users: 10,
  customersPerUser: 50,
  itemsPerUser: 30,
  billsPerUser: 100,
  transactionsPerCustomer: 5,
};

async function connect() {
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function clearData() {
  console.log('\n🗑️  Clearing existing seed data...');
  
  // Only delete seed users and their data
  const seedUsers = await User.find({email: /^seed-/});
  const seedUserIds = seedUsers.map(u => u._id);
  
  if (seedUserIds.length > 0) {
    await Customer.deleteMany({userId: {$in: seedUserIds}});
    await Item.deleteMany({userId: {$in: seedUserIds}});
    await Bill.deleteMany({userId: {$in: seedUserIds}});
    await LedgerTransaction.deleteMany({userId: {$in: seedUserIds}});
    await User.deleteMany({_id: {$in: seedUserIds}});
    
    console.log(`   Deleted ${seedUserIds.length} seed users and their data`);
  }
}

async function createUsers() {
  console.log(`\n👤 Creating ${SEED_CONFIG.users} seed users...`);
  const users = [];
  
  for (let i = 1; i <= SEED_CONFIG.users; i++) {
    const user = await User.create({
      name: `Seed User ${i}`,
      email: `seed-user-${i}@example.com`,
      phone: `9900${String(i).padStart(6, '0')}`,
      password: 'Test123456!', // Will be hashed by model pre-save hook
    });
    
    users.push(user);
    
    if (i % 5 === 0) {
      console.log(`   Created ${i}/${SEED_CONFIG.users} users`);
    }
  }
  
  console.log(`✅ Created ${users.length} users`);
  return users;
}

async function createCustomersForUser(user, count) {
  const customers = [];
  const names = ['Rajesh', 'Priya', 'Amit', 'Neha', 'Vikram', 'Anjali', 'Rahul', 'Sneha', 'Karan', 'Pooja'];
  const businesses = ['Store', 'Shop', 'Traders', 'Mart', 'Enterprises', 'Services', 'Solutions'];
  
  for (let i = 1; i <= count; i++) {
    const name = `${names[i % names.length]} ${businesses[i % businesses.length]} ${i}`;
    const phone = `98${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
    
    const customer = await Customer.create({
      userId: user._id,
      name,
      phone,
      email: i % 3 === 0 ? `customer${i}@example.com` : undefined,
      address: i % 2 === 0 ? `Address ${i}, City` : undefined,
    });
    
    customers.push(customer);
  }
  
  return customers;
}

async function createItemsForUser(user, count) {
  const items = [];
  const products = [
    'Rice', 'Wheat', 'Sugar', 'Salt', 'Oil', 'Dal', 'Tea', 'Coffee',
    'Soap', 'Shampoo', 'Toothpaste', 'Detergent', 'Biscuits', 'Bread',
    'Milk', 'Butter', 'Cheese', 'Eggs', 'Chicken', 'Fish',
  ];
  
  for (let i = 1; i <= count; i++) {
    const name = `${products[i % products.length]} ${i > products.length ? i : ''}`.trim();
    const item = await Item.create({
      userId: user._id,
      name,
      normalizedName: name.toLowerCase().trim().replace(/\s+/g, ' '),
      defaultPrice: Math.floor(Math.random() * 500) + 50,
    });
    
    items.push(item);
  }
  
  return items;
}

async function createBillsForUser(user, customers, items, count) {
  const bills = [];
  
  for (let i = 1; i <= count; i++) {
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const numItems = Math.floor(Math.random() * 3) + 1; // 1-3 items per bill
    const billItems = [];
    
    let subTotal = 0;
    for (let j = 0; j < numItems; j++) {
      const item = items[Math.floor(Math.random() * items.length)];
      const qty = Math.floor(Math.random() * 10) + 1;
      const price = item.defaultPrice || 100;
      const total = qty * price;
      
      billItems.push({
        itemId: item._id,
        name: item.name,
        qty,
        price,
        total,
      });
      
      subTotal += total;
    }
    
    const discount = Math.random() < 0.3 ? Math.floor(Math.random() * 100) : 0;
    const tax = Math.floor(subTotal * 0.05); // 5% tax
    const grandTotal = subTotal - discount + tax;
    const paidAmount = Math.random() < 0.5 ? grandTotal : Math.floor(Math.random() * grandTotal);
    
    const bill = await Bill.create({
      userId: user._id,
      customerId: customer._id,
      billNo: `BILL-${user.email.split('@')[0]}-${String(i).padStart(4, '0')}`,
      items: billItems,
      subTotal,
      discount,
      tax,
      grandTotal,
      paidAmount,
      pendingAmount: grandTotal - paidAmount,
      status: paidAmount >= grandTotal ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
      dueDate: i % 3 === 0 ? new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000) : undefined,
      notes: i % 10 === 0 ? `Bill notes ${i}` : undefined,
      idempotencyKey: `seed-bill-${user._id}-${i}-${Date.now()}`,
    });
    
    bills.push(bill);
  }
  
  return bills;
}

async function createTransactionsForCustomer(user, customer, count) {
  const transactions = [];
  const types = ['credit', 'debit'];
  const notes = ['Payment received', 'Purchase', 'Advance', 'Return', 'Adjustment'];
  
  for (let i = 1; i <= count; i++) {
    const transaction = await LedgerTransaction.create({
      userId: user._id,
      customerId: customer._id,
      type: types[Math.floor(Math.random() * types.length)],
      amount: Math.floor(Math.random() * 5000) + 100,
      note: notes[Math.floor(Math.random() * notes.length)],
      idempotencyKey: `seed-txn-${user._id}-${customer._id}-${i}-${Date.now()}`,
    });
    
    transactions.push(transaction);
  }
  
  return transactions;
}

async function seedAll() {
  console.log('\n🌱 Starting seed process...');
  console.log(`   Config: ${JSON.stringify(SEED_CONFIG, null, 2)}`);
  
  await clearData();
  
  // Create users
  const users = await createUsers();
  
  let totalCustomers = 0;
  let totalItems = 0;
  let totalBills = 0;
  let totalTransactions = 0;
  
  // Create data for each user
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    console.log(`\n📦 Seeding data for user ${i + 1}/${users.length}: ${user.email}`);
    
    // Customers
    const customers = await createCustomersForUser(user, SEED_CONFIG.customersPerUser);
    totalCustomers += customers.length;
    console.log(`   ✓ ${customers.length} customers`);
    
    // Items
    const items = await createItemsForUser(user, SEED_CONFIG.itemsPerUser);
    totalItems += items.length;
    console.log(`   ✓ ${items.length} items`);
    
    // Bills
    const bills = await createBillsForUser(user, customers, items, SEED_CONFIG.billsPerUser);
    totalBills += bills.length;
    console.log(`   ✓ ${bills.length} bills`);
    
    // Transactions (for some customers)
    const customersWithTransactions = customers.slice(0, Math.floor(customers.length / 3));
    for (const customer of customersWithTransactions) {
      const txns = await createTransactionsForCustomer(user, customer, SEED_CONFIG.transactionsPerCustomer);
      totalTransactions += txns.length;
    }
    console.log(`   ✓ ${totalTransactions} transactions`);
  }
  
  console.log('\n========================================');
  console.log('✅ SEED COMPLETE');
  console.log('========================================');
  console.log(`👤 Users: ${users.length}`);
  console.log(`👥 Customers: ${totalCustomers}`);
  console.log(`📦 Items: ${totalItems}`);
  console.log(`📄 Bills: ${totalBills}`);
  console.log(`💰 Transactions: ${totalTransactions}`);
  console.log('\nTest Credentials:');
  console.log('  Email: seed-user-1@example.com');
  console.log('  Password: Test123456!');
  console.log('========================================\n');
}

async function main() {
  try {
    await connect();
    await seedAll();
  } catch (error) {
    console.error('\n❌ Seed error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB\n');
    process.exit(0);
  }
}

main();
