# SettleUp

A production-grade, double-entry expense sharing and debt simplification engine built with Next.js 14, Mongoose, and MongoDB.

SettleUp collapses complex, cyclic group debts into the minimal possible number of settlement transactions while maintaining an immutable, append-only financial audit log with multi-currency support and constraint-aware payment routing.

---

## 1. Problem Statement

### The Problem with Naive Debt Splitting
In traditional expense sharing, debts are tracked pair-by-pair: whenever Person A pays for an expense, every participant owes Person A directly. Over a shared vacation or a long-term household, this naive approach produces a dense, cyclic directed graph:

* In a group of $N$ people, there are up to $\frac{N(N - 1)}{2}$ potential debt relationships.
* Circular obligations inevitably arise: Alice owes Bob \$40, Bob owes Charlie \$40, and Charlie owes Alice \$40.
* Settling naively requires everyone to execute multiple peer-to-peer bank transfers, incurring transaction fees, bank transfer delays, and human coordination friction.

```
Naive Directed Debt Web (Dense & Cyclic):
    [Alice] ── $40 ──> [Bob]
       ^                 │
       │                 │ $40
      $40                ▼
       └─── [Charlie] <──┘
(3 transfers needed to resolve $0 net change)
```

### The Solution: Scalar Netting & Debt Simplification
Money in a closed group is zero-sum: the total amount spent equals the total amount consumed. Every participant has a single scalar net position:

$$\text{Net}_i = \sum \text{Credits}_i - \sum \text{Debits}_i \quad \text{where} \quad \sum_{i=1}^N \text{Net}_i = 0$$

By reducing the directed debt graph to scalar net balances, all cycles are collapsed in $\mathcal{O}(E)$ time. An optimization algorithm then pairs debtors with creditors, proving mathematically that any connected group of $N$ participants can be fully settled in **at most $N - 1$ transactions**—completely eliminating circular payments.

```
Simplified Settlement Plan:
    Net Balances: Alice ($0), Bob ($0), Charlie ($0)
    Result: 0 transfers needed.
```

---

## 2. Architecture Overview

SettleUp combines a pure functional algorithmic core with an append-only double-entry ledger backed by MongoDB multi-document ACID transactions.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client (Browser)                              │
│   Next.js 14 App Router (React 18) • SVG Debt Graph • Responsive UI    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP / JSON
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Next.js API Route Handlers                          │
│   /api/groups • /api/groups/[id]/expenses • /api/groups/[id]/settle     │
│   /api/groups/[id]/export • /api/groups/join • /api/users               │
│                                                                         │
│   [Auth Validation]   [Rate Limiter]   [Zod/Type Validators]            │
└────────────┬──────────────────────────────────────────────┬─────────────┘
             │                                              │
             ▼                                              ▼
┌───────────────────────────┐                ┌────────────────────────────┐
│   Domain Services Layer   │                │   Algorithmic Core         │
│ • settlementService.js    │◄───────────────┤ • simplifier.js (Pure JS)  │
│   (ACID Multi-Doc Txns)   │                │   - BFS Component Splitter │
│ • currencyService.js      │                │   - Scalar Net Reduction   │
│   (Live FX + Stale Cache) │                │   - 4-Tier Greedy Matcher  │
└────────────┬──────────────┘                │   - Intermediary Rerouter  │
             │                               └────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      MongoDB (WiredTiger Storage)                       │
│  • groups        • expenses         • users        • exchange_rates     │
│  • ledger_entries (Append-Only WORM, Covered Compound Indexes)          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Module Responsibilities

1. **Next.js App Router & Client Components:**
   * Interactive group dashboards, multi-payer expense split forms, visual debt graph (SVG), CSV transaction exporter, and invite link management.
   * Client-side session management via NextAuth.
2. **API Route Handlers (`app/api/`):**
   * Enforces authentication, payload schema validation, sliding-window rate limiting, and unified JSON error formatting.
3. **Pure Algorithmic Engine (`src/simplifier.js`):**
   * Zero external dependencies. Accepts generic arrays of `{ from, to, amount }` and returns the minimal transaction list. Completely isolated from the database and UI layers for independent unit testing.
4. **Settlement & Ledger Service (`src/services/settlementService.js`):**
   * Coordinates MongoDB replica set sessions, manages multi-document ACID transactions, computes 2D multi-payer contribution matrices, and writes reciprocal double-entry records.
5. **Foreign Exchange Service (`src/services/currencyService.js`):**
   * Multi-currency conversion to group base currency. Features MongoDB caching with 24-hour TTL, live external API retrieval, stale-cache fallback, and offline static rate tables.

---

## 3. Key Technical Decisions & Trade-Offs

### Decision 1: MongoDB with Append-Only Ledger & Multi-Document Transactions vs. Relational SQL

* **Why MongoDB:**
  1. **Document Modeling for Hierarchical Data:** Real-world expenses involve complex nested structures: multi-payer co-funding arrays (`paidBy: [{ user, amountCents }]`), variable splits (`splits: [{ user, amount }]`), and pair-based payment constraints (`constraints: [{ avoid: [u1, u2] }]`). Embedding these directly in document models eliminates multi-table joins while keeping write operations atomic per expense.
  2. **Covered Compound Indexes for High-Speed Aggregations:** User balances across dozens of groups are computed using covered compound indexes (`{ user: 1, currency: 1, group: 1, signedAmount: 1 }`). MongoDB evaluates the aggregation entirely inside the RAM index tree without reading document bodies from disk.
  3. **WiredTiger ACID Transactions:** Multi-document transactions (`session.withTransaction()`) guarantee that creating an expense and inserting its reciprocal double-entry ledger rows are atomic: either all succeed or none do.
* **Append-Only Immutability (WORM):**
  * Financial ledgers must never overwrite history. `LedgerEntry` schema enforces immutability at the Mongoose middleware layer: `pre('save')`, `pre('updateOne')`, `pre('deleteOne')`, and query-level delete/update hooks explicitly throw runtime exceptions if modification of an existing entry is attempted. Corrections require compensating entries (`REVERSAL` or `ADJUSTMENT`).
* **Honest Trade-Off:**
  * Relational databases (e.g., PostgreSQL) provide native database-level check constraints and declarative foreign keys. In MongoDB, referential integrity and immutability must be maintained by application-level validation and schema hooks. If a client accesses the raw MongoDB collection directly without Mongoose, those application hooks can be bypassed unless collection-level JSON Schema validators are enforced.

### Decision 2: Strictly Integer Cents vs. Floating-Point Numbers

* **Why Integers:**
  * Standard IEEE 754 floating-point arithmetic introduces binary fraction approximation errors (e.g., `0.1 + 0.2 === 0.30000000000000004`). In financial accounting, fractional-cent roundoffs compound across thousands of transactions, violating the zero-sum conservation invariant ($\sum \text{Credits} \neq \sum \text{Debits}$).
  * All amounts in SettleUp are strictly represented as integers in the smallest currency unit (e.g., cents for USD/EUR, paise for INR, cents for CAD).
  * Runtime validators assert `Number.isInteger(amount) && amount > 0`.
* **Penny Conservation (Hare-Niemeyer Method):**
  * When splitting expenses with odd divisions (e.g., \$10.00 split among 3 people = 333.333... cents), the division truncates to integer cents (333¢ each = 999¢) and distributes the remaining 1¢ deterministically to the participant with the largest fractional remainder.
  * Every split satisfies: $\sum \text{shares} \equiv \text{totalAmount}$ down to the exact penny.
* **Honest Trade-Off:**
  * Zero-decimal currencies (like JPY or KRW) and three-decimal currencies (like BHD or KWD) require standardized scaling factors if mixed into cross-currency groups. SettleUp handles this by converting everything into integer cents of the group's designated base currency at creation time.

### Decision 3: Greedy Debt Simplification vs. Optimal Subset Sum

* **The Problem Complexity:**
  * Finding the *strictly minimum* number of transactions to clear a debt network is equivalent to the **Minimum Number of Subsets with Zero Sum** problem, which is **NP-hard**.
  * Finding the absolute minimum requires solving an exponential search over partitions: $\mathcal{O}(2^N)$ or $\mathcal{O}(3^N)$ dynamic programming.
* **Why the Greedy Approach:**
  * SettleUp implements a greedy matching algorithm: repeatedly pair the debtor with the largest obligation with the creditor owed the largest sum, settling $\min(\text{debtor}, \text{creditor})$.
  * **Time Complexity:** $\mathcal{O}(E)$ for net balance reduction, plus $\mathcal{O}(N \log N)$ for debtor/creditor priority queue management (where $E$ is raw debt edges and $N$ is distinct participants).
  * **Upper Bound:** Guarantees at most $N - 1$ transactions for a connected component of $N$ non-zero balance participants.
* **Honest Optimality Analysis:**
  * If a group contains independent zero-sum subsets (e.g., Subgroup 1: Alice owes \$50, Bob is owed \$50; Subgroup 2: Charlie owes \$20, Dave is owed \$20), the theoretical minimum is 2 transactions ($N - 2$). A naive largest-first greedy heuristic might cross-settle between subsets and produce 3 transactions ($N - 1$).
  * **Mitigation:** SettleUp incorporates **Tier 2 exact-balance matching**: before executing a partial settlement, it searches for exact pairs ($\text{debtor.amount} === \text{creditor.amount}$). If found, it clears them first, zeroing out two participants in a single transaction and preserving subset independence.
  * For real-world groups ($N \le 50$), the difference between true minimum and SettleUp's greedy heuristic is at most 1–2 transactions, but greedy executes in sub-millisecond time without risking exponential server freezes.

---

## 4. Edge Cases Handled

1. **Multi-Payer Co-Funded Bills:**
   * Multiple individuals can co-fund a single bill (e.g., Alice pays \$60 and Bob pays \$40 on a \$100 dinner). Handled via a 2D matrix allocation algorithm with strict penny conservation: each payer's total outlays match their contribution, and each consumer's total liability matches their consumption.
2. **Deterministic Leftover Cent Distribution:**
   * Percentage splits (must sum to 100%) and shares splits (e.g., 2:2:1 ratio) distribute residual cents using the largest-remainder method with deterministic alphabetical tie-breaking, preventing penny fabrication or loss.
3. **Mutual Avoidance Constraints:**
   * When two participants must not transact directly (e.g., estranged roommates), SettleUp searches for a neutral third-party intermediary to route payment: `[Debtor -> Intermediary, Intermediary -> Creditor]`. The intermediary's net balance delta is guaranteed to be exactly zero: $\Delta \text{Balance}(I) = (+X) + (-X) = 0$.
4. **Constraint Deadlock Detection:**
   * If mutual payment avoidance constraints create an impossible topology where no direct or intermediary path exists, the engine halts before writing to the database and surfaces a descriptive `CONSTRAINT_DEADLOCK (422)` error.
5. **Self-Debt Elimination:**
   * Expenses where the payer is also in the split (or accidental debts where debtor equals creditor) are filtered during scalar net balance reduction, having zero impact on inter-member debt.
6. **Isolated Subgroup Partitioning:**
   * If a group contains disconnected spending clusters (e.g., Subgroup A went rafting, Subgroup B visited a museum), BFS graph partitioning detects connected components and settles each independently so money never crosses unrelated parties.
7. **Offline & Stale Foreign Exchange Resilience:**
   * Multi-currency transactions query live exchange rates with timeout abort controllers. If the provider is unreachable, the system falls back to cached rates; if the cache is empty, it falls back to built-in cross-rates, flagging the ledger entry with `isFxStale: true` for transparency.
8. **Append-Only Immutability Protection:**
   * Document-level and query-level Mongoose hooks block all `update`, `findOneAndUpdate`, and `delete` operations on `LedgerEntry`. Historical data cannot be modified in place.
9. **Shareable Invite Expiration & Revocation:**
   * Group invite links utilize 64-bit entropy hex tokens with a 7-day sliding expiration. Group owners can revoke links on demand, which immediately generates a new token and invalidates the previous link.
10. **Brute-Force Rate Limiting:**
    * Public join endpoints enforce a sliding-window rate limiter (10 attempts per 15 minutes per IP) to prevent automated token guessing.
11. **Idempotent Group Joining:**
    * Authenticated users who revisit an invite link they have already joined receive confirmation without duplicate member insertions.

---

## 5. Setup & Running Locally

### Prerequisites
* **Node.js:** v18.17.0 or higher
* **npm:** v9.0.0 or higher

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/settleup.git
cd settleup
npm install
```

### 2. Configure Environment Variables
Create a `.env.local` file in the project root:

```env
# Database (leave empty or use mongodb://127.0.0.1:27017/settleup for local dev)
MONGODB_URI=mongodb://127.0.0.1:27017/settleup

# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=settleup-dev-jwt-secret-very-secure-key-32chars

# Optional: Google OAuth Provider (leave placeholders if testing credentials only)
GOOGLE_CLIENT_ID=placeholder-client-id
GOOGLE_CLIENT_SECRET=placeholder-client-secret
```

### 3. Run Locally (Zero-Config Development Server)
SettleUp includes an embedded MongoDB Replica Set manager (`mongodb-memory-server`) that spins up a local instance with WiredTiger transactions enabled automatically:

```bash
npm run dev
```

* **Local App:** Open [http://localhost:3000](http://localhost:3000)
* **Pre-seeded Demo Accounts:**
  * Email: `alice@example.com` | Password: `demo-password-123`
  * Email: `bob@example.com` | Password: `demo-password-123`
  * Email: `charlie@example.com` | Password: `demo-password-123`

### 4. Running with MongoDB Atlas (Production)
To run against a remote MongoDB Atlas cluster:
1. Create a MongoDB Atlas cluster (M0 free tier or higher). Ensure it is configured as a Replica Set (Atlas does this by default).
2. Whitelist your IP address in Atlas Network Access.
3. Update `MONGODB_URI` in `.env.local`:
   ```env
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/settleup?retryWrites=true&w=majority
   ```
4. Run migrations and seed data:
   ```bash
   npm run seed
   npm run build
   npm run start
   ```

### 5. Running Automated Tests
Run the test suite covering units, schemas, rate limiting, and end-to-end API routes:

```bash
npm test
```

Expected output:
```bash
PASS tests/rateLimiter.test.js
PASS tests/simplifier.test.js
PASS tests/currency.test.js
PASS tests/validation.test.js
PASS tests/models.test.js
PASS tests/routes.test.js

Test Suites: 6 passed, 6 total
Tests:       96 passed, 96 total
Snapshots:   0 total
```

---

## 6. What I'd Improve with More Time

1. **Hybrid Exact/Greedy Simplification Engine:**
   * Implement an exact branch-and-bound subset-sum solver for small groups ($N \le 12$) to achieve mathematically provable minimal transaction count ($N - k$), while automatically switching to the greedy heuristic for larger groups ($N > 12$) to avoid exponential latency.
2. **Distributed Rate Limiting via Redis:**
   * The current rate limiter uses an in-memory sliding-window bucket, which is efficient on single-node servers but resets across serverless lambda instances. Backing this with Redis (e.g., Upstash Redis) would provide shared rate-limiting state across serverless edges.
3. **Database-Enforced Immutability:**
   * Move immutability enforcement from Mongoose schema middleware into native MongoDB collection validators (JSON Schema with `$expr` blocking updates) or read-only database user credentials to protect against direct administrative writes.
4. **Real-Time Settlement Broadcasts (WebSockets / SSE):**
   * Introduce Server-Sent Events (SSE) on the group dashboard to push real-time debt graph recalculations to all group members simultaneously whenever an expense or settlement is recorded.
5. **End-to-End Browser Testing:**
   * Supplement the current 96 unit/integration tests with a Playwright test suite to verify full user workflows across browser sessions (e.g., invite link click -> registration -> automatic group join -> ledger inspection).
