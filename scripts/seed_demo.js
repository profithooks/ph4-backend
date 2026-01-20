/**
 * Seed Demo Data
 * 
 * Creates demo business with sample data for testing
 * Step 15: Release Candidate
 * 
 * Usage: npm run seed:demo
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Models
const User = require('../src/models/User');
const Customer = require('../src/models/Customer');
const Bill = require('../src/models/Bill');
const RecoveryCase = require('../src/models/RecoveryCase');
const FollowUpTask = require('../src/models/FollowUpTask');
const SupportTicket = require('../src/models/SupportTicket');
const SupportTicketMessage = require('../src/models/SupportTicketMessage');
const BusinessSettings = require('../src/models/BusinessSettings');

const DEMO_PHONE = process.env.DEMO_PHONE || '9999999999';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo123';

/**
 * Connect to database
 */
async function connectDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');
}

/**
 * Generate random date in past N days
 */
function randomPastDate(daysAgo) {
  const now = new Date();
  const past = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return new Date(past.getTime() + Math.random() * (now.getTime() - past.getTime()));
}

/**
 * Generate random future date in next N days
 */
function randomFutureDate(daysAhead) {
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  return new Date(now.getTime() + Math.random() * (future.getTime() - now.getTime()));
}

/**
 * Main seed function
 */
async function seedDemo() {
  console.log('\n🌱 Seeding Demo Data\n');

  try {
    await connectDB();

    // Check if demo user already exists
    let demoUser = await User.findOne({phone: DEMO_PHONE});

    if (demoUser) {
      console.log('⚠️  Demo user already exists. Cleaning up old data...');
      
      // Delete existing demo data
      await Customer.deleteMany({userId: demoUser._id});
      await Bill.deleteMany({userId: demoUser._id});
      await RecoveryCase.deleteMany({userId: demoUser._id});
      await FollowUpTask.deleteMany({userId: demoUser._id});
      await SupportTicket.deleteMany({userId: demoUser._id});
      await BusinessSettings.deleteMany({userId: demoUser._id});
      
      console.log('✅ Cleaned up old demo data');
    } else {
      // Create demo user
      const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);
      
      demoUser = await User.create({
        phone: DEMO_PHONE,
        password: hashedPassword,
        businessName: 'PH4 Demo Business',
        name: 'Demo Owner',
        role: 'OWNER',
      });
      
      console.log(`✅ Created demo user (phone: ${DEMO_PHONE})`);
    }

    // Create business settings
    await BusinessSettings.create({
      userId: demoUser._id,
      businessId: demoUser._id,
      interestEnabled: true,
      interestRatePctPerMonth: 2,
      planName: 'FREE',
      premiumInsightsEnabled: false,
    });
    console.log('✅ Created business settings');

    // Create 10 customers
    const customerNames = [
      'Rajesh Kumar',
      'Priya Sharma',
      'Amit Patel',
      'Sanjay Verma',
      'Neha Gupta',
      'Vikram Singh',
      'Pooja Reddy',
      'Ravi Mehta',
      'Sunita Desai',
      'Arjun Nair',
    ];

    const customers = [];
    for (const name of customerNames) {
      const customer = await Customer.create({
        userId: demoUser._id,
        name,
        phone: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
        address: `${Math.floor(Math.random() * 999) + 1}, Demo Street, Mumbai`,
        isDeleted: false,
        creditLimitEnabled: Math.random() > 0.7, // 30% have credit limits
        creditLimitAmount: Math.random() > 0.5 ? 50000 : 100000,
      });
      customers.push(customer);
    }
    console.log(`✅ Created ${customers.length} customers`);

    // Create 20 bills with mixed statuses
    const bills = [];
    for (let i = 0; i < 20; i++) {
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const amount = Math.floor(Math.random() * 20000) + 1000;
      const isPaid = Math.random() > 0.6; // 40% paid
      const dueDate = isPaid ? randomPastDate(60) : randomPastDate(Math.floor(Math.random() * 90));

      const bill = await Bill.create({
        userId: demoUser._id,
        customerId: customer._id,
        amount,
        dueDate,
        status: isPaid ? 'PAID' : 'PENDING',
        paidAmount: isPaid ? amount : 0,
        description: `Sample bill #${i + 1}`,
        isDeleted: false,
      });
      bills.push(bill);
    }
    console.log(`✅ Created ${bills.length} bills`);

    // Create 5 promises (2 broken, 2 upcoming, 1 paid)
    const promiseCustomers = customers.slice(0, 5);
    for (let i = 0; i < 5; i++) {
      const customer = promiseCustomers[i];
      const amount = Math.floor(Math.random() * 15000) + 5000;
      
      let promiseAt;
      let promiseStatus;
      
      if (i < 2) {
        // Broken (past due)
        promiseAt = randomPastDate(10);
        promiseStatus = 'BROKEN';
      } else if (i < 4) {
        // Upcoming
        promiseAt = randomFutureDate(7);
        promiseStatus = 'ACTIVE';
      } else {
        // Paid
        promiseAt = randomPastDate(5);
        promiseStatus = 'PAID';
      }

      await RecoveryCase.create({
        userId: demoUser._id,
        customerId: customer._id,
        amount,
        promiseAt,
        promiseAmount: amount,
        promiseStatus,
        status: promiseStatus === 'PAID' ? 'RESOLVED' : 'ACTIVE',
      });
    }
    console.log('✅ Created 5 promises (2 broken, 2 upcoming, 1 paid)');

    // Create 10 follow-up tasks
    const followupCustomers = customers.slice(0, 10);
    for (let i = 0; i < 10; i++) {
      const customer = followupCustomers[i];
      const isPending = Math.random() > 0.5;
      
      await FollowUpTask.create({
        userId: demoUser._id,
        customerId: customer._id,
        dueAt: isPending ? randomFutureDate(7) : randomPastDate(3),
        status: isPending ? 'PENDING' : 'COMPLETED',
        notes: `Follow-up with ${customer.name}`,
        isDeleted: false,
      });
    }
    console.log('✅ Created 10 follow-up tasks');

    // Create 3 support tickets
    const ticketSubjects = [
      'Cannot see all customers in aging report',
      'Need help with credit limit setup',
      'How to export backup data?',
    ];

    for (let i = 0; i < 3; i++) {
      const status = i === 0 ? 'OPEN' : i === 1 ? 'IN_PROGRESS' : 'RESOLVED';
      
      const ticket = await SupportTicket.create({
        businessId: demoUser._id,
        userId: demoUser._id,
        subject: ticketSubjects[i],
        message: `This is a demo support ticket message for: ${ticketSubjects[i]}`,
        category: i === 0 ? 'BILLING' : i === 1 ? 'FEATURE' : 'ACCOUNT',
        priority: 'MEDIUM',
        status,
      });

      // Add initial message
      await SupportTicketMessage.create({
        ticketId: ticket._id,
        senderType: 'CUSTOMER',
        senderUserId: demoUser._id,
        senderName: demoUser.name,
        message: `This is a demo support ticket message for: ${ticketSubjects[i]}`,
      });

      if (status !== 'OPEN') {
        // Add support reply
        await SupportTicketMessage.create({
          ticketId: ticket._id,
          senderType: 'SUPPORT',
          senderEmail: 'support@ph4.com',
          senderName: 'PH4 Support',
          message: 'Thank you for reaching out. We are looking into this.',
        });
      }
    }
    console.log('✅ Created 3 support tickets');

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('✅ Demo data seeded successfully!');
    console.log('='.repeat(50));
    console.log(`\nDemo Credentials:`);
    console.log(`  Phone: ${DEMO_PHONE}`);
    console.log(`  Password: ${DEMO_PASSWORD}`);
    console.log(`\nDemo Data:`);
    console.log(`  - 10 customers`);
    console.log(`  - 20 bills (40% paid, 60% pending/overdue)`);
    console.log(`  - 5 promises (2 broken, 2 upcoming, 1 paid)`);
    console.log(`  - 10 follow-up tasks`);
    console.log(`  - 3 support tickets (OPEN, IN_PROGRESS, RESOLVED)`);
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run seed
seedDemo();
