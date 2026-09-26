const {
  simplifyDebts,
  validateDebts,
  calculateNetBalances,
  buildGraph,
  findConnectedComponents,
  partitionDebtorsAndCreditors,
  findIntermediary,
  greedyMatchComponent,
  consolidateTransactions,
  splitExpense,
  calculatePercentageSplit,
  calculateSharesSplit,
} = require('../src/simplifier');

/**
 * Reusable test helper that verifies critical mathematical invariants:
 * 1. Conservation of money: every person's net balance after settlement
 *    must match their net balance from the raw input debts.
 * 2. Constraints: no settlement transaction violates any forbidden edge.
 * 3. All settlement amounts are positive integers in cents.
 */
function verifySettlementInvariants(originalDebts, settlementPlan, constraints = []) {
  // 1. Calculate target net balance per person from raw debts
  const expectedBalances = new Map();
  for (const { from, to, amount } of originalDebts) {
    if (from === to) continue;
    expectedBalances.set(from, (expectedBalances.get(from) || 0) - amount);
    expectedBalances.set(to, (expectedBalances.get(to) || 0) + amount);
  }

  // 2. Calculate actual net balance achieved by the settlement plan
  const actualBalances = new Map();
  for (const { from, to, amount } of settlementPlan) {
    expect(Number.isInteger(amount)).toBe(true);
    expect(amount).toBeGreaterThan(0);

    actualBalances.set(from, (actualBalances.get(from) || 0) - amount);
    actualBalances.set(to, (actualBalances.get(to) || 0) + amount);
  }

  // Verify that all non-zero expected balances are exactly satisfied
  const allPeople = new Set([...expectedBalances.keys(), ...actualBalances.keys()]);
  for (const person of allPeople) {
    const expected = expectedBalances.get(person) || 0;
    const actual = actualBalances.get(person) || 0;
    expect(actual).toBe(expected);
  }

  // 3. Verify no forbidden constraint was violated
  const forbiddenEdges = new Set(
    constraints.map(c => `${c.avoid[0].trim()}->${c.avoid[1].trim()}`)
  );
  for (const { from, to } of settlementPlan) {
    const edgeKey = `${from}->${to}`;
    expect(forbiddenEdges.has(edgeKey)).toBe(false);
  }
}

describe('SettleUp Core Debt Simplification Engine', () => {

  describe('1. Simple Triangle Debt & Cycles', () => {
    test('settles a perfect 3-person cycle (A -> B -> C -> A) to zero transactions', () => {
      const debts = [
        { from: 'Alice', to: 'Bob', amount: 3000 },
        { from: 'Bob', to: 'Charlie', amount: 3000 },
        { from: 'Charlie', to: 'Alice', amount: 3000 },
      ];

      const result = simplifyDebts(debts);

      // Since all net balances are 0, no transactions should be needed!
      expect(result).toEqual([]);
      verifySettlementInvariants(debts, result);
    });

    test('settles asymmetric 5-person debt graph with cycles and collapses to 3 transactions', () => {
      // 6 raw debts totaling $165.00 (16500 cents)
      const debts = [
        { from: 'Alice', to: 'Bob', amount: 3000 },
        { from: 'Bob', to: 'Charlie', amount: 4000 },
        { from: 'Charlie', to: 'Alice', amount: 2000 }, // cycle leg
        { from: 'David', to: 'Bob', amount: 2500 },
        { from: 'Charlie', to: 'Emma', amount: 3500 },
        { from: 'Alice', to: 'Emma', amount: 1500 },
      ];

      const result = simplifyDebts(debts);

      // Verifies the exact mathematical walkthrough:
      // Alice net: -2500, David net: -2500, Charlie net: -1500
      // Emma net: +5000, Bob net: +1500
      // Expected transactions:
      // 1. Alice -> Emma ($25.00)
      // 2. Charlie -> Bob ($15.00)
      // 3. David -> Emma ($25.00)
      expect(result).toHaveLength(3);
      expect(result).toEqual([
        { from: 'Alice', to: 'Emma', amount: 2500 },
        { from: 'Charlie', to: 'Bob', amount: 1500 },
        { from: 'David', to: 'Emma', amount: 2500 },
      ]);

      verifySettlementInvariants(debts, result);
    });

    test('collapses a 4-person diamond cycle into minimal transactions', () => {
      const debts = [
        { from: 'A', to: 'B', amount: 1000 },
        { from: 'B', to: 'C', amount: 1000 },
        { from: 'C', to: 'D', amount: 1000 },
        { from: 'D', to: 'A', amount: 1000 },
      ];

      const result = simplifyDebts(debts);
      expect(result).toEqual([]);
      verifySettlementInvariants(debts, result);
    });
  });

  describe('2. Disconnected Subgroups (Independent Settlement)', () => {
    test('settles two disconnected groups independently without cross-group transfers', () => {
      // Group 1: Trip to Paris (Alice, Bob, Charlie)
      // Group 2: Trip to Tokyo (David, Emma, Frank)
      const debts = [
        // Group 1
        { from: 'Alice', to: 'Bob', amount: 5000 },
        { from: 'Bob', to: 'Charlie', amount: 5000 },
        // Group 2
        { from: 'David', to: 'Emma', amount: 4000 },
        { from: 'Emma', to: 'Frank', amount: 4000 },
      ];

      const result = simplifyDebts(debts);

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { from: 'Alice', to: 'Charlie', amount: 5000 },
        { from: 'David', to: 'Frank', amount: 4000 },
      ]);

      // Crucial verification: Alice or Bob NEVER pay David, Emma, or Frank
      const group1Participants = new Set(['Alice', 'Bob', 'Charlie']);
      const group2Participants = new Set(['David', 'Emma', 'Frank']);

      for (const { from, to } of result) {
        const bothInG1 = group1Participants.has(from) && group1Participants.has(to);
        const bothInG2 = group2Participants.has(from) && group2Participants.has(to);
        expect(bothInG1 || bothInG2).toBe(true);
      }

      verifySettlementInvariants(debts, result);
    });

    test('handles multiple isolated 2-person pairs independently', () => {
      const debts = [
        { from: 'User1', to: 'User2', amount: 1200 },
        { from: 'User3', to: 'User4', amount: 3400 },
        { from: 'User5', to: 'User6', amount: 5600 },
      ];

      const result = simplifyDebts(debts);
      expect(result).toHaveLength(3);
      expect(result).toEqual([
        { from: 'User1', to: 'User2', amount: 1200 },
        { from: 'User3', to: 'User4', amount: 3400 },
        { from: 'User5', to: 'User6', amount: 5600 },
      ]);

      verifySettlementInvariants(debts, result);
    });
  });

  describe('3. Exact Zero-Sum & Passive Participants', () => {
    test('completely bypasses passive participant whose net balance is zero', () => {
      // Bob pays for dinner, but also consumed an equal amount from Alice and Charlie
      const debts = [
        { from: 'Alice', to: 'Bob', amount: 2000 },
        { from: 'Bob', to: 'Charlie', amount: 2000 },
      ];

      const result = simplifyDebts(debts);

      // Bob's net balance: +2000 - 2000 = 0.
      // Settlement should bypass Bob entirely!
      expect(result).toEqual([
        { from: 'Alice', to: 'Charlie', amount: 2000 },
      ]);

      verifySettlementInvariants(debts, result);
    });

    test('cancels mutual direct debts (A owes B, B owes A)', () => {
      const debts = [
        { from: 'Alice', to: 'Bob', amount: 7000 },
        { from: 'Bob', to: 'Alice', amount: 3000 },
      ];

      const result = simplifyDebts(debts);

      expect(result).toEqual([
        { from: 'Alice', to: 'Bob', amount: 4000 },
      ]);

      verifySettlementInvariants(debts, result);
    });

    test('returns empty array when input debts array is empty', () => {
      expect(simplifyDebts([])).toEqual([]);
    });

    test('filters out self-debts (from === to)', () => {
      const debts = [
        { from: 'Alice', to: 'Alice', amount: 5000 },
        { from: 'Bob', to: 'Alice', amount: 2500 },
      ];

      const result = simplifyDebts(debts);
      expect(result).toEqual([
        { from: 'Bob', to: 'Alice', amount: 2500 },
      ]);

      verifySettlementInvariants(debts, result);
    });
  });

  describe('4. Rounding Leftovers & Conservation of Money', () => {
    test('splitExpense deterministically assigns remainder cents without losing or fabricating money', () => {
      // $10.00 (1000 cents) split among 3 people (Alice, Bob, Charlie) paid by Alice
      const debts = splitExpense({
        totalCents: 1000,
        paidBy: 'Alice',
        splitBetween: ['Alice', 'Bob', 'Charlie'],
      });

      // 1000 / 3 = 333 remainder 1.
      // Participants sorted alphabetically: Alice (index 0), Bob (index 1), Charlie (index 2).
      // Alice share: 333 + 1 = 334 cents.
      // Bob share: 333 cents.
      // Charlie share: 333 cents.
      // Total shares: 334 + 333 + 333 = 1000 cents.
      expect(debts).toHaveLength(2); // Bob and Charlie owe Alice
      expect(debts).toEqual([
        { from: 'Bob', to: 'Alice', amount: 333 },
        { from: 'Charlie', to: 'Alice', amount: 333 },
      ]);

      // When settled, Alice receives 666 cents, having spent 1000 and consumed 334
      const result = simplifyDebts(debts);
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { from: 'Bob', to: 'Alice', amount: 333 },
        { from: 'Charlie', to: 'Alice', amount: 333 },
      ]);

      verifySettlementInvariants(debts, result);
    });

    test('splitExpense correctly allocates multiple remainder cents (e.g. $1.00 split 7 ways)', () => {
      const participants = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
      const debts = splitExpense({
        totalCents: 100, // 100 cents / 7 = 14 remainder 2
        paidBy: 'P1',
        splitBetween: participants,
      });

      // 2 people get 15 cents, 5 people get 14 cents: 2*15 + 5*14 = 30 + 70 = 100 cents!
      const totalOwed = debts.reduce((sum, d) => sum + d.amount, 0);
      // P1's own share is 15 cents, so remaining 6 people owe 85 cents
      expect(totalOwed).toBe(85);

      const result = simplifyDebts(debts);
      verifySettlementInvariants(debts, result);
    });

    describe('calculatePercentageSplit', () => {
      test('normal clean case: splits 10000 cents with 50%, 30%, 20%', () => {
        const splits = calculatePercentageSplit(10000, [
          { user: 'Alice', percentage: 50 },
          { user: 'Bob', percentage: 30 },
          { user: 'Charlie', percentage: 20 },
        ]);

        expect(splits).toEqual([
          { user: 'Alice', amount: 5000 },
          { user: 'Bob', amount: 3000 },
          { user: 'Charlie', amount: 2000 },
        ]);
        const sum = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(sum).toBe(10000);
      });

      test('odd remainder case: splits 1000 cents with 33.34%, 33.33%, 33.33%', () => {
        const splits = calculatePercentageSplit(1000, [
          { user: 'Alice', percentage: 33.34 },
          { user: 'Bob', percentage: 33.33 },
          { user: 'Charlie', percentage: 33.33 },
        ]);

        expect(splits).toEqual([
          { user: 'Alice', amount: 334 },
          { user: 'Bob', amount: 333 },
          { user: 'Charlie', amount: 333 },
        ]);
        const sum = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(sum).toBe(1000);
      });

      test('rejects percentage split that does not sum to 100%', () => {
        expect(() =>
          calculatePercentageSplit(10000, [
            { user: 'Alice', percentage: 50 },
            { user: 'Bob', percentage: 40 },
          ])
        ).toThrow(/Percentages must sum to exactly 100%/);

        expect(() =>
          calculatePercentageSplit(10000, [
            { user: 'Alice', percentage: 60 },
            { user: 'Bob', percentage: 50 },
          ])
        ).toThrow(/Percentages must sum to exactly 100%/);
      });
    });

    describe('calculateSharesSplit', () => {
      test('normal clean case: splits 10000 cents with 2:2:1 ratio', () => {
        const splits = calculateSharesSplit(10000, [
          { user: 'Alice', shares: 2 },
          { user: 'Bob', shares: 2 },
          { user: 'Charlie', shares: 1 },
        ]);

        expect(splits).toEqual([
          { user: 'Alice', amount: 4000 },
          { user: 'Bob', amount: 4000 },
          { user: 'Charlie', amount: 2000 },
        ]);
        const sum = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(sum).toBe(10000);
      });

      test('odd remainder case: splits 1001 cents with 2:2:1 ratio requiring cent-distribution', () => {
        // 1001 * 2 / 5 = 400.4 (Alice and Bob have largest frac 0.4; Alice is alphabetically first)
        // 1001 * 1 / 5 = 200.2 (Charlie frac 0.2)
        // Alice absorbs the 1 leftover remainder cent
        const splits = calculateSharesSplit(1001, [
          { user: 'Alice', shares: 2 },
          { user: 'Bob', shares: 2 },
          { user: 'Charlie', shares: 1 },
        ]);

        expect(splits).toEqual([
          { user: 'Alice', amount: 401 },
          { user: 'Bob', amount: 400 },
          { user: 'Charlie', amount: 200 },
        ]);
        const sum = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(sum).toBe(1001);
      });

      test('odd remainder case with multiple leftover cents (1000 cents with 1:2:4 ratio)', () => {
        const splits = calculateSharesSplit(1000, [
          { user: 'Alice', shares: 1 },
          { user: 'Bob', shares: 2 },
          { user: 'Charlie', shares: 4 },
        ]);

        // 1000 / 7 = 142.857 -> Alice: 143
        // 2000 / 7 = 285.714 -> Bob: 286
        // 4000 / 7 = 571.428 -> Charlie: 571
        expect(splits).toEqual([
          { user: 'Alice', amount: 143 },
          { user: 'Bob', amount: 286 },
          { user: 'Charlie', amount: 571 },
        ]);
        const sum = splits.reduce((acc, s) => acc + s.amount, 0);
        expect(sum).toBe(1000);
      });

      test('rejects total shares less than or equal to zero', () => {
        expect(() =>
          calculateSharesSplit(5000, [
            { user: 'Alice', shares: 0 },
            { user: 'Bob', shares: 0 },
          ])
        ).toThrow(/Total shares must be greater than 0/);
      });
    });

    test('rejects floating-point numbers to prevent fractional cent drift', () => {
      const invalidDebts = [
        { from: 'Alice', to: 'Bob', amount: 10.5 },
      ];

      expect(() => simplifyDebts(invalidDebts)).toThrow(
        /Debt at index 0 amount must be an integer in cents \(got 10\.5\)/
      );
    });

    test('rejects negative and zero amounts', () => {
      expect(() => simplifyDebts([{ from: 'A', to: 'B', amount: 0 }])).toThrow(
        /Debt at index 0 amount must be strictly positive/
      );
      expect(() => simplifyDebts([{ from: 'A', to: 'B', amount: -50 }])).toThrow(
        /Debt at index 0 amount must be strictly positive/
      );
    });

    test('rejects invalid participant identifiers and non-array debts', () => {
      expect(() => simplifyDebts('not an array')).toThrow(TypeError);
      expect(() => simplifyDebts([{ from: '', to: 'B', amount: 100 }])).toThrow(
        /invalid "from" identifier/
      );
      expect(() => simplifyDebts([{ from: 'A', to: '   ', amount: 100 }])).toThrow(
        /invalid "to" identifier/
      );
    });
  });

  describe('5. Constraint-Aware Settlement & Intermediary Routing', () => {
    test('routes through a neutral intermediary when direct payment is forbidden', () => {
      // Alice owes Bob $50.00 (5000 cents).
      // Constraint: Alice must NEVER pay Bob directly.
      // Charlie is a known mutual participant in the trip.
      const debts = [
        { from: 'Alice', to: 'Bob', amount: 5000 },
      ];
      const constraints = [{ avoid: ['Alice', 'Bob'] }];
      const participants = ['Alice', 'Bob', 'Charlie'];

      const result = simplifyDebts(debts, { constraints, participants });

      // Alice should pay Charlie, and Charlie should pay Bob
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { from: 'Alice', to: 'Charlie', amount: 5000 },
        { from: 'Charlie', to: 'Bob', amount: 5000 },
      ]);

      verifySettlementInvariants(debts, result, constraints);
    });

    test('routes around constraint using alternate active creditor without increasing transaction count', () => {
      // Alice owes $50. Bob is owed $30, Charlie is owed $20.
      // Constraint: Alice must never pay Bob directly.
      const debts = [
        { from: 'Alice', to: 'Bob', amount: 3000 },
        { from: 'Alice', to: 'Charlie', amount: 2000 },
      ];
      const constraints = [{ avoid: ['Alice', 'Bob'] }];

      const result = simplifyDebts(debts, { constraints });

      // Alice cannot pay Bob.
      // Minimal route: Alice pays Charlie $50, Charlie keeps $20 and passes $30 to Bob!
      // Total transactions: only 2!
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { from: 'Alice', to: 'Charlie', amount: 5000 },
        { from: 'Charlie', to: 'Bob', amount: 3000 },
      ]);

      verifySettlementInvariants(debts, result, constraints);
    });

    test('respects multiple constraints and chooses a valid unconstrained intermediary', () => {
      // Alice owes Dave 4000.
      // Constraints: Alice cannot pay Dave, and Alice cannot pay Bob.
      // Participants: Alice, Dave, Bob, Charlie.
      const debts = [{ from: 'Alice', to: 'Dave', amount: 4000 }];
      const constraints = [
        { avoid: ['Alice', 'Dave'] },
        { avoid: ['Alice', 'Bob'] },
      ];
      const participants = ['Alice', 'Dave', 'Bob', 'Charlie'];

      const result = simplifyDebts(debts, { constraints, participants });

      // Charlie must be chosen as intermediary since Alice->Bob is forbidden
      expect(result).toEqual([
        { from: 'Alice', to: 'Charlie', amount: 4000 },
        { from: 'Charlie', to: 'Dave', amount: 4000 },
      ]);

      verifySettlementInvariants(debts, result, constraints);
    });

    test('throws a descriptive error when constraints make settlement impossible', () => {
      // Only Alice and Bob exist, and Alice cannot pay Bob
      const debts = [{ from: 'Alice', to: 'Bob', amount: 5000 }];
      const constraints = [{ avoid: ['Alice', 'Bob'] }];

      expect(() => simplifyDebts(debts, { constraints })).toThrow(
        /Cannot satisfy constraints: no valid direct route or intermediary available/
      );
    });
  });

  describe('6. Function Decomposition Unit Tests (Interview Walkthrough)', () => {
    test('validateDebts sanitizes whitespace and removes self-debts', () => {
      const raw = [
        { from: ' Alice ', to: 'Bob ', amount: 1000 },
        { from: 'Charlie', to: 'Charlie', amount: 500 },
      ];
      const clean = validateDebts(raw);
      expect(clean).toEqual([
        { from: 'Alice', to: 'Bob', amount: 1000 },
      ]);
    });

    test('buildGraph correctly maps undirected connectivity', () => {
      const debts = [
        { from: 'A', to: 'B', amount: 100 },
        { from: 'B', to: 'C', amount: 200 },
      ];
      const graph = buildGraph(debts);
      expect(graph.get('A').has('B')).toBe(true);
      expect(graph.get('B').has('A')).toBe(true);
      expect(graph.get('B').has('C')).toBe(true);
      expect(graph.get('A').has('C')).toBe(false);
    });

    test('findConnectedComponents separates disjoint debt groups', () => {
      const debts = [
        { from: 'A', to: 'B', amount: 100 },
        { from: 'C', to: 'D', amount: 200 },
      ];
      const components = findConnectedComponents(debts);
      expect(components).toHaveLength(2);
      expect(Array.from(components[0].participants).sort()).toEqual(['A', 'B']);
      expect(Array.from(components[1].participants).sort()).toEqual(['C', 'D']);
    });

    test('calculateNetBalances computes correct signed net balance', () => {
      const debts = [
        { from: 'A', to: 'B', amount: 1000 },
        { from: 'B', to: 'C', amount: 400 },
      ];
      const balances = calculateNetBalances(debts);
      expect(balances.get('A')).toBe(-1000);
      expect(balances.get('B')).toBe(600); // received 1000, owes 400
      expect(balances.get('C')).toBe(400); // received 400
    });

    test('partitionDebtorsAndCreditors partitions and verifies zero-sum conservation', () => {
      const balances = new Map([
        ['A', -1000],
        ['B', 600],
        ['C', 400],
        ['Neutral', 0],
      ]);
      const { debtors, creditors } = partitionDebtorsAndCreditors(balances);
      expect(debtors).toEqual([{ person: 'A', amount: 1000 }]);
      expect(creditors).toEqual([
        { person: 'B', amount: 600 },
        { person: 'C', amount: 400 },
      ]);
    });

    test('partitionDebtorsAndCreditors throws if conservation of money is violated', () => {
      const unbalanced = new Map([
        ['A', -1000],
        ['B', 900], // 100 cents missing!
      ]);
      expect(() => partitionDebtorsAndCreditors(unbalanced)).toThrow(
        /Conservation of money violated/
      );
    });

    test('findIntermediary returns null if no valid candidate exists', () => {
      const candidates = new Set(['Alice', 'Bob']); // no third party
      const forbidden = new Set();
      expect(findIntermediary('Alice', 'Bob', candidates, forbidden)).toBeNull();
    });

    test('consolidateTransactions merges duplicate payments and nets reverse payments', () => {
      const txs = [
        { from: 'A', to: 'B', amount: 300 },
        { from: 'A', to: 'B', amount: 200 }, // same pair, same direction
        { from: 'B', to: 'A', amount: 100 }, // reverse direction
      ];
      const consolidated = consolidateTransactions(txs);
      expect(consolidated).toEqual([
        { from: 'A', to: 'B', amount: 400 }, // 300 + 200 - 100 = 400
      ]);
    });
  });

});
