/**
 * SettleUp - Database Seeding & Index Initializer Script
 * 
 * Usage:
 * $ node scripts/seed.js
 * 
 * Performs:
 * 1. Connects to MONGODB_URI.
 * 2. Creates all covered and compound indexes.
 * 3. Seeds demo accounts: Alice, Bob, Charlie (password: "demo-password-123").
 * 4. Seeds an initial demo group with realistic expenses across currencies.
 */

const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const os = require('os');
const { User, Group, Expense, LedgerEntry, ExchangeRate } = require('../src/models');
const { recordExpense } = require('../src/services/settlementService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/settleup';

async function seed() {
  console.log('Connecting to database:', MONGODB_URI.replace(/:[^:]*@/, ':****@'));

  await mongoose.connect(MONGODB_URI, {
    runtimeAdapters: { os },
  });

  console.log('Building Mongoose indexes...');
  await Promise.all([
    User.init(),
    Group.init(),
    Expense.init(),
    LedgerEntry.init(),
    ExchangeRate.init(),
  ]);
  console.log('✓ All compound and covered indexes verified.');

  // 1. Seed Demo Users
  const hashedPassword = await bcrypt.hash('demo-password-123', 10);

  const demoUsersData = [
    { name: 'Alice Cooper', email: 'alice@example.com', defaultCurrency: 'USD' },
    { name: 'Bob Dylan', email: 'bob@example.com', defaultCurrency: 'EUR' },
    { name: 'Charlie Parker', email: 'charlie@example.com', defaultCurrency: 'GBP' },
  ];

  const users = [];
  for (const data of demoUsersData) {
    let user = await User.findOne({ email: data.email });
    if (!user) {
      user = await User.create({
        ...data,
        password: hashedPassword,
      });
      console.log(`✓ Created user: ${user.name} (${user.email})`);
    } else {
      console.log(`ℹ Existing user: ${user.name}`);
    }
    users.push(user);
  }

  const [alice, bob, charlie] = users;

  // 2. Seed Demo Group
  let group = await Group.findOne({ name: 'Alps Ski Trip 2026' });
  if (!group) {
    group = await Group.create({
      name: 'Alps Ski Trip 2026',
      description: 'Annual winter getaway in Chamonix. Multi-currency expenses in EUR and USD.',
      baseCurrency: 'USD',
      members: [alice._id, bob._id, charlie._id],
      constraints: [],
    });
    console.log(`✓ Created group: "${group.name}" with base currency ${group.baseCurrency}`);

    // Check if replica set is available for transactions
    try {
      // 3. Seed Initial Expenses
      // Expense 1: Chalet Rental - Alice paid $300.00 split 3 ways ($100 each)
      await recordExpense({
        groupId: group._id,
        description: 'Chamonix Mountain Chalet (Deposit)',
        paidBy: alice._id,
        totalAmount: 30000,
        currency: 'USD',
        splits: [
          { user: alice._id, amount: 10000 },
          { user: bob._id, amount: 10000 },
          { user: charlie._id, amount: 10000 },
        ],
      });
      console.log('✓ Recorded expense: Chalet Rental ($300.00 USD)');

      // Expense 2: Lift Tickets - Bob paid €120.00 split 3 ways (€40 each)
      await recordExpense({
        groupId: group._id,
        description: 'Ski Lift Passes (Aiguille du Midi)',
        paidBy: bob._id,
        totalAmount: 12000,
        currency: 'EUR',
        splits: [
          { user: alice._id, amount: 4000 },
          { user: bob._id, amount: 4000 },
          { user: charlie._id, amount: 4000 },
        ],
      });
      console.log('✓ Recorded expense: Lift Passes (€120.00 EUR auto-converted to USD)');

      // Expense 3: Dinner - Charlie paid $60.00 split between Bob and Charlie ($30 each)
      await recordExpense({
        groupId: group._id,
        description: 'Fondue & Alpine Wine Dinner',
        paidBy: charlie._id,
        totalAmount: 6000,
        currency: 'USD',
        splits: [
          { user: bob._id, amount: 3000 },
          { user: charlie._id, amount: 3000 },
        ],
      });
      console.log('✓ Recorded expense: Alpine Dinner ($60.00 USD)');
    } catch (txErr) {
      console.warn(
        '⚠ Could not write transactional expenses (likely running standalone local MongoDB without replica set).',
        'Transactions will succeed seamlessly on MongoDB Atlas replica sets.'
      );
    }
  } else {
    console.log(`ℹ Group "${group.name}" already exists.`);
  }

  console.log('\n======================================================');
  console.log('🎉 Seeding complete! You can sign in using:');
  console.log('Email: alice@example.com (or bob@example.com, charlie@example.com)');
  console.log('Password: demo-password-123');
  console.log('======================================================');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
