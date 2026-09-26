const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const os = require('os');
const { User, Group, Expense, LedgerEntry, ExchangeRate } = require('../src/models');
const {
  getExchangeRates,
  convertAmount,
  fetchLiveExchangeRates,
} = require('../src/services/currencyService');
const {
  recordExpense,
  settleGroup,
  getUserBalancesAcrossGroups,
} = require('../src/services/settlementService');

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

describe('Phase 3: Currency Conversion & Multi-Currency Ledger', () => {

  describe('1. FX Rates Caching & Provider Integration', () => {
    test('fetches live rates, saves to MongoDB, and returns cached rates on subsequent calls', async () => {
      let fetchCallCount = 0;
      const mockFetch = async () => {
        fetchCallCount++;
        return {
          ok: true,
          json: async () => ({
            result: 'success',
            base_code: 'USD',
            time_last_update_unix: Math.floor(Date.now() / 1000),
            rates: {
              USD: 1.0,
              EUR: 0.92,
              GBP: 0.79,
              INR: 83.5,
            },
          }),
        };
      };

      // Call 1: Cache is empty, triggers live fetch
      const result1 = await getExchangeRates('USD', { customFetch: mockFetch, ttlHours: 24 });
      expect(result1.source).toBe('live');
      expect(result1.isStale).toBe(false);
      expect(result1.rates.EUR).toBe(0.92);
      expect(fetchCallCount).toBe(1);

      // Verify persisted to MongoDB
      const dbDoc = await ExchangeRate.findOne({ baseCurrency: 'USD' });
      expect(dbDoc).not.toBeNull();
      expect(dbDoc.rates.get('EUR')).toBe(0.92);

      // Call 2: Within 24h TTL, should hit MongoDB cache without calling fetch again!
      const result2 = await getExchangeRates('USD', { customFetch: mockFetch, ttlHours: 24 });
      expect(result2.source).toBe('cache');
      expect(result2.isStale).toBe(false);
      expect(result2.rates.EUR).toBe(0.92);
      expect(fetchCallCount).toBe(1); // STILL 1! No second network request made!
    });

    test('refreshes cache when rates are older than ttlHours', async () => {
      // Seed an expired cache document (30 hours old)
      const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000);
      await ExchangeRate.create({
        baseCurrency: 'USD',
        rates: { EUR: 0.88 },
        fetchedAt: thirtyHoursAgo,
        ttlHours: 24,
      });

      let fetched = false;
      const mockFetch = async () => {
        fetched = true;
        return {
          ok: true,
          json: async () => ({
            result: 'success',
            base_code: 'USD',
            rates: { EUR: 0.93 },
          }),
        };
      };

      const rates = await getExchangeRates('USD', { customFetch: mockFetch, ttlHours: 24 });
      expect(fetched).toBe(true);
      expect(rates.source).toBe('live');
      expect(rates.rates.EUR).toBe(0.93);
    });

    test('falls back to stale cache and flags isStale=true when live provider fails', async () => {
      // Seed a cached rate from 10 hours ago
      const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
      await ExchangeRate.create({
        baseCurrency: 'EUR',
        rates: { USD: 1.08, GBP: 0.85 },
        fetchedAt: tenHoursAgo,
        ttlHours: 1, // expired for testing refresh
      });

      // Provider throws a 500 error or network failure
      const failingFetch = async () => {
        throw new Error('500 Internal Server Error (Provider Down)');
      };

      const rates = await getExchangeRates('EUR', {
        customFetch: failingFetch,
        ttlHours: 1,
      });

      // Crucial requirement: Must fallback to last cached rate and flag it as stale!
      expect(rates.source).toBe('stale-cache');
      expect(rates.isStale).toBe(true);
      expect(rates.staleReason).toMatch(/Provider Down/);
      expect(rates.rates.USD).toBe(1.08);
    });

    test('falls back to built-in baseline table on cold start when provider fails and cache is empty', async () => {
      const failingFetch = async () => {
        throw new Error('Network offline');
      };

      const rates = await getExchangeRates('USD', { customFetch: failingFetch });
      expect(rates.source).toBe('builtin-fallback');
      expect(rates.isStale).toBe(true);
      expect(rates.rates.EUR).toBeDefined();
    });
  });

  describe('2. Integer Cents Currency Conversion Precision', () => {
    test('converts currency with exact rounding in integer cents', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          result: 'success',
          rates: { USD: 1.085 }, // 1 EUR = 1.085 USD
        }),
      });

      // Convert 20.00 EUR (2000 cents) -> 2000 * 1.085 = 2170 USD cents
      const result = await convertAmount({
        amountCents: 2000,
        fromCurrency: 'EUR',
        toCurrency: 'USD',
        options: { customFetch: mockFetch },
      });

      expect(result.convertedCents).toBe(2170);
      expect(Number.isInteger(result.convertedCents)).toBe(true);
      expect(result.rate).toBe(1.085);
      expect(result.isStale).toBe(false);
    });

    test('identity conversion (same currency) has rate 1.0 and zero drift', async () => {
      const result = await convertAmount({
        amountCents: 5000,
        fromCurrency: 'USD',
        toCurrency: 'USD',
      });

      expect(result.convertedCents).toBe(5000);
      expect(result.rate).toBe(1.0);
      expect(result.isStale).toBe(false);
    });

    test('rejects non-integer cent amounts', async () => {
      await expect(
        convertAmount({ amountCents: 10.5, fromCurrency: 'EUR', toCurrency: 'USD' })
      ).rejects.toThrow(/positive integer/);
    });
  });

  describe('3. Multi-Currency Group Expenses & Ledger Auditability', () => {
    let alice, bob, charlie, group;

    beforeEach(async () => {
      alice = await User.create({ name: 'Alice', email: 'alice_fx@test.com' });
      bob = await User.create({ name: 'Bob', email: 'bob_fx@test.com' });
      charlie = await User.create({ name: 'Charlie', email: 'charlie_fx@test.com' });

      // Group chosen base currency is USD
      group = await Group.create({
        name: 'Eurotrip 2026',
        baseCurrency: 'USD',
        members: [alice._id, bob._id, charlie._id],
      });
    });

    test('records multi-currency expense in EUR, converts to group USD base, and preserves audit trail', async () => {
      // Mock exchange rate: 1 EUR = 1.10 USD
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          result: 'success',
          rates: { USD: 1.10 },
        }),
      });

      // Alice pays 90.00 EUR (9000 cents) for Alice, Bob, Charlie (3000 EUR cents each)
      // Converted share for Bob and Charlie: 3000 * 1.10 = 3300 USD cents ($33.00)
      const { expense, ledgerEntries } = await recordExpense({
        groupId: group._id,
        description: 'Dinner in Paris',
        paidBy: alice._id,
        totalAmount: 9000,
        currency: 'EUR', // Original expense currency is EUR!
        splits: [
          { user: alice._id, amount: 3000 },
          { user: bob._id, amount: 3000 },
          { user: charlie._id, amount: 3000 },
        ],
        fxOptions: { customFetch: mockFetch },
      });

      expect(expense.currency).toBe('EUR');
      expect(expense.totalAmount).toBe(9000);

      // Verify the double-entry records in the immutable ledger
      expect(ledgerEntries).toHaveLength(4); // 2 non-payer participants * 2 entries each

      // Find Bob's debit entry
      const bobEntry = await LedgerEntry.findOne({
        group: group._id,
        user: bob._id,
        direction: 'DEBIT',
      });

      // Converted amount in group base currency (USD)
      expect(bobEntry.amount).toBe(3300); // 3300 USD cents
      expect(bobEntry.currency).toBe('USD');

      // Crucial requirement: Original currency and amount PRESERVED for audit!
      expect(bobEntry.originalAmount).toBe(3000); // 3000 EUR cents
      expect(bobEntry.originalCurrency).toBe('EUR');
      expect(bobEntry.exchangeRate).toBe(1.10);
      expect(bobEntry.isFxStale).toBe(false);

      // Verify balances across groups are tracked in the group base currency (USD)
      const [aliceBalance] = await getUserBalancesAcrossGroups(alice._id, 'USD');
      // Alice paid 60.00 EUR for others -> 6600 USD cents (+66.00)
      expect(aliceBalance.netBalanceCents).toBe(6600);

      const [bobBalance] = await getUserBalancesAcrossGroups(bob._id, 'USD');
      expect(bobBalance.netBalanceCents).toBe(-3300); // Owes $33.00 USD
    });

    test('flags isFxStale=true in LedgerEntry when FX rate was from stale cache', async () => {
      // Seed a stale cache (10 hours ago with 1h TTL)
      const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
      await ExchangeRate.create({
        baseCurrency: 'GBP',
        rates: { USD: 1.25 },
        fetchedAt: tenHoursAgo,
        ttlHours: 1,
      });

      // Provider fails
      const failingFetch = async () => {
        throw new Error('API Rate limit exceeded');
      };

      await recordExpense({
        groupId: group._id,
        description: 'London Museum',
        paidBy: alice._id,
        totalAmount: 2000, // 20.00 GBP
        currency: 'GBP',
        splits: [
          { user: bob._id, amount: 2000 },
        ],
        fxOptions: { customFetch: failingFetch, ttlHours: 1 },
      });

      // Verify the ledger entry was flagged as stale for the UI
      const entry = await LedgerEntry.findOne({
        group: group._id,
        user: bob._id,
      });

      expect(entry.isFxStale).toBe(true);
      expect(entry.originalCurrency).toBe('GBP');
      expect(entry.currency).toBe('USD');
      expect(entry.amount).toBe(2500); // 2000 * 1.25 = 2500 USD cents
    });

    test('settles a multi-currency group cleanly in base currency', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          result: 'success',
          rates: { USD: 1.10 },
        }),
      });

      // Expense 1: 90.00 EUR split 3 ways (3000 EUR each -> 3300 USD cents each)
      await recordExpense({
        groupId: group._id,
        description: 'Paris Hotel',
        paidBy: alice._id,
        totalAmount: 9000,
        currency: 'EUR',
        splits: [
          { user: alice._id, amount: 3000 },
          { user: bob._id, amount: 3000 },
          { user: charlie._id, amount: 3000 },
        ],
        fxOptions: { customFetch: mockFetch },
      });

      // Settle group in base currency (USD)
      const settlement = await settleGroup({ groupId: group._id });

      expect(settlement.transactions).toHaveLength(2);
      // Bob pays Alice $33.00, Charlie pays Alice $33.00
      expect(settlement.transactions).toEqual([
        { from: bob._id.toString(), to: alice._id.toString(), amount: 3300 },
        { from: charlie._id.toString(), to: alice._id.toString(), amount: 3300 },
      ]);

      // All net balances are now exactly 0 in group base currency
      const [aliceAfter] = await getUserBalancesAcrossGroups(alice._id, 'USD');
      const [bobAfter] = await getUserBalancesAcrossGroups(bob._id, 'USD');
      const [charlieAfter] = await getUserBalancesAcrossGroups(charlie._id, 'USD');

      expect(aliceAfter.netBalanceCents).toBe(0);
      expect(bobAfter.netBalanceCents).toBe(0);
      expect(charlieAfter.netBalanceCents).toBe(0);
    });
  });

});
