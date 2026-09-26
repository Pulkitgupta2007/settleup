const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { User, Group, Expense, LedgerEntry } = require('../src/models');
const {
  settleGroup,
  getUserBalancesAcrossGroups,
  recordExpense,
  getUnsettledPairwiseDebts,
} = require('../src/services/settlementService');

let replSet;

// Set Jest timeout for replica set startup
jest.setTimeout(30000);

const os = require('os');

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri, {
    runtimeAdapters: { os },
  });
  // Ensure all model indexes are created in MongoDB
  await Promise.all([
    User.init(),
    Group.init(),
    Expense.init(),
    LedgerEntry.init(),
  ]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});

beforeEach(async () => {
  // Clear all collections between tests
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Phase 2: Mongoose Schemas & Immutable Ledger', () => {

  describe('1. Schema Validations & Constraints', () => {
    test('User schema requires valid email and default currency', async () => {
      const validUser = await User.create({
        name: 'Alice Cooper',
        email: 'alice@example.com',
      });
      expect(validUser.defaultCurrency).toBe('USD');

      // Invalid email should fail
      await expect(
        User.create({ name: 'Bob', email: 'not-an-email' })
      ).rejects.toThrow();
    });

    test('Expense schema enforces integer cents and strict penny conservation', async () => {
      const userA = await User.create({ name: 'Alice', email: 'a@ex.com' });
      const userB = await User.create({ name: 'Bob', email: 'b@ex.com' });
      const group = await Group.create({
        name: 'Apartment',
        members: [userA._id, userB._id],
      });

      // Float amount should be rejected
      await expect(
        Expense.create({
          group: group._id,
          description: 'Coffee',
          paidBy: userA._id,
          totalAmount: 10.5, // 10.50 float, invalid!
          currency: 'USD',
          splits: [
            { user: userA._id, amount: 5 },
            { user: userB._id, amount: 5 },
          ],
        })
      ).rejects.toThrow(/integer/);

      // Mismatch between totalAmount and splits sum must fail (conservation check)
      await expect(
        Expense.create({
          group: group._id,
          description: 'Dinner',
          paidBy: userA._id,
          totalAmount: 1000, // 1000 cents
          currency: 'USD',
          splits: [
            { user: userA._id, amount: 500 },
            { user: userB._id, amount: 499 }, // 1 cent missing!
          ],
        })
      ).rejects.toThrow(/Sum of splits must exactly match totalAmount/);

      // Mismatch between totalAmount and paidBy sum must fail (payer conservation check)
      await expect(
        Expense.create({
          group: group._id,
          description: 'Dinner Multi-Payer Mismatch',
          paidBy: [
            { user: userA._id, amountCents: 600 },
            { user: userB._id, amountCents: 300 }, // sum 900 != 1000
          ],
          totalAmount: 1000,
          currency: 'USD',
          splits: [
            { user: userA._id, amount: 500 },
            { user: userB._id, amount: 500 },
          ],
        })
      ).rejects.toThrow(/Sum of paidBy amounts must exactly match totalAmount in cents/);
    });

    test('Group constraints require exactly 2 distinct members', async () => {
      const userA = await User.create({ name: 'Alice', email: 'a2@ex.com' });

      // Constraint specifying same user for both sides must fail
      await expect(
        Group.create({
          name: 'Trip',
          members: [userA._id],
          constraints: [{ avoid: [userA._id, userA._id] }],
        })
      ).rejects.toThrow(/Constraint must specify exactly 2 distinct users/);
    });

    test('Group automatically generates secure inviteCode and 7-day expiration', async () => {
      const userA = await User.create({ name: 'Alice', email: 'a_invite@ex.com' });
      const group = await Group.create({
        name: 'Invite Test Group',
        members: [userA._id],
      });

      expect(group.inviteCode).toBeDefined();
      expect(typeof group.inviteCode).toBe('string');
      expect(group.inviteCode.length).toBe(16); // 8 bytes in hex = 16 chars
      expect(group.inviteCodeExpiresAt).toBeInstanceOf(Date);
      expect(group.inviteCodeExpiresAt.getTime()).toBeGreaterThan(Date.now());

      // Distinct group gets distinct random code
      const group2 = await Group.create({
        name: 'Second Group',
        members: [userA._id],
      });
      expect(group2.inviteCode).not.toBe(group.inviteCode);

      // Regeneration creates new code and resets expiration
      const oldCode = group.inviteCode;
      const newCode = group.regenerateInviteCode(14);
      expect(newCode).not.toBe(oldCode);
      expect(group.inviteCode).toBe(newCode);
      expect(group.inviteCodeExpiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000);
    });
  });

  describe('2. LedgerEntry Immutability Guarantees', () => {
    let testGroup, userA, userB;

    beforeEach(async () => {
      userA = await User.create({ name: 'Alice', email: 'alice_imm@test.com' });
      userB = await User.create({ name: 'Bob', email: 'bob_imm@test.com' });
      testGroup = await Group.create({
        name: 'Roadtrip',
        members: [userA._id, userB._id],
      });
    });

    test('creates entry with auto-computed signedAmount (+ for CREDIT, - for DEBIT)', async () => {
      const creditEntry = await LedgerEntry.create({
        group: testGroup._id,
        user: userA._id,
        counterparty: userB._id,
        type: 'EXPENSE',
        direction: 'CREDIT',
        amount: 3000,
        currency: 'USD',
      });
      expect(creditEntry.signedAmount).toBe(3000);

      const debitEntry = await LedgerEntry.create({
        group: testGroup._id,
        user: userB._id,
        counterparty: userA._id,
        type: 'EXPENSE',
        direction: 'DEBIT',
        amount: 3000,
        currency: 'USD',
      });
      expect(debitEntry.signedAmount).toBe(-3000);
    });

    test('blocks document-level .save() updates on existing entries', async () => {
      const entry = await LedgerEntry.create({
        group: testGroup._id,
        user: userA._id,
        type: 'ADJUSTMENT',
        direction: 'CREDIT',
        amount: 1500,
        currency: 'USD',
      });

      entry.amount = 2000;
      await expect(entry.save()).rejects.toThrow(
        /LedgerEntry is append-only and strictly immutable/
      );
    });

    test('blocks document-level .deleteOne()', async () => {
      const entry = await LedgerEntry.create({
        group: testGroup._id,
        user: userA._id,
        type: 'ADJUSTMENT',
        direction: 'CREDIT',
        amount: 1500,
        currency: 'USD',
      });

      await expect(entry.deleteOne()).rejects.toThrow(
        /LedgerEntry is append-only and strictly immutable/
      );
    });

    test('blocks query-level update operations (updateOne, updateMany, findOneAndUpdate)', async () => {
      const entry = await LedgerEntry.create({
        group: testGroup._id,
        user: userA._id,
        type: 'EXPENSE',
        direction: 'DEBIT',
        amount: 1000,
        currency: 'USD',
      });

      await expect(
        LedgerEntry.updateOne({ _id: entry._id }, { $set: { amount: 5000 } })
      ).rejects.toThrow(/strictly immutable/);

      await expect(
        LedgerEntry.updateMany({ group: testGroup._id }, { $set: { amount: 5000 } })
      ).rejects.toThrow(/strictly immutable/);

      await expect(
        LedgerEntry.findOneAndUpdate({ _id: entry._id }, { $set: { amount: 5000 } })
      ).rejects.toThrow(/strictly immutable/);
    });

    test('blocks query-level delete operations (deleteOne, deleteMany, findOneAndDelete)', async () => {
      const entry = await LedgerEntry.create({
        group: testGroup._id,
        user: userA._id,
        type: 'EXPENSE',
        direction: 'DEBIT',
        amount: 1000,
        currency: 'USD',
      });

      await expect(
        LedgerEntry.deleteOne({ _id: entry._id })
      ).rejects.toThrow(/strictly immutable/);

      await expect(
        LedgerEntry.deleteMany({ group: testGroup._id })
      ).rejects.toThrow(/strictly immutable/);

      await expect(
        LedgerEntry.findOneAndDelete({ _id: entry._id })
      ).rejects.toThrow(/strictly immutable/);
    });
  });

  describe('3. Compound Index Strategy Verification', () => {
    test('verifies all expected compound indices exist on LedgerEntry schema', () => {
      const indexes = LedgerEntry.schema.indexes();

      // Helper to match index specification
      const hasIndex = (fields) =>
        indexes.some(([spec]) =>
          Object.keys(fields).every(k => spec[k] === fields[k]) &&
          Object.keys(spec).length === Object.keys(fields).length
        );

      // 1. Covered query index for balance across groups
      expect(hasIndex({ user: 1, currency: 1, group: 1, signedAmount: 1 })).toBe(true);

      // 2. Chronological audit index
      expect(hasIndex({ group: 1, createdAt: 1 })).toBe(true);

      // 3. User timeline index
      expect(hasIndex({ group: 1, user: 1, createdAt: 1 })).toBe(true);

      // 4. Settlement batch index
      expect(hasIndex({ settlementId: 1 })).toBe(true);
    });
  });

  describe('4. Multi-Document Transactions & settleGroup()', () => {
    let alice, bob, charlie, group;

    beforeEach(async () => {
      alice = await User.create({ name: 'Alice', email: 'alice_tx@test.com' });
      bob = await User.create({ name: 'Bob', email: 'bob_tx@test.com' });
      charlie = await User.create({ name: 'Charlie', email: 'charlie_tx@test.com' });

      group = await Group.create({
        name: 'Ski Trip',
        baseCurrency: 'USD',
        members: [alice._id, bob._id, charlie._id],
      });
    });

    test('records expenses and balances correctly before settlement', async () => {
      // Expense 1: Alice pays $60.00 (6000 cents) for Alice, Bob, Charlie ($20 each)
      await recordExpense({
        groupId: group._id,
        description: 'Cabin Rental',
        paidBy: alice._id,
        totalAmount: 6000,
        currency: 'USD',
        splits: [
          { user: alice._id, amount: 2000 },
          { user: bob._id, amount: 2000 },
          { user: charlie._id, amount: 2000 },
        ],
      });

      // Expense 2: Bob pays $30.00 (3000 cents) for Bob, Charlie ($15 each)
      await recordExpense({
        groupId: group._id,
        description: 'Groceries',
        paidBy: bob._id,
        totalAmount: 3000,
        currency: 'USD',
        splits: [
          { user: bob._id, amount: 1500 },
          { user: charlie._id, amount: 1500 },
        ],
      });

      // Check Alice's balance across groups:
      // Alice paid 6000, consumed 2000 -> net balance: +4000 cents (+40.00)
      const aliceBalances = await getUserBalancesAcrossGroups(alice._id, 'USD');
      expect(aliceBalances).toHaveLength(1);
      expect(aliceBalances[0].netBalanceCents).toBe(4000);

      // Check Bob's balance:
      // Owes Alice 2000, paid for Charlie 1500 -> net balance: -500 cents (-$5.00)
      const bobBalances = await getUserBalancesAcrossGroups(bob._id, 'USD');
      expect(bobBalances[0].netBalanceCents).toBe(-500);

      // Check Charlie's balance:
      // Owes Alice 2000, owes Bob 1500 -> net balance: -3500 cents (-$35.00)
      const charlieBalances = await getUserBalancesAcrossGroups(charlie._id, 'USD');
      expect(charlieBalances[0].netBalanceCents).toBe(-3500);
    });

    test('settleGroup executes in transaction and brings all balances to exactly zero', async () => {
      // Add expenses
      await recordExpense({
        groupId: group._id,
        description: 'Cabin Rental',
        paidBy: alice._id,
        totalAmount: 6000,
        currency: 'USD',
        splits: [
          { user: alice._id, amount: 2000 },
          { user: bob._id, amount: 2000 },
          { user: charlie._id, amount: 2000 },
        ],
      });

      await recordExpense({
        groupId: group._id,
        description: 'Groceries',
        paidBy: bob._id,
        totalAmount: 3000,
        currency: 'USD',
        splits: [
          { user: bob._id, amount: 1500 },
          { user: charlie._id, amount: 1500 },
        ],
      });

      // Execute settlement in transaction
      const settlement = await settleGroup({ groupId: group._id, notes: 'Trip wrap-up' });

      expect(settlement.settlementId).toBeDefined();
      expect(settlement.transactions).toHaveLength(2);
      expect(settlement.entryCount).toBe(4); // 2 transactions * 2 double-entry records each

      // Verify that after settlement, EVERYONE'S net balance is exactly ZERO
      const [aliceAfter] = await getUserBalancesAcrossGroups(alice._id, 'USD');
      const [bobAfter] = await getUserBalancesAcrossGroups(bob._id, 'USD');
      const [charlieAfter] = await getUserBalancesAcrossGroups(charlie._id, 'USD');

      expect(aliceAfter.netBalanceCents).toBe(0);
      expect(bobAfter.netBalanceCents).toBe(0);
      expect(charlieAfter.netBalanceCents).toBe(0);

      // Verify Group timestamp was updated
      const updatedGroup = await Group.findById(group._id);
      expect(updatedGroup.lastSettledAt).not.toBeNull();
    });

    test('settleGroup respects constraint-avoidance in MongoDB', async () => {
      // Charlie owes Alice 5000 cents
      await recordExpense({
        groupId: group._id,
        description: 'Concert Ticket',
        paidBy: alice._id,
        totalAmount: 5000,
        currency: 'USD',
        splits: [
          { user: charlie._id, amount: 5000 },
        ],
      });

      // Constraint: Charlie must NEVER pay Alice directly
      group.constraints = [{ avoid: [charlie._id, alice._id] }];
      await group.save();

      // Settle
      const settlement = await settleGroup({ groupId: group._id });

      // Minimal route under constraint: Charlie -> Bob ($50), Bob -> Alice ($50)
      expect(settlement.transactions).toHaveLength(2);

      // Verify NO settlement entry has user Charlie paying Alice directly
      const directPayments = await LedgerEntry.find({
        group: group._id,
        user: charlie._id,
        counterparty: alice._id,
        type: 'SETTLEMENT',
      });
      expect(directPayments).toHaveLength(0);

      // Verify all balances are 0 after rerouting
      const [aliceAfter] = await getUserBalancesAcrossGroups(alice._id, 'USD');
      const [charlieAfter] = await getUserBalancesAcrossGroups(charlie._id, 'USD');
      expect(aliceAfter.netBalanceCents).toBe(0);
      expect(charlieAfter.netBalanceCents).toBe(0);
    });

    test('aborts transaction and guarantees zero partial writes on failure', async () => {
      await recordExpense({
        groupId: group._id,
        description: 'Dinner',
        paidBy: alice._id,
        totalAmount: 3000,
        currency: 'USD',
        splits: [
          { user: alice._id, amount: 1000 },
          { user: bob._id, amount: 2000 },
        ],
      });

      const entryCountBefore = await LedgerEntry.countDocuments();

      // Intentionally cause failure inside transaction by mocking an invalid operation
      const session = await mongoose.startSession();
      let caughtError = null;

      try {
        await session.withTransaction(async () => {
          // 1. Insert a settlement entry
          await LedgerEntry.create(
            [
              {
                group: group._id,
                user: bob._id,
                type: 'SETTLEMENT',
                direction: 'CREDIT',
                amount: 2000,
                currency: 'USD',
              },
            ],
            { session }
          );

          // 2. Trigger an unhandled exception before commit
          throw new Error('Simulated network/DB crash mid-transaction');
        });
      } catch (err) {
        caughtError = err;
      } finally {
        await session.endSession();
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.message).toBe('Simulated network/DB crash mid-transaction');

      // Verify that NO partial write was committed
      const entryCountAfter = await LedgerEntry.countDocuments();
      expect(entryCountAfter).toBe(entryCountBefore);
    });

    test('3-payer expense split among 4 people correctly updates ledger and simplifies debts', async () => {
      const dave = await User.create({ name: 'Dave', email: 'dave_4p@ex.com' });
      const tripGroup = await Group.create({
        name: 'Ski Weekend',
        baseCurrency: 'USD',
        members: [alice._id, bob._id, charlie._id, dave._id],
      });

      // Bill of $120.00 (12,000 cents) co-funded by 3 payers:
      // Alice paid 6000 cents ($60)
      // Bob paid 4000 cents ($40)
      // Charlie paid 2000 cents ($20)
      // (Dave paid 0)
      // Split 4 ways equally: 3000 cents ($30) each
      const { expense, ledgerEntries } = await recordExpense({
        groupId: tripGroup._id,
        description: 'Cabin & Food',
        paidBy: [
          { user: alice._id, amountCents: 6000 },
          { user: bob._id, amountCents: 4000 },
          { user: charlie._id, amountCents: 2000 },
        ],
        totalAmount: 12000,
        currency: 'USD',
        splits: [
          { user: alice._id, amount: 3000 },
          { user: bob._id, amount: 3000 },
          { user: charlie._id, amount: 3000 },
          { user: dave._id, amount: 3000 },
        ],
      });

      expect(expense.paidBy).toHaveLength(3);
      expect(ledgerEntries.length).toBeGreaterThan(0);

      // Verify net balances:
      // Alice: paid 6000, consumed 3000 -> +3000 cents
      // Bob: paid 4000, consumed 3000 -> +1000 cents
      // Charlie: paid 2000, consumed 3000 -> -1000 cents
      // Dave: paid 0, consumed 3000 -> -3000 cents
      const aliceBal = (await getUserBalancesAcrossGroups(alice._id, 'USD')).find(b => b.groupId.equals(tripGroup._id));
      const bobBal = (await getUserBalancesAcrossGroups(bob._id, 'USD')).find(b => b.groupId.equals(tripGroup._id));
      const charlieBal = (await getUserBalancesAcrossGroups(charlie._id, 'USD')).find(b => b.groupId.equals(tripGroup._id));
      const daveBal = (await getUserBalancesAcrossGroups(dave._id, 'USD')).find(b => b.groupId.equals(tripGroup._id));

      expect(aliceBal.netBalanceCents).toBe(3000);
      expect(bobBal.netBalanceCents).toBe(1000);
      expect(charlieBal.netBalanceCents).toBe(-1000);
      expect(daveBal.netBalanceCents).toBe(-3000);

      // Invariant: Sum of all net balances must equal exactly zero
      const netSum = aliceBal.netBalanceCents + bobBal.netBalanceCents + charlieBal.netBalanceCents + daveBal.netBalanceCents;
      expect(netSum).toBe(0);

      // Verify pairwise debts produced for simplifier:
      const pairwiseDebts = await getUnsettledPairwiseDebts(tripGroup._id, 'USD');
      expect(pairwiseDebts.length).toBeGreaterThan(0);
      // All debts must preserve the { from, to, amount } structure the algorithm expects
      for (const d of pairwiseDebts) {
        expect(d).toHaveProperty('from');
        expect(d).toHaveProperty('to');
        expect(d).toHaveProperty('amount');
        expect(typeof d.from).toBe('string');
        expect(typeof d.to).toBe('string');
        expect(d.amount).toBeGreaterThan(0);
      }

      // Execute settlement: should simplify to minimal transactions
      const settlement = await settleGroup({ groupId: tripGroup._id });
      // Bounded transactions: <= N - 1 (here 4 members -> at most 3, optimal is 2)
      expect(settlement.transactions.length).toBeLessThanOrEqual(3);
      expect(settlement.totalAmountSettledCents).toBe(4000);

      // Verify all balances are zero after settlement
      const aliceAfter = (await getUserBalancesAcrossGroups(alice._id, 'USD')).find(b => b.groupId.equals(tripGroup._id));
      const bobAfter = (await getUserBalancesAcrossGroups(bob._id, 'USD')).find(b => b.groupId.equals(tripGroup._id));
      const charlieAfter = (await getUserBalancesAcrossGroups(charlie._id, 'USD')).find(b => b.groupId.equals(tripGroup._id));
      const daveAfter = (await getUserBalancesAcrossGroups(dave._id, 'USD')).find(b => b.groupId.equals(tripGroup._id));

      // After complete settlement, net balances must be 0
      expect(aliceAfter?.netBalanceCents || 0).toBe(0);
      expect(bobAfter?.netBalanceCents || 0).toBe(0);
      expect(charlieAfter?.netBalanceCents || 0).toBe(0);
      expect(daveAfter?.netBalanceCents || 0).toBe(0);
    });
  });

});
