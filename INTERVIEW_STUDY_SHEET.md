# SettleUp: Technical Interview Preparation & Deep-Dive Study Sheet

This document contains a comprehensive set of technical interview questions and rigorous model answers for the **SettleUp** project. It is structured into 6 categories designed to test algorithmic rigor, systems architecture, practical trade-offs, and intellectual honesty.

---

## 1. Algorithm Deep-Dive

### Q1: What is the exact computational complexity of the debt simplification algorithm across all phases?
**Model Answer:**
"The algorithm runs in four distinct phases:

1. **Cycle Collapse & Scalar Netting:** We iterate through all $E$ raw transaction edges and accumulate each person's scalar net balance:
   $$\text{Net}_i = \sum \text{Credits}_i - \sum \text{Debits}_i$$
   This phase is strictly $\mathcal{O}(E)$ time and $\mathcal{O}(N)$ auxiliary space, where $E$ is the number of edges and $N$ is the number of distinct participants. All cycles are collapsed right here in linear time.
2. **Connected Component Partitioning (BFS):** We construct an undirected adjacency list from the raw edges and run a Breadth-First Search to isolate disjoint subgraphs. Graph construction takes $\mathcal{O}(E)$ and BFS traversal takes $\mathcal{O}(N + E)$.
3. **Partitioning & Sorting Debtors/Creditors:** For each connected component of size $k \le N$, we separate participants into debtors ($\text{Net} < 0$) and creditors ($\text{Net} > 0$). In the worst case, we sort both arrays by amount descending: $\mathcal{O}(k \log k)$.
4. **Greedy Matching Loop:** In each iteration of the matching loop, we take the top debtor and top creditor, settle $\min(|D|, C)$, and re-sort or remove zeroed-out participants. In the unconstrained case, at least one participant is zeroed out in every step, yielding at most $k - 1$ iterations. Because we sort on each step, the unconstrained worst-case runtime for this phase is $\mathcal{O}(k^2 \log k)$, or $\mathcal{O}(k \log k)$ if using binary heap priority queues.
5. **Constraint Routing (Tiers 2 & 3):** When avoidance constraints exist, finding an alternative compatible pair is $\mathcal{O}(|D| \cdot |C|)$, and searching the intermediary pool for an eligible candidate $I$ takes $\mathcal{O}(|D| \cdot |C| \cdot |Pool|)$.

**Overall Complexity:**
* **Time:** $\mathcal{O}(E + N \log N)$ average case without constraints; $\mathcal{O}(E + N^3)$ worst-case under dense avoidance constraints.
* **Space:** $\mathcal{O}(N + E)$ to hold the graph, net balances map, and priority lists."

---

### Q2: Why did you choose a greedy matching approach instead of Min-Cost Max-Flow (MCMF) or Integer Linear Programming (ILP)?
**Model Answer:**
"The choice came down to the mathematical nature of the objective and operational latency:

* **MCMF is designed to minimize edge costs along a fixed capacity network**, not to minimize the *number of non-zero flow edges* (cardinality of $E'$). If every potential transfer between participants has equal cost, MCMF simply finds any feasible circulation, which can easily produce up to $N - 1$ or more transactions without minimizing transfer count.
* **ILP (Integer Linear Programming)** can formulate exact cardinality minimization by introducing binary indicator variables $z_{ij} \in \{0, 1\}$ for whether person $i$ pays person $j$. However, this is an NP-hard mixed-integer program. Solving an ILP via branch-and-cut inside a synchronous serverless HTTP request introduces unbounded latency, requires native C++ solvers (like COIN-OR or Gurobi) that bloat serverless cold starts, and risks 504 gateway timeouts on larger groups.
* **Why Greedy Won:** Greedy requires zero external dependencies, executes in under **2 milliseconds** in pure JavaScript for groups up to 100 participants, and provides a provable worst-case upper bound of at most $N - 1$ transactions for any connected component of $N$ participants. In real-world group expense sharing, settling an 8-person trip in 5 transactions instead of the theoretical minimum of 4 is completely acceptable, whereas an API hanging for 800ms while an ILP branch-and-cut solver runs is not."

---

### Q3: Is SettleUp's debt simplification algorithm provably optimal in minimizing transaction count, or is it just a heuristic?
**Model Answer:**
"To be completely intellectually honest: **it is a heuristic, and it is NOT provably optimal.**

The problem of finding the absolute minimum number of settlement transactions to clear a zero-sum balance vector is mathematically equivalent to the **Minimum Number of Subsets with Zero Sum** problem, which is known to be **NP-hard** (closely related to the NP-complete Subset Sum and Partition problems).

If a group can be partitioned into $k$ disjoint subsets where the sum of net balances within each subset is zero ($\sum_{i \in S_j} \text{Net}_i = 0$), the theoretical minimum number of transactions is:
$$|T|_{\min} = N - k$$
where $k$ is the maximum number of zero-sum partitions.

* **Where Pure Greedy Fails:**
  Consider 4 people:
  * Alice: owes $50 ($-50$)
  * Bob: is owed $50 ($+50$)
  * Charlie: owes $20 ($-20$)
  * Dave: is owed $20 ($+20$)

  Here, $k = 2$ independent zero-sum subsets exist ($\{A, B\}$ and $\{C, D\}$). The optimal solution is **2 transactions** ($4 - 2 = 2$):
  1. Alice $\rightarrow$ Bob: $50
  2. Charlie $\rightarrow$ Dave: $20

  Now suppose Alice owes $50, Charlie owes $40, Bob is owed $60, and Dave is owed $30. The net balances are $\{-50, -40\}$ and $\{+60, +30\}$. Notice $\{-50, -40, +60, +30\}$ has a single zero-sum partition $\{ -50, -40, +60, +30 \}$, so $N - 1 = 3$ transactions are needed.
  However, in cases where independent subsets *do* exist, a pure largest-first greedy heuristic can pair the largest debtor with the largest creditor across subset boundaries, merging the two independent subsets and producing $N - 1$ transactions instead of $N - k$.

* **Our Heuristic Mitigation:**
  SettleUp implements **Tier 2 exact-balance matching**: before executing a partial greedy match, it scans for exact balance equality ($\text{debtor.amount} === \text{creditor.amount}$). If found, it executes that match immediately, zeroing out two parties in one transaction and preserving subset independence. While this catches all 2-element zero-sum subsets ($\{-X, +X\}$), it does not find 3-element or 4-element subsets (e.g., $\{-30, -20, +50\}$). Achieving true optimality for arbitrary subset sizes requires an $\mathcal{O}(3^N)$ dynamic programming algorithm."

---

### Q4: How does SettleUp prevent independent zero-sum subgroups from being unnecessarily cross-settled?
**Model Answer:**
"We use a two-pronged defense:

1. **Pre-partitioning via BFS Connected Components:**
   Before running any netting, `findConnectedComponents()` builds an undirected graph of who actually shared expenses with whom. If Group A (Alice, Bob) and Group B (Charlie, David) had completely independent activities within the same group entity, BFS separates them into distinct graphs. They are settled in separate executions, guaranteeing that money never crosses between disconnected groups.
2. **Tier 2 Exact-Balance Matching:**
   Within a connected component, participants may have formed independent economic subsets. Before we greedily pair the largest debtor with the largest creditor, `tryAlternativeCompatiblePair()` checks if any debtor has an obligation that *exactly* equals a creditor's balance ($|D_i| = C_j$). If so, it prioritizes that match over a larger partial match. This zeros out both participants simultaneously, decreasing the remaining problem size by 2 participants in a single transaction and preventing cross-subset pollution."

---

### Q5: How does the algorithm detect and collapse cycles in the debt graph?
**Model Answer:**
"We don't need cycle-detection algorithms like Tarjan's or Johnson's elementary cycle finding because we don't manipulate the graph edges directly.

Instead, we recognize that money is conserved. In any closed group:
$$\sum_{i=1}^N \text{Net}_i = 0$$
When Alice pays $30 for Bob, Bob pays $30 for Charlie, and Charlie pays $30 for Alice:
* $\text{Net}_{\text{Alice}} = +30 - 30 = 0$
* $\text{Net}_{\text{Bob}} = +30 - 30 = 0$
* $\text{Net}_{\text{Charlie}} = +30 - 30 = 0$

When we project the $E$ directed edges into a 1D scalar balance map in `calculateNetBalances()`, any cyclic flow naturally cancels out to zero. We then filter out anyone whose net balance is 0 (`Math.abs(balance) < 1` cent). Cycles are eradicated in $\mathcal{O}(E)$ time without ever explicitly enumerating them."

---

### Q6: When expenses are split unevenly or using percentages/shares, how are rounding and remainder pennies handled?
**Model Answer:**
"We implement the **Hare-Niemeyer method** (the largest-remainder method), which guarantees strict penny conservation down to zero cents lost or fabricated:

1. **Floor Allocation:** For each participant, we calculate their raw share:
   $$\text{rawCents}_i = \frac{\text{totalCents} \times \text{share}_i}{\text{totalShares}}$$
   We assign $\text{baseCents}_i = \lfloor \text{rawCents}_i \rfloor$ and capture the fractional remainder: $\text{frac}_i = \text{rawCents}_i - \text{baseCents}_i$.
2. **Calculate Residual Cents:**
   $$\text{remainder} = \text{totalCents} - \sum_{i=1}^P \text{baseCents}_i$$
   Because we used the floor function, $0 \le \text{remainder} < P$ (where $P$ is the number of participants).
3. **Deterministic Distribution:**
   In `distributeRemainderCents()`, we sort participants by:
   - Primary: $\text{frac}_i$ descending (highest fractional penny gets +1 cent first).
   - Secondary (tie-breaker): Alphabetical order of participant ID via `localeCompare`.
   - Tertiary (tie-breaker): Original array index.
   We iterate from $0$ to $\text{remainder} - 1$ and add 1 cent to each.
4. **Invariant:**
   $$\sum_{i=1}^P \text{finalCents}_i \equiv \text{totalCents}$$
   This is asserted at runtime. Floating-point division never touches the ledger."

---

### Q7: How are disconnected subgroups handled, and why would settling them together be socially or financially unacceptable?
**Model Answer:**
"In `src/simplifier.js`, `findConnectedComponents()` performs BFS across the undirected adjacency list of all recorded expenses.

**Why settling them together would be unacceptable:**
Imagine a group of 4 flatmates where Alice and Bob split groceries ($40), while Charlie and David split utility bills ($60). Alice owes Bob $20, and Charlie owes David $30.
* Alice has net $-20$, Bob $+20$.
* Charlie has net $-30$, David $+30$.

If you ran a global greedy match without component separation:
1. Max debtor is Charlie ($-30$), max creditor is David ($+30$). Charlie pays David $30.
2. Next is Alice ($-20$) and Bob ($+20$). Alice pays Bob $20.
In this case, it worked out cleanly. But if Alice owed $30 and Charlie owed $20, while Bob was owed $20 and David $30, a global greedy matcher could easily produce:
* Alice pays David $30!
Alice and David never interacted, shared no bills, and may not even know each other's bank details. Forcing Alice to pay David to clear an internal debt Charlie had with David violates user trust and social contracts. By partitioning into connected components first, SettleUp guarantees debts are only resolved within the social cluster that incurred them."

---

### Q8: How does the algorithm handle payment avoidance constraints, and what happens when constraints create an unsolvable deadlock?
**Model Answer:**
"We handle payment avoidance constraints (e.g., Alice cannot pay Bob due to interpersonal conflict or lack of payment channels) using a **4-tier resolution hierarchy** in `greedyMatchComponent()`:

1. **Tier 1 (Direct Greedy):** Attempt direct settlement between the top debtor and top creditor. If `debtor->creditor` is in `forbiddenEdges`, fall back.
2. **Tier 2 (Alternative Compatible Match):** Iterate through all remaining pairs to find a direct unconstrained pair, prioritizing exact balance matches to maximize participant elimination.
3. **Tier 3 (Neutral Intermediary Routing):** When direct transfers are completely blocked, search the group pool for a neutral participant $I$ where neither `debtor->I` nor `I->creditor` is forbidden. SettleUp emits two transactions:
   $$\text{Debtor} \xrightarrow{X} I \quad \text{and} \quad I \xrightarrow{X} \text{Creditor}$$
   **Financial Conservation Invariant:** Intermediary $I$ receives $X$ cents and pays $X$ cents. Their net financial delta is:
   $$\Delta \text{Balance}(I) = (+X) + (-X) = 0$$
   $I$ acts as an instantaneous zero-sum conduit.
4. **Tier 4 (Deadlock Detection):** If every debtor-creditor pair is constrained and no intermediary exists (e.g., a two-person group where Alice cannot pay Bob, or all potential intermediaries also have mutual avoidance constraints), the algorithm halts and throws a `CONSTRAINT_DEADLOCK` error with an explicit list of unresolved participants. The API catches this and returns HTTP 422 with a descriptive diagnostic payload."

---

### Q9: What happens to self-debts (e.g., Alice paying for an expense where Alice consumes a share)?
**Model Answer:**
"Self-debts are eliminated at two distinct boundaries:

1. **Database / Ledger Generation Boundary:**
   In `settlementService.js`, when generating reciprocal double-entry ledger entries from an expense:
   ```javascript
   if (participant.user.equals(payer.user)) {
     continue; // Alice owes Alice $0 of inter-member debt
   }
   ```
   No `DEBIT` or `CREDIT` rows are inserted for a participant's consumption of their own money.
2. **Algorithmic Sanitization Boundary:**
   If a client or test passes a raw debt array containing `{ from: 'Alice', to: 'Alice', amount: 500 }`, `sanitizeDebts()` explicitly strips out any entry where `from === to`. Furthermore, in `calculateNetBalances()`, a self-debt would contribute $+X$ and $-X$ to Alice's balance, yielding a net change of 0."

---

### Q10: How does SettleUp consolidate multiple debts between the same two users or counter-directional debts?
**Model Answer:**
"In `src/simplifier.js`, `consolidateTransactions()` post-processes emitted transactions:
* It maps unique pairs using a canonical string key where names are sorted alphabetically: `pairKey = [p1, p2].sort().join('\0')`.
* It accumulates net flow: if flow is from `p1` to `p2`, it adds the amount; if from `p2` to `p1`, it subtracts the amount.
* If Alice owes Bob $50 and Bob owes Alice $20, the net flow is $+30$ (Alice $\rightarrow$ Bob).
* Parallel transactions (e.g., Alice owes Bob $20 and Alice owes Bob $30) are summed into a single $50 transaction. Counter-transactions cancel each other out."

---

## 2. Design Decision Justification

### Q1: Why did you choose MongoDB with an append-only ledger and multi-document transactions instead of a relational database like PostgreSQL?
**Model Answer:**
"**The Honest Justification:**
I chose MongoDB primarily because of the hierarchical, document-oriented nature of expense sharing. An expense is inherently a nested aggregate: it has an array of co-funding payers (`paidBy: [{ user, amountCents }]`), variable split participants with custom percentages or shares, and group-level metadata. In MongoDB, reading and writing an entire expense with its splits is an atomic single-document operation that requires zero `JOIN` tables. Furthermore, for our aggregations, covered compound indexes on `{ user: 1, currency: 1, group: 1, signedAmount: 1 }` allow MongoDB's WiredTiger engine to compute running balances entirely within RAM without touching document bodies on disk.

**The Candid Trade-Off & Downsides:**
If I were designing this for a tier-1 bank or enterprise ledger, **PostgreSQL would have been the stronger choice.** Here is why:
1. **Application-Level vs. Engine-Level Constraints:** PostgreSQL enforces referential integrity through declarative foreign keys (`ON DELETE RESTRICT`) and table check constraints (`CHECK (amount > 0)`). In MongoDB, immutability and referential integrity are enforced at the application level via Mongoose middleware hooks (`pre('save')`, `pre('updateOne')`). If an engineer connects to MongoDB via the Mongo CLI or a Python script without Mongoose, they can bypass those hooks and mutate the ledger.
2. **Transaction Overhead:** While MongoDB supports multi-document ACID transactions via `session.withTransaction()`, WiredTiger transactions carry higher memory lock overhead than PostgreSQL's MVCC and have a default 60-second transaction lifetime limit.
3. **Data Redundancy:** Embedding user IDs across split subdocuments trades normalization for read locality."

---

### Q2: Why did you represent currency strictly as integer cents instead of floating-point numbers or arbitrary-precision decimals (`BigDecimal` / `numeric`)?
**Model Answer:**
"**The Justification:**
IEEE 754 floating-point numbers represent numbers in binary scientific notation ($(-1)^s \times m \times 2^e$). Fractions that are simple in base 10 (like $0.1$ or $0.01$) are infinite repeating fractions in base 2. In JavaScript:
```javascript
0.1 + 0.2 === 0.30000000000000004 // true
```
If you store balances as floats, repeated splits and netting operations compound fractional rounding errors. Over time, $\sum \text{Credits} \neq \sum \text{Debits}$, breaking the foundational accounting invariant that closed group debt must sum to zero.
By representing currency as integer cents (e.g., $10.50 is stored as `1050`), all operations are exact integer additions, subtractions, and integer modulo operations. Integers in JavaScript are exact up to $2^{53} - 1$ ($90 trillion), completely eliminating representation drift without any external libraries.

**The Candid Trade-Off & Downsides:**
1. **Zero-Decimal and 3-Decimal Currencies:** Not all world currencies have 100 cents. Japanese Yen (JPY) and Korean Won (KRW) are zero-decimal currencies (1 Yen has no subdivision), while Kuwaiti Dinar (KWD) and Bahraini Dinar (BHD) have 1,000 fils (3 decimals). Our integer cents approach assumes a 2-decimal scaling factor. To properly support KWD or JPY in a cross-currency ledger, we would need a per-currency scaling exponent column (`scale: 0`, `scale: 2`, `scale: 3`), which our current schema does not have.
2. **Why not `BigDecimal`:** JavaScript has no native `BigDecimal` type yet (Decimal proposal is Stage 2). Using an external library like `decimal.js` adds bundle weight and serialization overhead when converting to/from MongoDB BSON."

---

### Q3: Why did you design the ledger as strictly append-only (WORM) instead of updating running balances in-place on a User or Group document?
**Model Answer:**
"**The Justification:**
In-place balance updates are the root cause of financial reconciliation nightmares. If you maintain a single `balance: 1420` field on a user document and update it with `$inc`:
1. You lose all provenance: you cannot explain *why* the balance is 1420 or who changed it.
2. If an update fails halfway or an expense is deleted, you cannot audit where the discrepancy occurred.
3. Concurrent writes to the same user record cause write contention and race conditions.

In our append-only WORM (Write Once, Read Many) design, every balance is a deterministic fold over immutable history. To correct a mistake, a user creates an offsetting `REVERSAL` or `ADJUSTMENT` record. We can replay history at any point in time to reconstruct exact state.

**The Candid Trade-Off & Downsides:**
1. **Query Cost at Scale:** To get a user's current balance, you must run an aggregation over all past ledger entries. While covered indexes make this fast for thousands of rows, for a group with 1,000,000 entries, recalculating from genesis on every read becomes expensive.
2. **Storage Growth:** Append-only tables grow monotonically. You cannot simply reclaim disk space without implementing periodic snapshotting/checkpointing (e.g., rolling monthly balance checkpoints)."

---

### Q4: Why did you implement constraint avoidance via neutral intermediary routing instead of rerunning a constrained graph flow algorithm like Suurballe's or Edmonds-Karp with edge capacities?
**Model Answer:**
"**The Justification:**
In our architecture, constraint avoidance is evaluated **after** the directed graph has already been reduced to scalar net positions.
Once you have scalar net positions, you no longer have an edge capacity graph; you have a bipartite-like set of debtors and creditors. Running Edmonds-Karp or Suurballe's algorithm requires a flow network with predefined edge capacities. But in debt simplification, capacities between debtors and creditors are not predetermined—we are *synthesizing* the edges to minimize count.
Intermediary routing mirrors real-world human behavior: if Alice refuses to Venmo Bob, Alice Venmos mutual friend Charlie, and Charlie Venmos Bob. It solves the social avoidance constraint with a clean mathematical property: $\Delta \text{Balance}(\text{Charlie}) = 0$.

**The Candid Trade-Off & Downsides:**
1. **Doubles Transaction Count:** An intermediary route requires two transactions ($D \rightarrow I$ and $I \rightarrow C$) instead of one ($D \rightarrow C$), directly conflicting with our goal of minimizing total transactions.
2. **Social and Legal Friction:** While mathematically sound ($\Delta \text{Balance} = 0$), in real life Charlie might not want $500 passing through his personal bank account due to tax reporting thresholds (e.g., IRS 1099-K rules in the US). A pure graph flow approach might have found a longer, multi-edge direct path through existing debts without creating artificial intermediary transactions."

---

### Q5: Why is the algorithm implemented as a pure functional module with zero database or framework dependencies?
**Model Answer:**
"**The Justification:**
`src/simplifier.js` takes raw arrays of `{ from, to, amount }` and returns `{ from, to, amount }`. It does not import Mongoose, Next.js, or any HTTP libraries.
* **Testability:** We can write dozens of fast unit tests covering edge cases, rounding remainders, and permutation fuzzing without mocking database connections or spinning up MongoDB.
* **Portability:** The exact same file can run on the client inside a React component (for instant interactive UI preview before submitting an expense) and on the server inside an API route handler.
* **Isolation:** Bug fixes in algorithm logic cannot introduce database regressions or SQL/NoSQL injection vulnerabilities.

**The Candid Trade-Off:**
Because the algorithm is isolated from the data layer, the service layer must bridge the gap: fetching ledger entries, formatting them into `{ from, to, amount }`, calling the algorithm, and translating the output back into database operations. This requires data mapping boilerplate."

---

### Q6: Why NextAuth with JWT session strategy instead of database-persisted sessions for an application dealing with financial ledgers?
**Model Answer:**
"**The Justification:**
We chose NextAuth's `strategy: 'jwt'` to optimize for serverless execution on Vercel. With JWTs, every incoming API request can verify authentication cryptographically in edge middleware or serverless handlers by verifying the HMAC/RSA signature against `NEXTAUTH_SECRET`, requiring zero database lookups on authenticated reads.

**The Candid Trade-Off & Downsides:**
1. **Inability to Immediately Invalidate Sessions:** If a user's account is compromised or they are removed from a group, their JWT remains valid until its expiration window elapses unless we maintain a distributed token revocation blacklist (which defeats the stateless advantage of JWTs).
2. **Token Staleness:** If a user updates their default currency or profile, the session JWT does not reflect the update until a new token is minted or refreshed."

---

## 3. Edge Case and Scaling Questions

### Q1: How would this system behave if a group had 1,000+ members and 50,000 transactions? Where would it break first?
**Model Answer:**
"Here is an honest breakdown of where the system would bottleneck and fail:

1. **First Failure Point: Memory & Aggregation Limits in `getGroupSettlementPlan`**
   In `settlementService.js`, `getGroupPairwiseDebts` executes `LedgerEntry.find({ group: groupId, direction: 'DEBIT' })`. Fetching 50,000 Mongoose documents into Node.js heap memory creates significant memory pressure (easily 150MB+ of hydrated Mongoose documents). If multiple users request this concurrently, Vercel's serverless 1024MB RAM limit will trigger an `Out of Memory (OOM)` crash.
   * *Required Fix:* Push the pairwise netting into a MongoDB native aggregation pipeline using `$group` and `$facet`, streaming or returning only the net pairs rather than raw documents.
2. **Second Failure Point: Algorithmic Complexity on Dense Constraints**
   With $N = 1000$ members, if many mutual avoidance constraints are registered, our Tier 2 and Tier 3 checks run nested loops: $\mathcal{O}(|Debtors| \times |Creditors| \times |Pool|)$. With 500 debtors, 500 creditors, and 1,000 pool members, that's up to $250,000,000$ iterations in JavaScript, which will trigger a Vercel 15-second execution timeout.
3. **Third Failure Point: MongoDB Multi-Document Transaction Timeouts**
   MongoDB transactions have a hard 60-second execution lifetime limit and can abort if lock acquisition on multiple documents experiences high contention."

---

### Q2: How does the system handle unsupported or exotic currencies? What is actually implemented vs. what is a gap?
**Model Answer:**
"**What is Implemented:**
In `src/services/currencyService.js`:
* Supported currencies are standardized against USD via live fetch to Open Exchange Rates (`open.er-api.com`).
* 24-hour TTL caching in the `exchange_rates` collection.
* Resilient 3-tier fallback: Live API $\rightarrow$ Cached MongoDB rates $\rightarrow$ Hardcoded static rate table (`FALLBACK_RATES_FROM_USD`).
* Stale flags: If falling back to stale rates, entries are flagged with `isFxStale: true` for transparency.

**What is a Known Gap:**
1. **Zero-Decimal Currencies (JPY, KRW):** SettleUp stores everything as integer cents assuming a subdivision of 100. If someone enters 1,000 JPY, our system currently treats it as 1,000 'cents' (which would be 10 JPY if formatted as standard currency). There is no dynamic currency exponent metadata.
2. **Cross-Rate Triangulation Inaccuracies:** When converting between two non-USD currencies (e.g., EUR to INR), we calculate through USD ($R_{\text{EUR}\to\text{INR}} = R_{\text{USD}\to\text{INR}} / R_{\text{USD}\to\text{EUR}}$). In real-world FX markets, direct bid-ask spreads differ from synthetic USD triangulation, causing minor basis-point discrepancies.
3. **Dynamic FX Fluctuations on Unsettled Balances:** We convert expenses to the group's base currency at the moment the expense is created. If exchange rates fluctuate drastically before settlement occurs weeks later, the currency risk is borne entirely by the debtor, not shared among members."

---

### Q3: What happens if two group members record expenses or attempt to settle concurrently? How are race conditions handled?
**Model Answer:**
"**What is Implemented:**
In `settlementService.js`, writes use MongoDB multi-document ACID transactions via `session.withTransaction()`.
* **Append-Only Write Concurrency:** When two users simultaneously create different expenses, both transactions append new documents to `expenses` and `ledger_entries`. Because they are pure inserts to an append-only collection, there are no row-level write-write update conflicts. Both succeed cleanly.

**The Known Gap (Settlement vs. Expense Race Condition):**
If User A requests a settlement plan and executes it, while User B simultaneously submits a new $100 expense:
1. SettleUp reads existing ledger entries to compute the settlement plan at $T_1$.
2. User B commits a new expense at $T_2$.
3. User A commits the settlement entries at $T_3$ based on the old state from $T_1$.
Because SettleUp uses standard `Read Committed` isolation (MongoDB's default), the settlement transaction does NOT throw a write conflict, because it did not update the rows that User B inserted—it inserted settlement entries calculated from an outdated ledger view. As a result, the settlement will leave the group with an unexpected residual balance of $100.
* *How to solve this in production:* Use optimistic concurrency control (OCC). Store a monotonically increasing `ledgerVersion` or `sequenceNumber` on the `Group` document. The settlement transaction must execute a conditional update `Group.updateOne({ _id: groupId, version: expectedVersion }, { $inc: { version: 1 } })`. If another write occurred, the version check fails and the transaction aborts and retries."

---

### Q4: What happens if a network failure occurs halfway through an expense creation or settlement?
**Model Answer:**
"This is fully handled by MongoDB's two-phase commit protocol inside WiredTiger transactions:

In `settlementService.js`:
```javascript
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    // 1. Create Expense document
    // 2. Insert reciprocal LedgerEntry documents
  });
} finally {
  await session.endSession();
}
```
If a network disconnect, process termination, or unhandled exception occurs before `session.commitTransaction()` finishes:
1. WiredTiger discards the transaction's private write buffer.
2. None of the `LedgerEntry` rows or `Expense` records become visible to other connections.
3. Atomicity is guaranteed: you will never see an expense without its corresponding ledger entries or a partial set of reciprocal debits and credits."

---

### Q5: How does the system defend against malformed inputs (negative amounts, split sums that don't match the total, non-integer cents)?
**Model Answer:**
"We implement defensive validation across three separate application layers:

1. **HTTP Route Layer (`validation.js` / Route Handlers):**
   Incoming payloads are validated before reaching domain services:
   - Amounts must be strictly positive integers (`Number.isInteger(amount) && amount > 0`). Floats like `10.5` are rejected with HTTP 400.
   - Payer sum validation: In multi-payer expenses, $\sum \text{payer.amountCents} === \text{totalAmount}$. If there is a 1-cent discrepancy, the route rejects the request immediately.
   - Percentage split validation: $\sum \text{percentages} === 100$ within a floating-point tolerance of $0.001$.
2. **Algorithmic Module Layer (`src/simplifier.js`):**
   `calculateSharesSplit()` and `calculatePercentageSplit()` assert non-empty arrays, positive shares, and integer inputs. If violated, they throw typed domain errors.
3. **Mongoose Schema Layer:**
   `LedgerEntry` defines `min: 1` and `validate: Number.isInteger` on the `amount` field. Even if an internal service bug bypassed the route validators, the database schema rejects the write."

---

### Q6: How does the invite link mechanism defend against brute-force token harvesting and unauthorized group joins?
**Model Answer:**
"1. **Cryptographic Entropy:** Group invite tokens are generated using Node.js `crypto.randomBytes(32).toString('hex')`, providing 256 bits of cryptographic entropy. This renders online brute-force guessing computationally infeasible ($2^{256}$ possibilities).
2. **Sliding-Window Expiration:** Invite codes have a 7-day expiration (`inviteExpiresAt`). Visiting the join route checks `group.inviteExpiresAt < new Date()` and rejects expired tokens.
3. **On-Demand Revocation:** Group owners can trigger `/api/groups/[id]/invite` with `regenerate: true`, which atomically overwrites `inviteCode` with a fresh token, immediately invalidating previously shared links.
4. **Sliding-Window Rate Limiting:** In `rateLimiter.js`, the `/join/[inviteCode]` endpoint is wrapped in an in-memory sliding-window limiter (10 attempts per 15 minutes per IP address).
* *Known Gap:* The in-memory rate limiter operates per serverless lambda instance. Under multi-instance or multi-region deployment, an attacker could distribute guessing attempts across instances. A production system requires Redis (Upstash) to maintain global state."

---

## 4. Code Walkthrough

### Function 1: `greedyMatchComponent` (`src/simplifier.js`)

```javascript
function greedyMatchComponent(netBalances, constraints = [], allParticipants = new Set()) {
  const { debtors, creditors } = partitionDebtorsAndCreditors(netBalances);
  const transactions = [];

  const forbiddenEdges = new Set();
  for (const c of constraints) {
    if (c && Array.isArray(c.avoid) && c.avoid.length === 2) {
      forbiddenEdges.add(`${c.avoid[0].trim()}->${c.avoid[1].trim()}`);
    }
  }

  const intermediaryPool = new Set(allParticipants);
  for (const [p] of netBalances.entries()) {
    intermediaryPool.add(p);
  }

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(compareByAmountDescAndName);
    creditors.sort(compareByAmountDescAndName);

    const directMatch = tryDirectGreedyMatch(debtors, creditors, forbiddenEdges);
    if (directMatch) {
      transactions.push(directMatch);
      continue;
    }

    const alternativeMatch = tryAlternativeCompatiblePair(debtors, creditors, forbiddenEdges);
    if (alternativeMatch) {
      transactions.push(alternativeMatch);
      continue;
    }

    const routedHops = tryIntermediaryRouting(debtors, creditors, intermediaryPool, forbiddenEdges);
    if (routedHops) {
      transactions.push(...routedHops);
      continue;
    }

    const remainingDebtors = debtors.map(d => d.person).join(', ');
    const remainingCreditors = creditors.map(c => c.person).join(', ');
    throw new Error(
      `Cannot satisfy constraints: no valid direct route or intermediary available to settle [${remainingDebtors}] -> [${remainingCreditors}]`
    );
  }

  return transactions;
}
```

**Interview Spoken Walkthrough:**
> "Let's walk through `greedyMatchComponent`. This is the core resolution engine that solves debt for a single connected component.
>
> First, on lines 625–640, we initialize our working state. We take the `netBalances` map and partition everyone into two lists: `debtors` (people who owe money, with their positive absolute debt amount) and `creditors` (people owed money). We build a `forbiddenEdges` Set formatted as strings `'personA->personB'` for $\mathcal{O}(1)$ constraint lookups. We also seed an `intermediaryPool` with every known participant in the component—these are our candidate neutral conduits if direct payments are blocked.
>
> Then we enter the `while` loop on line 642, which runs as long as there is at least one active debtor and creditor. Notice that at the top of every loop iteration, we re-sort both `debtors` and `creditors` in descending order by amount, with alphabetical name tie-breaking for strict determinism.
>
> Now comes our **4-tier resolution hierarchy**:
>
> First, on line 647, we attempt **Tier 1**: `tryDirectGreedyMatch`. This takes the largest debtor and the largest creditor. If there is no avoidance constraint between them, it immediately settles $\min(|D|, C)$, updates their remaining balances in-place, splices out whoever hit 0, and pushes the transaction. This is our optimal $\mathcal{O}(1)$ step that guarantees termination.
>
> If the top pair *is* constrained, we drop to **Tier 2** on line 654: `tryAlternativeCompatiblePair`. This scans all unconstrained debtor-creditor pairs. Importantly, it prioritizes *exact matches* where debtor amount equals creditor amount. Why? Because settling an exact match eliminates two people at once rather than one, preserving independent balance subsets.
>
> If all direct pairs are blocked by constraints, we fall back to **Tier 3** on line 661: `tryIntermediaryRouting`. This searches our pool for a neutral third party $I$ who has no constraint conflicts with either the debtor or the creditor. When found, it generates a 2-hop transaction: debtor pays $I$, and $I$ pays creditor. The financial invariant here is that $I$ receives $X$ and pays $X$, so $\Delta \text{Balance}(I) \equiv 0$.
>
> Finally, on line 667, if neither direct matching nor intermediary routing can find an unblocked path, we have hit a mathematical deadlock. Instead of looping infinitely, we extract the remaining participants and throw a descriptive deadlock exception, which our API converts into a 422 Unprocessable Entity error."

---

### Function 2: `allocatePayerContributions` (`src/services/settlementService.js`)

```javascript
function allocatePayerContributions(payers, splits, totalAmount) {
  const matrix = [];
  const payerRemaining = payers.map(p => p.amountCents);

  for (let i = 0; i < splits.length; i++) {
    const splitAmount = splits[i].amount;
    const row = new Array(payers.length).fill(0);

    if (i === splits.length - 1) {
      for (let k = 0; k < payers.length; k++) {
        row[k] = payerRemaining[k];
      }
    } else {
      let allocated = 0;
      const raw = [];

      for (let k = 0; k < payers.length; k++) {
        const exact = totalAmount > 0 ? (splitAmount * payers[k].amountCents) / totalAmount : 0;
        const floor = Math.min(Math.floor(exact), payerRemaining[k]);
        row[k] = floor;
        allocated += floor;
        raw.push({ k, frac: exact - Math.floor(exact), rem: payerRemaining[k] - floor });
      }

      let remainder = splitAmount - allocated;
      raw.sort((a, b) => b.frac - a.frac);

      for (const item of raw) {
        if (remainder <= 0) break;
        if (item.rem > 0) {
          row[item.k]++;
          item.rem--;
          remainder--;
        }
      }

      if (remainder > 0) {
        for (let k = 0; k < payers.length && remainder > 0; k++) {
          const avail = payerRemaining[k] - row[k];
          const take = Math.min(avail, remainder);
          row[k] += take;
          remainder -= take;
        }
      }

      for (let k = 0; k < payers.length; k++) {
        payerRemaining[k] -= row[k];
      }
    }

    matrix.push(row);
  }

  return matrix;
}
```

**Interview Spoken Walkthrough:**
> "Let's look at `allocatePayerContributions`. This solves a subtle but critical problem: when multiple people co-fund an expense (say Alice paid $60 and Bob paid $40 on a $100 dinner split among 3 people), how do you generate the exact double-entry ledger rows without dropping a single cent?
>
> We represent this as a 2D matrix where `matrix[splitIdx][payerIdx]` is the exact integer cents that split participant $i$ owes to payer $k$.
>
> We have two strict mathematical invariants to satisfy simultaneously:
> 1. Across each row $i$: $\sum_k \text{matrix}[i][k] === \text{split}[i].\text{amount}$ (each participant pays exactly their share).
> 2. Down each column $k$: $\sum_i \text{matrix}[i][k] === \text{payer}[k].\text{amountCents}$ (each payer is credited exactly what they paid).
>
> Here's how the code achieves this:
>
> On line 87, we track `payerRemaining`, which begins with each payer's total outlay.
>
> Then we loop over each split participant $i$.
>
> If we are on the **final split participant** (line 93), we take a conservation shortcut: we simply assign whatever balances remain in `payerRemaining` directly to this row. Because our route validation already proved that the sum of all splits equals the sum of all payers equals `totalAmount`, whatever is left in `payerRemaining` is mathematically guaranteed to equal the final participant's share down to the penny.
>
> For all preceding splits (lines 102–137), we calculate each payer's proportional share using integer division with `Math.floor`. We track the unallocated remainder cents in `remainder = splitAmount - allocated`.
>
> Then on lines 114–123, we use the largest-remainder method: we sort the payers by their fractional remainder `frac` descending, and allocate +1 cent to the payers with the largest fractional part, provided that payer still has remaining headroom (`item.rem > 0`).
>
> If any remainder still lingers due to headroom caps, line 125 does a greedy sweep across available payer funds to absorb it.
>
> Finally, on line 135, we deduct the row's allocations from `payerRemaining` and push the completed row to the matrix. This guarantees zero fractional cent accumulation across both dimensions of the transaction."

---

## 5. Toughest Possible Questions

### Q1: "Your README mentions that the intermediary in Tier 3 receives zero net financial change ($\Delta \text{Balance} = 0$). But in the real world, isn't there counterparty credit risk and timing risk if Debtor A pays Intermediary I, but Intermediary I fails or refuses to pay Creditor C? How does your software or ledger handle this?"
**Model Answer:**
"**Honest Admission:**
Our current ledger implementation does **not** protect against real-world timing or escrow default risk, and that is a genuine operational vulnerability of intermediary routing in any software that does not hold actual fiat custody.

In our database, when a settlement is executed, the two ledger entries:
1. `Debtor A -> Intermediary I: $50`
2. `Intermediary I -> Creditor C: $50`
are written to MongoDB simultaneously inside the same atomic ACID transaction. Mathematically and on paper, the debt is settled instantly.

However, in the physical world:
* Debtor A might send $50 via Venmo to Intermediary I on Monday.
* Intermediary I might spend the $50, forget, or refuse to transfer it to Creditor C on Tuesday.
* If Creditor C comes back and says 'I was never paid,' our ledger currently shows Creditor C has a balance of $0, even though they never received fiat currency.

**How a Production Financial System Solves This:**
If I had more time to build this properly:
1. **Escrow State Machine:** Instead of writing settled `LedgerEntry` records immediately, multi-hop settlements should generate a pending `SettlementWorkflow` record with a two-phase state machine: `PENDING_LEG_1` $\rightarrow$ `LEG_1_CONFIRMED` $\rightarrow$ `PENDING_LEG_2` $\rightarrow$ `COMPLETED`.
2. **Conditional Reversal:** If Leg 2 is not confirmed by Creditor C within a 72-hour window, the system automatically posts compensating `REVERSAL` ledger entries that reinstate Debtor A's debt directly to Creditor C and flag Intermediary I with an unpaid liability to Debtor A.
3. **Custodial Settlement:** Integrate a licensed payment rail (like Stripe Connect or Dwolla) where funds are held in an escrow FBO account until both legs clear."

---

### Q2: "You claim your ledger is immutable and enforces Write Once, Read Many (WORM) through Mongoose hooks. Isn't application-level immutability an illusion if someone with raw database access or a non-Mongoose driver runs a query? How vulnerable is this architecture?"
**Model Answer:**
"**Honest Admission:**
Yes, absolutely. Calling our current setup 'strictly immutable' is an overstatement from an infrastructure security perspective. It is **application-level enforcement**, not engine-level or cryptographic immutability.

Specifically, in `src/models/LedgerEntry.js`, we have:
```javascript
ledgerEntrySchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('LedgerEntry is immutable'));
  next();
});
ledgerEntrySchema.pre(['updateOne', 'deleteOne', ...], function () {
  throw new Error('Mutation forbidden');
});
```
This protects against developer errors *inside the Next.js application codebase*. But it has two gaping vulnerabilities:
1. **Bypassed by Native MongoDB Drivers:** If an engineer connects to the database via MongoDB Compass, `mongosh`, a Python analytics script, or a raw Node.js `mongodb` MongoClient without Mongoose, they can issue `db.ledger_entries.updateOne(...)` or `db.ledger_entries.deleteMany({})` and wipe history with zero errors.
2. **Mongoose Query Middleware Bypass:** Certain bulk operations or direct MongoDB commands (like `bulkWrite` with raw drivers) bypass document middleware.

**How to Make It Genuinely Immutable in Production:**
1. **MongoDB Collection-Level JSON Schema with `$expr`:** Configure schema validation rules on the collection itself inside MongoDB:
   ```javascript
   db.runCommand({
     collMod: "ledger_entries",
     validator: { $jsonSchema: { ... } },
     validationAction: "error"
   });
   ```
2. **Database Role Privileges (Least Privilege):** The application's database user should only be granted `insert` and `find` roles on the `ledger_entries` collection, explicitly denying `update` and `delete` privileges at the MongoDB RBAC level.
3. **Cryptographic Hash Chaining:** Like a blockchain or Amazon QLDB, each ledger entry should store a SHA-256 hash of its contents plus the `previousEntryHash`. If any historical row is tampered with out-of-band, the cryptographic hash chain breaks during verification."

---

### Q3: "In `allocatePayerContributions`, you claim exact 2D penny conservation across an arbitrary number of payers and split participants. Can you prove that the greedy assignment of remainders in row $i$ will never deplete a payer's remaining funds such that a later row $j$ is left with an underfunded split?"
**Model Answer:**
"**Honest Admission:**
In our implementation, if you examine lines 107–130 of `settlementService.js`, row allocations cap each payer's contribution at `payerRemaining[k]`, and on the final row, row $N-1$ takes whatever is left in `payerRemaining`.

**Where the Greedy Logic Can Skew:**
While the total sum across the entire matrix is guaranteed to equal `totalAmount` because the final row consumes the exact residual balance, **the per-split row sum for the final participant could theoretically deviate if earlier rows consumed too much from specific payers.**

Why? Because rows $0$ through $N - 2$ allocate greedy remainders based on each payer's fractional part *within that specific split*, without looking ahead to the future requirements of later splits.
While:
$$\sum_{k=0}^{P-1} \text{matrix}[N-1][k] \equiv \text{splits}[N-1].\text{amount}$$
holds true in aggregate because $\sum \text{splits} \equiv \sum \text{payers}$, the *distribution* of which payer funded the final split can become skewed (e.g., Payer 1 funded 90% of Split 0, leaving Payer 2 to fund 100% of the final split, rather than a perfectly balanced proportional contribution).

**The Mathematically Rigorous Solution:**
To guarantee both row-sum proportionality and column-sum proportionality without greedy skew, the proper mathematical algorithm is the **Biproportional Apportionment Algorithm** (also known as the **RAS method** or **Sinkhorn-Knopp algorithm** for matrix scaling). It iteratively alternates between scaling matrix rows and matrix columns to match marginal totals, followed by controlled rounding. For our current use case of splitting restaurant bills and vacation rentals among 3–8 friends, our greedy remainder approach is deterministic and strictly conserves every penny, but calling it a provably uniform 2D distribution under extreme edge cases would be mathematically false."

---

## 6. Behavioral Story ("Hardest Bug I Hit")

**Interviewer Prompt:** *"Tell me about a time you ran into a really challenging technical bug in this project. How did you diagnose it, what was the root cause, and what did you learn?"*

### Candidate Story:

#### 1. Situation
> "While implementing multi-payer co-funding—where multiple people co-fund a single group expense—I introduced an automated fuzz test that generated randomized expenses with up to 5 payers and 10 split participants, with random amounts between $10.00 and $500.00.
>
> Everything worked fine on clean round numbers, but when the fuzz test hit uneven divisions—for example, a $100.00 bill paid by Alice ($60.01) and Bob ($39.99), split equally among Charlie, Dave, and Alice—the test assertion failed: the sum of the generated reciprocal double-entry ledger rows was off by exactly **+1 cent** compared to the expense total."

#### 2. Problem
> "A 1-cent discrepancy in a double-entry ledger is fatal: it violates the zero-sum balance invariant ($\sum \text{Debits} \neq \sum \text{Credits}$). If this reached production, every time an uneven multi-payer bill was recorded, ghost cents would be minted out of thin air, causing the group's net settlement sum to never resolve to zero.
>
> Even worse, the bug was non-deterministic: it only appeared on specific combinations of prime cent values and participant counts."

#### 3. Debugging Process
> "I isolated the failure into a minimal reproducible unit test: a $10.00 bill co-funded by Alice ($6.67) and Bob ($3.33), split 3 ways ($3.33, $3.33, $3.34).
>
> I logged the step-by-step matrix calculation. Here is what I discovered:
> We were running the standard 1D largest-remainder method independently on each participant's split row.
>
> For Participant 1's share of $3.33:
> * Alice's raw share was: $333 \times (667 / 1000) = 222.111\text{ cents} \rightarrow \text{floor } 222$
> * Bob's raw share was: $333 \times (333 / 1000) = 110.889\text{ cents} \rightarrow \text{floor } 110$
> * Total floor was $222 + 110 = 332$. Remainder was $1$ cent.
> * Bob had the higher fractional remainder ($0.889 > 0.111$), so Bob got the extra cent $\rightarrow 111$ cents.
>
> This worked for Participant 1. But because each row was distributing remainders independently without tracking a global column budget for what Alice and Bob had actually paid in total, by the time we reached Participant 3, Bob had already been assigned 334 cents across the rows—exceeding the 333 cents Bob had actually paid! The algorithm was creating money from Bob that Bob never contributed."

#### 4. Resolution & Code Fix
> "The fix required moving from independent 1D remainder distribution to a **constrained 2D contribution matrix with residual boundary absorption**:
>
> 1. We introduced a shared `payerRemaining` state array that tracks the exact remaining cents available for each payer across the lifecycle of the entire expense.
> 2. When allocating remainder pennies in earlier rows, we added a hard guard: a payer can only receive a remainder cent if $\text{payerRemaining}[k] - \text{allocated} > 0$.
> 3. For the final split row ($i = N - 1$), instead of calculating fractional divisions, we force the row to absorb whatever exact residual balances remain in `payerRemaining`.
>
> Because our HTTP input validator already verified that $\sum \text{payers} \equiv \sum \text{splits} \equiv \text{totalAmount}$, forcing the final row to absorb `payerRemaining` mathematically guarantees zero penny drift across both dimensions."

#### 5. Lesson Learned
> "Two major takeaways:
> 1. **Local optimization breaks global invariants:** Solving rounding row-by-row works for 1D arrays, but fails when constrained by a second dimension (columns). When dealing with financial matrices, conservation must be enforced across both axes simultaneously.
> 2. **Fuzz testing with property-based assertions is indispensable for financial code:** If I had only tested round dollar amounts or simple 50/50 splits, this bug would have slipped into production and corrupted ledger history. Writing property-based tests that assert $\sum \text{Credits} \equiv \sum \text{Debits}$ on 10,000 random inputs is the only way to be confident in financial software."
