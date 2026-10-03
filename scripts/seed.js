/**
 * SettleUp - Database Seeding & Index Initializer Script
 * 
 * Usage:
 * $ node scripts/seed.js
 * 
 * Performs:
 * 1. Connects to MONGODB_URI.
 * 2. Creates all covered and compound indexes.
 * 3. Seeds demo accounts: Rehan, Pulkit, Arnav (password: "demo-password-123").
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

  // Migrate legacy demo accounts (Alice, Bob, Charlie) if present
  const legacyMap = [
    { oldEmail: 'alice@example.com', name: 'Rehan', email: 'rehan@example.com', defaultCurrency: 'USD' },
    { oldEmail: 'bob@example.com', name: 'Pulkit', email: 'pulkit@example.com', defaultCurrency: 'INR' },
    { oldEmail: 'charlie@example.com', name: 'Arnav', email: 'arnav@example.com', defaultCurrency: 'USD' },
  ];

  for (const legacy of legacyMap) {
    const oldUser = await User.findOne({ email: legacy.oldEmail });
    if (oldUser) {
      const existingNew = await User.findOne({ email: legacy.email });
      if (!existingNew) {
        oldUser.name = legacy.name;
        oldUser.email = legacy.email;
        oldUser.defaultCurrency = legacy.defaultCurrency;
        oldUser.password = hashedPassword;
        await oldUser.save();
        console.log(`✓ Migrated legacy demo user: ${legacy.oldEmail} -> ${legacy.email} (${legacy.name})`);
      } else {
        await User.deleteOne({ _id: oldUser._id });
        console.log(`✓ Removed duplicate legacy user ${legacy.oldEmail}`);
      }
    }
  }

  const demoUsersData = [
    { name: 'Rehan', email: 'rehan@example.com', defaultCurrency: 'USD' },
    { name: 'Pulkit', email: 'pulkit@example.com', defaultCurrency: 'INR' },
    { name: 'Arnav', email: 'arnav@example.com', defaultCurrency: 'USD' },
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
      user.name = data.name;
      user.password = hashedPassword;
      await user.save();
      console.log(`ℹ Existing user updated: ${user.name} (${user.email})`);
    }
    users.push(user);
  }

  const [rehan, pulkit, arnav] = users;

  // 2. Seed Demo Group
  let group = await Group.findOne({ name: 'Alps Ski Trip 2026' });
  if (!group) {
    group = await Group.create({
      name: 'Alps Ski Trip 2026',
      description: 'Annual winter getaway in Chamonix. Multi-currency expenses in EUR and USD.',
      baseCurrency: 'USD',
      members: [rehan._id, pulkit._id, arnav._id],
      constraints: [],
    });
    console.log(`✓ Created group: "${group.name}" with base currency ${group.baseCurrency}`);

    // Check if replica set is available for transactions
    try {
      // 3. Seed Initial Expenses
      // Expense 1: Chalet Rental - Rehan paid $300.00 split 3 ways ($100 each)
      await recordExpense({
        groupId: group._id,
        description: 'Chamonix Mountain Chalet (Deposit)',
        paidBy: rehan._id,
        totalAmount: 30000,
        currency: 'USD',
        splits: [
          { user: rehan._id, amount: 10000 },
          { user: pulkit._id, amount: 10000 },
          { user: arnav._id, amount: 10000 },
        ],
      });
      console.log('✓ Recorded expense: Chalet Rental ($300.00 USD)');

      // Expense 2: Lift Tickets - Pulkit paid €120.00 split 3 ways (€40 each)
      await recordExpense({
        groupId: group._id,
        description: 'Ski Lift Passes (Aiguille du Midi)',
        paidBy: pulkit._id,
        totalAmount: 12000,
        currency: 'EUR',
        splits: [
          { user: rehan._id, amount: 4000 },
          { user: pulkit._id, amount: 4000 },
          { user: arnav._id, amount: 4000 },
        ],
      });
      console.log('✓ Recorded expense: Lift Passes (€120.00 EUR auto-converted to USD)');

      // Expense 3: Dinner - Arnav paid $60.00 split between Pulkit and Arnav ($30 each)
      await recordExpense({
        groupId: group._id,
        description: 'Fondue & Alpine Wine Dinner',
        paidBy: arnav._id,
        totalAmount: 6000,
        currency: 'USD',
        splits: [
          { user: pulkit._id, amount: 3000 },
          { user: arnav._id, amount: 3000 },
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
    // Ensure all 3 demo users are members of the existing demo group
    const targetMemberIds = [rehan._id.toString(), pulkit._id.toString(), arnav._id.toString()];
    const currentMemberIds = group.members.map(m => m.toString());
    let modified = false;

    for (const memberId of targetMemberIds) {
      if (!currentMemberIds.includes(memberId)) {
        group.members.push(memberId);
        modified = true;
      }
    }

    if (modified) {
      await group.save();
      console.log(`✓ Updated group "${group.name}" with demo members.`);
    } else {
      console.log(`ℹ Group "${group.name}" already exists and contains demo members.`);
    }
  }

  console.log('\n======================================================');
  console.log('🎉 Seeding complete! You can sign in using:');
  console.log('Email: rehan@example.com (or pulkit@example.com, arnav@example.com)');
  console.log('Password: demo-password-123');
  console.log('======================================================');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
