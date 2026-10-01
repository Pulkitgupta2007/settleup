/**
 * SettleUp - Debt Simplification Algorithmic Core
 * 
 * Standalone, pure JavaScript module (zero external dependencies).
 * Computes the minimal set of transactions to balance pairwise group debts
 * using graph component partitioning, net balance reduction, and greedy
 * constraint-aware matching.
 * 
 * KEY ARCHITECTURAL PRINCIPLES:
 * 1. Integer Cents: All monetary amounts are handled strictly as integer cents
 *    to prevent IEEE 754 floating-point rounding errors (e.g. 0.1 + 0.2 !== 0.3).
 * 2. Invariant Conservation: The sum of net balances across any closed group
 *    is mathematically guaranteed to be zero (sum of debts === sum of credits).
 * 3. Cycle Elimination: Graph reduction aggregates arbitrary pairwise debts
 *    into scalar net balances per node, collapsing all cycles in O(E) time.
 * 4. Bounded Transactions: Greedy matching guarantees at most N - 1 transactions
 *    for N non-zero balance participants (the optimal upper bound for a connected component).
 * 5. Constraint Avoidance: When direct settlement between two parties is restricted,
 *    settlement is rerouted through a third-party intermediary without altering the
 *    intermediary's net financial balance (inflow matches outflow exactly).
 */

/**
 * Tolerance for percentage sum floating point verification.
 * Floating point addition (e.g. 33.33 + 33.33 + 33.34) can yield 100.00000000000001.
 */
const PERCENTAGE_SUM_TOLERANCE = 1e-4;

/**
 * Epsilon for comparing fractional remainder cents.
 * Distinguishes true remainder fractions from IEEE 754 precision noise.
 */
const FRACTIONAL_CENT_EPSILON = 1e-9;

/**
 * Deterministic comparator for debtor and creditor heaps/arrays.
 * Sorts primarily by balance amount descending (greedy largest first),
 * tie-breaking alphabetically by participant identifier.
 * 
 * @param {{ person: string, amount: number }} a
 * @param {{ person: string, amount: number }} b
 * @returns {number}
 */
function compareByAmountDescAndName(a, b) {
  return b.amount - a.amount || a.person.localeCompare(b.person);
}

/**
 * Validates an array of input debts.
 * Enforces positive integer amounts (cents) and non-empty participant identifiers.
 * Filters out trivial self-debts (from === to).
 * 
 * @param {Array<{ from: string, to: string, amount: number }>} debts
 * @throws {TypeError|Error} if validation fails
 * @returns {Array<{ from: string, to: string, amount: number }>} sanitized debts
 */
function validateDebts(debts) {
  if (!Array.isArray(debts)) {
    throw new TypeError('Debts must be an array');
  }

  const sanitized = [];

  for (let i = 0; i < debts.length; i++) {
    const d = debts[i];
    if (!d || typeof d !== 'object') {
      throw new TypeError(`Debt at index ${i} must be an object`);
    }

    const { from, to, amount } = d;

    if (!from || typeof from !== 'string' || from.trim() === '') {
      throw new Error(`Debt at index ${i} has invalid "from" identifier`);
    }

    if (!to || typeof to !== 'string' || to.trim() === '') {
      throw new Error(`Debt at index ${i} has invalid "to" identifier`);
    }

    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new TypeError(`Debt at index ${i} amount must be a number`);
    }

    if (!Number.isInteger(amount)) {
      throw new Error(`Debt at index ${i} amount must be an integer in cents (got ${amount})`);
    }

    if (amount <= 0) {
      throw new Error(`Debt at index ${i} amount must be strictly positive (got ${amount})`);
    }

    // Filter out self-debts (owing oneself has no net financial impact)
    if (from.trim() === to.trim()) {
      continue;
    }

    sanitized.push({
      from: from.trim(),
      to: to.trim(),
      amount,
    });
  }

  return sanitized;
}

/**
 * Builds an undirected adjacency graph from a list of debts.
 * Used for BFS connected component discovery.
 * 
 * @param {Array<{ from: string, to: string, amount: number }>} debts
 * @returns {Map<string, Set<string>>} adjacency list mapping participant -> neighbors
 */
function buildGraph(debts) {
  const adj = new Map();

  function addEdge(u, v) {
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u).add(v);
    adj.get(v).add(u);
  }

  for (const debt of debts) {
    addEdge(debt.from, debt.to);
  }

  return adj;
}

/**
 * Partitions the debt graph into connected components via BFS.
 * 
 * Mathematical Justification:
 * Disconnected subgroups (e.g. Subgroup 1: [Alice, Bob], Subgroup 2: [Charlie, David])
 * have independent balance sums. Settling them within their isolated components
 * guarantees that money never crosses between unrelated parties.
 * 
 * @param {Array<{ from: string, to: string, amount: number }>} debts
 * @returns {Array<{ participants: Set<string>, debts: Array<{ from: string, to: string, amount: number }> }>}
 */
function findConnectedComponents(debts) {
  if (debts.length === 0) return [];

  const adj = buildGraph(debts);
  const visited = new Set();
  const components = [];

  for (const person of adj.keys()) {
    if (visited.has(person)) continue;

    const componentParticipants = new Set();
    const queue = [person];
    visited.add(person);

    while (queue.length > 0) {
      const current = queue.shift();
      componentParticipants.add(current);

      const neighbors = adj.get(current) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // Extract debts where both endpoints belong to this connected component
    const componentDebts = debts.filter(
      d => componentParticipants.has(d.from) && componentParticipants.has(d.to)
    );

    components.push({
      participants: componentParticipants,
      debts: componentDebts,
    });
  }

  return components;
}

/**
 * Calculates net scalar balance for each participant in a set of debts.
 * 
 * Invariant: Net balance = (inflow: total owed to user) - (outflow: total user owes).
 * - Positive (> 0): Creditor (is owed money overall)
 * - Negative (< 0): Debtor (owes money overall)
 * - Zero (=== 0): Settled / Neutral
 * 
 * This O(E) reduction collapses arbitrary directed debt cycles (e.g. A->B->C->A)
 * into scalar net balances, drastically shrinking the problem space.
 * 
 * @param {Array<{ from: string, to: string, amount: number }>} debts
 * @returns {Map<string, number>} mapping of person -> net balance in integer cents
 */
function calculateNetBalances(debts) {
  const balances = new Map();

  for (const { from, to, amount } of debts) {
    balances.set(from, (balances.get(from) || 0) - amount);
    balances.set(to, (balances.get(to) || 0) + amount);
  }

  return balances;
}

/**
 * Separates participants into sorted debtors and creditors.
 * Strips out participants with net zero balance (they require no transactions).
 * Strictly verifies the zero-sum conservation of money invariant.
 * 
 * @param {Map<string, number>} netBalances
 * @throws {Error} if net balances do not sum to exactly 0 cents
 * @returns {{ debtors: Array<{ person: string, amount: number }>, creditors: Array<{ person: string, amount: number }> }}
 */
function partitionDebtorsAndCreditors(netBalances) {
  const debtors = [];
  const creditors = [];
  let netSum = 0;

  for (const [person, balance] of netBalances.entries()) {
    netSum += balance;
    if (balance < 0) {
      debtors.push({ person, amount: -balance });
    } else if (balance > 0) {
      creditors.push({ person, amount: balance });
    }
  }

  // Strict conservation of money assertion: net sum of credits and debits must be 0
  if (netSum !== 0) {
    throw new Error(`Conservation of money violated: sum of balances is ${netSum} cents, expected 0`);
  }

  debtors.sort(compareByAmountDescAndName);
  creditors.sort(compareByAmountDescAndName);

  return { debtors, creditors };
}

/**
 * Helper to split an expense among participants deterministically.
 * Avoids floating-point discrepancies by distributing leftover remainder cents
 * one-by-one to participants sorted alphabetically.
 * 
 * Example: $10.00 (1000 cents) split 3 ways -> 334, 333, 333 cents.
 * Sum is guaranteed to equal totalCents exactly (zero cents lost or fabricated).
 * 
 * @param {Object} params
 * @param {number} params.totalCents - Total expense in integer cents
 * @param {string} params.paidBy - Person who paid the bill
 * @param {Array<string>} params.splitBetween - Participants sharing the expense
 * @returns {Array<{ from: string, to: string, amount: number }>} individual debt entries
 */
function splitExpense({ totalCents, paidBy, splitBetween }) {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error(`Expense totalCents must be a positive integer, got ${totalCents}`);
  }
  if (!paidBy || typeof paidBy !== 'string') {
    throw new Error('Expense paidBy must be a valid string identifier');
  }
  if (!Array.isArray(splitBetween) || splitBetween.length === 0) {
    throw new Error('Expense splitBetween must be a non-empty array of participants');
  }

  const participants = Array.from(new Set(splitBetween.map(p => p.trim()))).sort();
  const count = participants.length;

  const baseShare = Math.floor(totalCents / count);
  const remainder = totalCents % count;

  const debts = [];

  for (let i = 0; i < count; i++) {
    const person = participants[i];
    // Deterministic leftover cent assignment: first `remainder` people get +1 cent
    const share = baseShare + (i < remainder ? 1 : 0);

    // If this participant is not the payer, they owe the payer their share
    if (person !== paidBy.trim() && share > 0) {
      debts.push({
        from: person,
        to: paidBy.trim(),
        amount: share,
      });
    }
  }

  return debts;
}

/**
 * Calculates deterministic integer cent splits based on percentages.
 * 
 * Enforces:
 * 1. Percentages must sum to exactly 100%.
 * 2. Exact conservation of money: sum of allocated cents === totalCents.
 * 3. Leftover remainder cents are allocated deterministically:
 *    highest fractional cent first, tie-breaking by defined sort order.
 * 
 * @param {number} totalCents - Strictly positive integer cents
 * @param {Array<{ user: string, percentage: number }|number>} percentages
 * @returns {Array<{ user: string, amount: number }>}
 */
function calculatePercentageSplit(totalCents, percentages) {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error(`Expense totalCents must be a positive integer, got ${totalCents}`);
  }
  if (!Array.isArray(percentages) || percentages.length === 0) {
    throw new Error('percentages must be a non-empty array');
  }

  const normalized = percentages.map((p, idx) => {
    const isObj = p !== null && typeof p === 'object';
    const user = isObj ? (p.user || p.userId || p.participant || p.id || `user_${idx}`) : `user_${idx}`;
    const pct = isObj ? p.percentage : p;
    if (typeof pct !== 'number' || isNaN(pct) || pct < 0) {
      throw new Error(`Invalid percentage for participant "${user}": ${pct}`);
    }
    return { user: String(user), percentage: pct, originalIndex: idx };
  });

  const sumPct = normalized.reduce((acc, curr) => acc + curr.percentage, 0);
  if (Math.abs(sumPct - 100) > PERCENTAGE_SUM_TOLERANCE) {
    throw new Error(`Percentages must sum to exactly 100%, but got ${sumPct}%`);
  }

  let allocated = 0;
  const items = normalized.map((item) => {
    const rawCents = (totalCents * item.percentage) / 100;
    const baseCents = Math.floor(rawCents);
    allocated += baseCents;
    return {
      user: item.user,
      percentage: item.percentage,
      amount: baseCents,
      frac: rawCents - baseCents,
      originalIndex: item.originalIndex,
    };
  });

  const remainder = totalCents - allocated;
  return distributeRemainderCents(items, remainder);
}

/**
 * Deterministically distributes leftover remainder cents among calculated split shares.
 * 
 * Remainder Allocation Invariant:
 * 1. Items with the highest fractional remainder receive +1 cent first (Hare-Niemeyer largest-remainder method).
 * 2. If two participants have identical fractional remainders, tie-break alphabetically
 *    by participant identifier, then by original array index to guarantee strict determinism.
 * 3. Restores original order before returning to preserve user ordering.
 * 
 * @param {Array<{ user: string, amount: number, frac: number, originalIndex: number }>} items
 * @param {number} remainder - Integer cents remaining to distribute (0 <= remainder < items.length)
 * @returns {Array<{ user: string, amount: number }>}
 */
function distributeRemainderCents(items, remainder) {
  if (remainder > 0) {
    const sorted = [...items].sort((a, b) => {
      if (Math.abs(b.frac - a.frac) > FRACTIONAL_CENT_EPSILON) {
        return b.frac - a.frac;
      }
      const cmp = a.user.localeCompare(b.user);
      return cmp !== 0 ? cmp : a.originalIndex - b.originalIndex;
    });

    for (let i = 0; i < remainder; i++) {
      sorted[i].amount += 1;
    }
  }

  items.sort((a, b) => a.originalIndex - b.originalIndex);
  return items.map(({ user, amount }) => ({ user, amount }));
}

/**
 * Calculates deterministic integer cent splits based on shares/ratios (e.g. 2:2:1).
 * 
 * Enforces:
 * 1. Total shares must be strictly positive (> 0).
 * 2. Exact conservation of money: sum of allocated cents === totalCents.
 * 3. Leftover remainder cents are allocated deterministically:
 *    highest fractional cent first, tie-breaking by defined sort order.
 * 
 * @param {number} totalCents - Strictly positive integer cents
 * @param {Array<{ user: string, shares: number }|number>} shares
 * @returns {Array<{ user: string, amount: number }>}
 */
function calculateSharesSplit(totalCents, shares) {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error(`Expense totalCents must be a positive integer, got ${totalCents}`);
  }
  if (!Array.isArray(shares) || shares.length === 0) {
    throw new Error('shares must be a non-empty array');
  }

  const normalized = shares.map((s, idx) => {
    const isObj = s !== null && typeof s === 'object';
    const user = isObj ? (s.user || s.userId || s.participant || s.id || `user_${idx}`) : `user_${idx}`;
    const shareVal = isObj ? (s.shares != null ? s.shares : s.share) : s;
    if (typeof shareVal !== 'number' || isNaN(shareVal) || shareVal < 0) {
      throw new Error(`Invalid share for participant "${user}": ${shareVal}`);
    }
    return { user: String(user), shares: shareVal, originalIndex: idx };
  });

  const totalShares = normalized.reduce((acc, curr) => acc + curr.shares, 0);
  if (totalShares <= 0) {
    throw new Error('Total shares must be greater than 0');
  }

  let allocated = 0;
  const items = normalized.map((item) => {
    const rawCents = (totalCents * item.shares) / totalShares;
    const baseCents = Math.floor(rawCents);
    allocated += baseCents;
    return {
      user: item.user,
      shares: item.shares,
      amount: baseCents,
      frac: rawCents - baseCents,
      originalIndex: item.originalIndex,
    };
  });

  const remainder = totalCents - allocated;
  return distributeRemainderCents(items, remainder);
}

/**
 * Searches for a valid third-party intermediary to route a transaction between
 * debtor and creditor when a direct payment is restricted by constraints.
 * 
 * Constraint Rule:
 * Candidate `I` is eligible if:
 * 1. `I` is distinct from both `debtor` and `creditor`.
 * 2. Neither `debtor -> I` nor `I -> creditor` is in `forbiddenEdges`.
 * 
 * @param {string} debtor
 * @param {string} creditor
 * @param {Iterable<string>} candidates - Pool of potential intermediaries
 * @param {Set<string>} forbiddenEdges - Set of forbidden "from->to" edges
 * @returns {string|null} selected intermediary (sorted alphabetically) or null if none available
 */
function findIntermediary(debtor, creditor, candidates, forbiddenEdges) {
  const eligible = [];

  for (const candidate of candidates) {
    if (candidate === debtor || candidate === creditor) continue;

    const debtorToIntermediaryEdge = `${debtor}->${candidate}`;
    const intermediaryToCreditorEdge = `${candidate}->${creditor}`;

    if (!forbiddenEdges.has(debtorToIntermediaryEdge) && !forbiddenEdges.has(intermediaryToCreditorEdge)) {
      eligible.push(candidate);
    }
  }

  if (eligible.length === 0) return null;

  // Deterministic tie-breaking: pick first alphabetically
  eligible.sort();
  return eligible[0];
}

/**
 * Strategy 1: Attempts a direct greedy settlement between the top debtor and top creditor.
 * 
 * @param {Array<{ person: string, amount: number }>} debtors
 * @param {Array<{ person: string, amount: number }>} creditors
 * @param {Set<string>} forbiddenEdges
 * @returns {{ from: string, to: string, amount: number }|null}
 */
function tryDirectGreedyMatch(debtors, creditors, forbiddenEdges) {
  const topDebtor = debtors[0];
  const topCreditor = creditors[0];
  const directEdgeKey = `${topDebtor.person}->${topCreditor.person}`;

  if (forbiddenEdges.has(directEdgeKey)) {
    return null;
  }

  const settledAmount = Math.min(topDebtor.amount, topCreditor.amount);
  topDebtor.amount -= settledAmount;
  topCreditor.amount -= settledAmount;

  if (topDebtor.amount === 0) debtors.shift();
  if (topCreditor.amount === 0) creditors.shift();

  return {
    from: topDebtor.person,
    to: topCreditor.person,
    amount: settledAmount,
  };
}

/**
 * Strategy 2: Searches for an alternative compatible direct pair when the top pair is forbidden.
 * Prioritizes exact balance matches (which simultaneously zero out two parties), then
 * the largest settleable amount.
 * 
 * @param {Array<{ person: string, amount: number }>} debtors
 * @param {Array<{ person: string, amount: number }>} creditors
 * @param {Set<string>} forbiddenEdges
 * @returns {{ from: string, to: string, amount: number }|null}
 */
function tryAlternativeCompatiblePair(debtors, creditors, forbiddenEdges) {
  let bestPair = null;

  for (let dIdx = 0; dIdx < debtors.length; dIdx++) {
    for (let cIdx = 0; cIdx < creditors.length; cIdx++) {
      const d = debtors[dIdx];
      const c = creditors[cIdx];
      const edgeKey = `${d.person}->${c.person}`;

      if (!forbiddenEdges.has(edgeKey)) {
        const settleable = Math.min(d.amount, c.amount);
        const isExact = d.amount === c.amount;

        if (!bestPair) {
          bestPair = { dIdx, cIdx, settleable, isExact };
        } else {
          // Prefer exact match over partial, then prefer higher amount settled
          if (isExact && !bestPair.isExact) {
            bestPair = { dIdx, cIdx, settleable, isExact };
          } else if (isExact === bestPair.isExact && settleable > bestPair.settleable) {
            bestPair = { dIdx, cIdx, settleable, isExact };
          }
        }
      }
    }
  }

  if (!bestPair) return null;

  const debtor = debtors[bestPair.dIdx];
  const creditor = creditors[bestPair.cIdx];
  const settledAmount = bestPair.settleable;

  debtor.amount -= settledAmount;
  creditor.amount -= settledAmount;

  if (debtor.amount === 0) debtors.splice(bestPair.dIdx, 1);
  if (creditor.amount === 0) creditors.splice(bestPair.cIdx, 1);

  return {
    from: debtor.person,
    to: creditor.person,
    amount: settledAmount,
  };
}

/**
 * Strategy 3: When no direct pairings are allowed, routes settlement through an intermediary.
 * 
 * Mathematical Invariant:
 * The intermediary `I` receives `amount` from `D` and pays `amount` to `C`.
 * Net change on `I`: ΔBalance(I) = +amount - amount = 0.
 * `I` acts as a pure pass-through conduit without financial distortion.
 * 
 * @param {Array<{ person: string, amount: number }>} debtors
 * @param {Array<{ person: string, amount: number }>} creditors
 * @param {Set<string>} intermediaryPool
 * @param {Set<string>} forbiddenEdges
 * @returns {Array<{ from: string, to: string, amount: number }>|null} 2-hop transactions [D->I, I->C]
 */
function tryIntermediaryRouting(debtors, creditors, intermediaryPool, forbiddenEdges) {
  for (let dIdx = 0; dIdx < debtors.length; dIdx++) {
    for (let cIdx = 0; cIdx < creditors.length; cIdx++) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];

      const intermediary = findIntermediary(
        debtor.person,
        creditor.person,
        intermediaryPool,
        forbiddenEdges
      );

      if (intermediary) {
        const settledAmount = Math.min(debtor.amount, creditor.amount);

        debtor.amount -= settledAmount;
        creditor.amount -= settledAmount;

        if (debtor.amount === 0) debtors.splice(dIdx, 1);
        if (creditor.amount === 0) creditors.splice(cIdx, 1);

        return [
          { from: debtor.person, to: intermediary, amount: settledAmount },
          { from: intermediary, to: creditor.person, amount: settledAmount },
        ];
      }
    }
  }

  return null;
}

/**
 * Core greedy matching engine for a single connected component.
 * 
 * ALGORITHMIC STRATEGY (4-TIER RESOLUTION HIERARCHY):
 * 1. Tier 1 (Greedy Max-Flow): Pair largest debtor with largest creditor. If allowed by constraints,
 *    settles min(debtor, creditor). At least one participant is zeroed out in O(1).
 * 2. Tier 2 (Exact & Compatible Pairing): If top pair is constrained, search for compatible pairs.
 *    Prioritizes EXACT matches (debtor.amount === creditor.amount) because settling exact pairs
 *    zeros out TWO participants simultaneously, strictly minimizing total transactions |T|.
 * 3. Tier 3 (2-Hop Intermediary Escrow): When no direct transfer is viable, selects an unconstrained
 *    third-party intermediary `I` from the pool. Emits two transactions: [Debtor -> I, I -> Creditor].
 *    CONSERVATION INVARIANT: Intermediary receives X and immediately pays X. Net financial delta
 *    ΔBalance(I) = (+X) + (-X) = 0 cents. The intermediary incurs zero balance change or debt risk.
 * 4. Tier 4 (Deadlock Exception): If all candidates are blocked by mutual constraints, throws a
 *    domain error with descriptive participant diagnostics so callers can alert the group.
 * 
 * @param {Map<string, number>} netBalances
 * @param {Array<{ avoid: [string, string] }>} constraints
 * @param {Set<string>} allParticipants
 * @returns {Array<{ from: string, to: string, amount: number }>}
 */
function greedyMatchComponent(netBalances, constraints = [], allParticipants = new Set()) {
  const { debtors, creditors } = partitionDebtorsAndCreditors(netBalances);
  const transactions = [];

  // Parse forbidden directional edges: "personA->personB"
  const forbiddenEdges = new Set();
  for (const c of constraints) {
    if (c && Array.isArray(c.avoid) && c.avoid.length === 2) {
      forbiddenEdges.add(`${c.avoid[0].trim()}->${c.avoid[1].trim()}`);
    }
  }

  // Intermediary candidates include all known participants in this component context
  const intermediaryPool = new Set(allParticipants);
  for (const [p] of netBalances.entries()) {
    intermediaryPool.add(p);
  }

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(compareByAmountDescAndName);
    creditors.sort(compareByAmountDescAndName);

    // Tier 1: Direct greedy match between top debtor and top creditor
    const directMatch = tryDirectGreedyMatch(debtors, creditors, forbiddenEdges);
    if (directMatch) {
      transactions.push(directMatch);
      continue;
    }

    // Tier 2: Search for alternative compatible pair
    const alternativeMatch = tryAlternativeCompatiblePair(debtors, creditors, forbiddenEdges);
    if (alternativeMatch) {
      transactions.push(alternativeMatch);
      continue;
    }

    // Tier 3: Route through neutral intermediary
    const routedHops = tryIntermediaryRouting(debtors, creditors, intermediaryPool, forbiddenEdges);
    if (routedHops) {
      transactions.push(...routedHops);
      continue;
    }

    // Deadlock: No direct edge or intermediary route can satisfy the constraints
    const remainingDebtors = debtors.map(d => d.person).join(', ');
    const remainingCreditors = creditors.map(c => c.person).join(', ');
    throw new Error(
      `Cannot satisfy constraints: no valid direct route or intermediary available to settle [${remainingDebtors}] -> [${remainingCreditors}]`
    );
  }

  return transactions;
}

/**
 * Consolidates multiple transactions between identical parties,
 * combines parallel transactions, and nets counter-transactions.
 * 
 * Example:
 * A -> B $20 and A -> B $30 becomes A -> B $50.
 * A -> B $50 and B -> A $10 becomes A -> B $40.
 * 
 * @param {Array<{ from: string, to: string, amount: number }>} transactions
 * @returns {Array<{ from: string, to: string, amount: number }>}
 */
function consolidateTransactions(transactions) {
  if (transactions.length <= 1) return transactions;

  // Calculate net flow between every unique pair of people
  const flows = new Map(); // key: "personA\0personB", val: net from personA to personB

  for (const { from, to, amount } of transactions) {
    if (from === to || amount <= 0) continue;

    const [p1, p2] = [from, to].sort();
    const pairKey = `${p1}\0${p2}`;
    const currentNet = flows.get(pairKey) || 0;

    // Positive if flowing p1 -> p2, negative if flowing p2 -> p1
    if (from === p1) {
      flows.set(pairKey, currentNet + amount);
    } else {
      flows.set(pairKey, currentNet - amount);
    }
  }

  const consolidated = [];

  for (const [pairKey, netAmount] of flows.entries()) {
    if (netAmount === 0) continue;

    const [p1, p2] = pairKey.split('\0');
    if (netAmount > 0) {
      consolidated.push({ from: p1, to: p2, amount: netAmount });
    } else {
      consolidated.push({ from: p2, to: p1, amount: -netAmount });
    }
  }

  // Sort deterministically: by `from`, then `to`
  consolidated.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return consolidated;
}

/**
 * Main simplification orchestrator.
 * 
 * 1. Validates input debts (amounts in integer cents).
 * 2. Partitions graph into disconnected subgroups (components settle independently).
 * 3. Calculates net balances and filters zero-sum participants.
 * 4. Applies greedy matching with constraint routing per component.
 * 5. Consolidates and returns the minimal settlement plan.
 * 
 * @param {Array<{ from: string, to: string, amount: number }>} debts
 * @param {Object} [options]
 * @param {Array<{ avoid: [string, string] }>} [options.constraints] - Forbidden direct payments
 * @param {Array<string>} [options.participants] - Optional list of additional known participants (for intermediary routing)
 * @returns {Array<{ from: string, to: string, amount: number }>} minimal settlement transactions
 */
function simplifyDebts(debts, options = {}) {
  const sanitized = validateDebts(debts);
  if (sanitized.length === 0) return [];

  const { constraints = [], participants = [] } = options;

  // Partition into disconnected subgroups
  const components = findConnectedComponents(sanitized);
  const globalParticipants = new Set(participants.map(p => p.trim()));

  const allTransactions = [];

  for (const component of components) {
    const netBalances = calculateNetBalances(component.debts);

    // Context participants for this component: participants in this component + any global participants
    const componentContext = new Set([...component.participants, ...globalParticipants]);

    const componentTransactions = greedyMatchComponent(
      netBalances,
      constraints,
      componentContext
    );

    allTransactions.push(...componentTransactions);
  }

  return consolidateTransactions(allTransactions);
}

module.exports = {
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
};
