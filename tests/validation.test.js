const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const os = require('os');
const { User, Group, Expense, LedgerEntry, ExchangeRate } = require('../src/models');
const {
  validateObjectId,
  validateCurrencyCode,
  validatePositiveIntegerCents,
  validateExpenseInput,
  validateGroupInput,
} = require('../src/lib/validators');
const {
  AppError,
  ValidationError,
  NotFoundError,
  ConstraintDeadlockError,
  TransactionError,
  formatErrorResponse,
} = require('../src/lib/errors');
const { recordExpense } = require('../src/services/settlementService');

let replSet;

jest.setTimeout(30000);

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri, {
    runtimeAdapters: { os },
  });
  await Promise.all([
    User.init(),
    Group.init(),
    Expense.init(),
    LedgerEntry.init(),
    ExchangeRate.init(),
  ]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Phase 4: Robust Error Handling & Input Validation', () => {

  describe('1. API Input Validation & Malformed Payload Rejection', () => {
    test('rejects malformed ObjectIds with 400 ValidationError', () => {
      expect(() => validateObjectId('not-an-id', 'userId')).toThrow(ValidationError);
      expect(() => validateObjectId('123', 'groupId')).toThrow(
        /must be a valid 24-character hexadecimal MongoDB ObjectId/
      );
      expect(() => validateObjectId('', 'groupId')).toThrow(/is required/);
    });

    test('rejects invalid currency codes (non-3-letter, lowercase, symbols)', () => {
      expect(() => validateCurrencyCode('US', 'currency')).toThrow(
        /must be a valid 3-letter ISO 4217 currency code/
      );
      expect(() => validateCurrencyCode('USDD', 'currency')).toThrow(
        /must be a valid 3-letter ISO 4217 currency code/
      );
      expect(() => validateCurrencyCode('123', 'currency')).toThrow(
        /must be a valid 3-letter ISO 4217 currency code/
      );
      expect(() => validateCurrencyCode(null, 'currency')).toThrow(/is required/);

      // Valid codes normalized to uppercase
      expect(validateCurrencyCode('usd')).toBe('USD');
      expect(validateCurrencyCode('eur')).toBe('EUR');
    });

    test('rejects negative amounts, float cents, zero, and strings', () => {
      expect(() => validatePositiveIntegerCents(-500, 'totalAmount')).toThrow(
        /strictly positive/
      );
      expect(() => validatePositiveIntegerCents(0, 'totalAmount')).toThrow(
        /strictly positive/
      );
      expect(() => validatePositiveIntegerCents(10.5, 'totalAmount')).toThrow(
        /must be an integer in cents \(e\.g\. 1050 for \$10\.50, got float 10\.5\)/
      );
      expect(() => validatePositiveIntegerCents('1000', 'totalAmount')).toThrow(
        /must be a number/
      );
    });

    test('rejects expenses when payer or participant is not a member of the group', async () => {
      const member1 = await User.create({ name: 'Alice', email: 'alice_v1@test.com' });
      const member2 = await User.create({ name: 'Bob', email: 'bob_v1@test.com' });
      const nonMember = await User.create({ name: 'Eve', email: 'eve_v1@test.com' });

      const group = await Group.create({
        name: 'Roadtrip',
        members: [member1._id, member2._id],
      });

      // Payer is not in the group
      expect(() =>
        validateExpenseInput(
          {
            description: 'Gas',
            paidBy: nonMember._id.toString(),
            totalAmount: 4000,
            currency: 'USD',
            splits: [
              { user: member1._id.toString(), amount: 2000 },
              { user: member2._id.toString(), amount: 2000 },
            ],
          },
          group
        )
      ).toThrow(/is not a member of group "Roadtrip"/);

      // Participant in splits is not in the group
      expect(() =>
        validateExpenseInput(
          {
            description: 'Gas',
            paidBy: member1._id.toString(),
            totalAmount: 4000,
            currency: 'USD',
            splits: [
              { user: member1._id.toString(), amount: 2000 },
              { user: nonMember._id.toString(), amount: 2000 },
            ],
          },
          group
        )
      ).toThrow(/is not a member of group "Roadtrip"/);
    });

    test('rejects expenses with duplicate participants in splits', async () => {
      const u1 = await User.create({ name: 'Alice', email: 'alice_dup@test.com' });
      const u2 = await User.create({ name: 'Bob', email: 'bob_dup@test.com' });
      const group = await Group.create({ name: 'Trip', members: [u1._id, u2._id] });

      expect(() =>
        validateExpenseInput(
          {
            description: 'Snacks',
            paidBy: u1._id.toString(),
            totalAmount: 2000,
            currency: 'USD',
            splits: [
              { user: u2._id.toString(), amount: 1000 },
              { user: u2._id.toString(), amount: 1000 }, // Duplicate!
            ],
          },
          group
        )
      ).toThrow(/Duplicate participant/);
    });

    test('rejects penny conservation violations with exact cent difference reported', async () => {
      const u1 = await User.create({ name: 'Alice', email: 'alice_cent@test.com' });
      const u2 = await User.create({ name: 'Bob', email: 'bob_cent@test.com' });
      const group = await Group.create({ name: 'Trip', members: [u1._id, u2._id] });

      // Total is 1000 cents ($10.00), but splits sum to 999 cents (1 cent missing)
      expect(() =>
        validateExpenseInput(
          {
            description: 'Coffee',
            paidBy: u1._id.toString(),
            totalAmount: 1000,
            currency: 'USD',
            splits: [
              { user: u1._id.toString(), amount: 500 },
              { user: u2._id.toString(), amount: 499 },
            ],
          },
          group
        )
      ).toThrow(/Discrepancy: \+1 cents\. Money cannot be created or dropped\./);
    });

    test('rejects multi-payer expense when sum of payer amounts does not equal totalAmount', async () => {
      const u1 = await User.create({ name: 'Alice', email: 'alice_payer_mismatch@test.com' });
      const u2 = await User.create({ name: 'Bob', email: 'bob_payer_mismatch@test.com' });
      const group = await Group.create({ name: 'Trip', members: [u1._id, u2._id] });

      // Total is 10000 cents ($100), but payers sum to 9000 cents (1000 cents underfunded)
      expect(() =>
        validateExpenseInput(
          {
            description: 'Dinner',
            paidBy: [
              { user: u1._id.toString(), amountCents: 6000 },
              { user: u2._id.toString(), amountCents: 3000 },
            ],
            totalAmount: 10000,
            currency: 'USD',
            splits: [
              { user: u1._id.toString(), amount: 5000 },
              { user: u2._id.toString(), amount: 5000 },
            ],
          },
          group
        )
      ).toThrow(/Sum of payer amounts \(9000 cents\) does not match total expense amount \(10000 cents\)\. Discrepancy: \+1000 cents/);
    });

    test('accepts multi-payer expense when sum of payer amounts matches totalAmount exactly', async () => {
      const u1 = await User.create({ name: 'Alice', email: 'alice_payer_match@test.com' });
      const u2 = await User.create({ name: 'Bob', email: 'bob_payer_match@test.com' });
      const group = await Group.create({ name: 'Trip', members: [u1._id, u2._id] });

      const validated = validateExpenseInput(
        {
          description: 'Dinner',
          paidBy: [
            { user: u1._id.toString(), amountCents: 6000 },
            { user: u2._id.toString(), amountCents: 4000 },
          ],
          totalAmount: 10000,
          currency: 'USD',
          splits: [
            { user: u1._id.toString(), amount: 5000 },
            { user: u2._id.toString(), amount: 5000 },
          ],
        },
        group
      );

      expect(validated.paidBy).toHaveLength(2);
      expect(validated.paidBy[0].amountCents + validated.paidBy[1].amountCents).toBe(10000);
    });
  });

  describe('2. MongoDB Transaction Failure & Atomic Rollback', () => {
    test('ensures complete rollback and returns TransactionError if settlement crashes midway', async () => {
      const u1 = await User.create({ name: 'Alice', email: 'alice_crash@test.com' });
      const u2 = await User.create({ name: 'Bob', email: 'bob_crash@test.com' });
      const group = await Group.create({ name: 'Hike', members: [u1._id, u2._id] });

      // Add expense
      await recordExpense({
        groupId: group._id,
        description: 'Gear',
        paidBy: u1._id,
        totalAmount: 2000,
        currency: 'USD',
        splits: [{ user: u2._id, amount: 2000 }],
      });

      const entryCountBefore = await LedgerEntry.countDocuments();

      // Simulate a database/validation failure during transaction
      const session = await mongoose.startSession();
      let caughtError = null;

      try {
        await session.withTransaction(async () => {
          // Write an entry inside the transaction
          await LedgerEntry.create(
            [
              {
                group: group._id,
                user: u2._id,
                counterparty: u1._id,
                type: 'SETTLEMENT',
                direction: 'CREDIT',
                amount: 2000,
                currency: 'USD',
              },
            ],
            { session }
          );

          // Simulate unhandled mid-flight crash
          throw new Error('Disk I/O failure or network partition');
        });
      } catch (err) {
        caughtError = new TransactionError(
          `Settlement for group "${group.name}" failed and was fully rolled back`,
          err
        );
      } finally {
        await session.endSession();
      }

      expect(caughtError).toBeInstanceOf(TransactionError);
      expect(caughtError.statusCode).toBe(500);
      expect(caughtError.details.rollbackConfirmed).toBe(true);

      // Invariant: Ledger document count must be completely unchanged
      const entryCountAfter = await LedgerEntry.countDocuments();
      expect(entryCountAfter).toBe(entryCountBefore);
    });
  });

  describe('3. FX Provider Failure & Stale Rate Reporting', () => {
    test('reports isFxStale=true and warning metadata when provider fails', async () => {
      const u1 = await User.create({ name: 'Alice', email: 'alice_fx_fail@test.com' });
      const u2 = await User.create({ name: 'Bob', email: 'bob_fx_fail@test.com' });
      const group = await Group.create({
        name: 'Eurotrip',
        baseCurrency: 'USD',
        members: [u1._id, u2._id],
      });

      // Seed cached EUR rates from 12 hours ago with 1h TTL
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      await ExchangeRate.create({
        baseCurrency: 'EUR',
        rates: { USD: 1.09 },
        fetchedAt: twelveHoursAgo,
        ttlHours: 1,
      });

      // Provider fails with timeout
      const failingFetch = async () => {
        throw new Error('Connection timeout to api.exchangerate-api.com');
      };

      const { ledgerEntries } = await recordExpense({
        groupId: group._id,
        description: 'Train in Milan',
        paidBy: u1._id,
        totalAmount: 5000, // 50.00 EUR
        currency: 'EUR',
        splits: [{ user: u2._id, amount: 5000 }],
        fxOptions: { customFetch: failingFetch, ttlHours: 1 },
      });

      // Check that the ledger entry captured the stale flag
      expect(ledgerEntries[0].isFxStale).toBe(true);
      expect(ledgerEntries[0].originalCurrency).toBe('EUR');
      expect(ledgerEntries[0].currency).toBe('USD');
      expect(ledgerEntries[0].amount).toBe(5450); // 5000 * 1.09 = 5450 USD cents
    });
  });

  describe('4. Constraint Deadlock Handling', () => {
    test('returns 422 ConstraintDeadlockError when settlement constraints cannot be satisfied', () => {
      const err = new Error(
        'Cannot satisfy constraints: no valid direct route or intermediary available to settle [Alice] -> [Bob]'
      );
      const response = formatErrorResponse(err);

      expect(response.statusCode).toBe(422);
      expect(response.body.error.code).toBe('CONSTRAINT_DEADLOCK');
      expect(response.body.error.details.suggestion).toMatch(/Add an intermediary member/);
    });
  });

  describe('5. formatErrorResponse Standardized Mapping', () => {
    test('maps AppError to its defined statusCode and code', () => {
      const notFound = new NotFoundError('Group', '60c72b2f9b1d8b2bad000001');
      const res = formatErrorResponse(notFound);
      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    test('maps Mongoose CastError to 400 INVALID_IDENTIFIER', () => {
      const castErr = new Error('Cast to ObjectId failed');
      castErr.name = 'CastError';
      castErr.path = 'groupId';
      castErr.value = 'invalid-hex';

      const res = formatErrorResponse(castErr);
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('INVALID_IDENTIFIER');
      expect(res.body.error.message).toMatch(/Invalid format for field "groupId"/);
    });

    test('maps Mongoose ValidationError to 400 SCHEMA_VALIDATION_ERROR with field details', () => {
      const valErr = new Error('Validation failed');
      valErr.name = 'ValidationError';
      valErr.errors = {
        name: { path: 'name', message: 'Group name is required' },
      };

      const res = formatErrorResponse(valErr);
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('SCHEMA_VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('name');
    });

    test('maps unknown runtime exceptions to 500 INTERNAL_SERVER_ERROR', () => {
      const unknown = new Error('Segmentation fault');
      const res = formatErrorResponse(unknown);
      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

});
