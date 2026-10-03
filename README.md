# SettleUp

A production-grade, double-entry expense sharing and debt simplification engine built with **Next.js 14**, **C++17 OOP Settlement Engine**, **Mongoose**, and **MongoDB**.

SettleUp collapses complex, cyclic group debts into the minimal possible number of bilateral settlement transactions while maintaining an immutable, append-only financial audit log with multi-currency support, constraint-aware payment routing, and full mobile responsiveness.

---

## 1. Problem Statement

### The Problem with Naive Debt Splitting
In traditional expense sharing, debts are tracked pair-by-pair: whenever Person A pays for an expense, every participant owes Person A directly. Over a shared trip or a long-term household, this naive approach produces a dense, cyclic directed graph:

* In a group of $N$ people, there are up to $\frac{N(N - 1)}{2}$ potential debt relationships.
* Circular obligations inevitably arise: Rehan owes Pulkit \$40, Pulkit owes Arnav \$40, and Arnav owes Rehan \$40.
* Settling naively requires everyone to execute multiple peer-to-peer bank transfers, incurring transaction fees, bank transfer delays, and human coordination friction.

```
Naive Directed Debt Web (Dense & Cyclic):
    [Rehan] ── $40 ──> [Pulkit]
       ^                 │
       │                 │ $40
      $40                ▼
       └─── [Arnav] <──┘
(3 transfers needed to resolve $0 net change)
```

### The Solution: Scalar Netting & Debt Simplification
Money in a closed group is zero-sum: the total amount spent equals the total amount consumed. Every participant has a single scalar net position:

$$\text{Net}_i = \sum \text{Credits}_i - \sum \text{Debits}_i \quad \text{where} \quad \sum_{i=1}^N \text{Net}_i = 0$$

By reducing the directed debt graph to scalar net balances, all cycles are collapsed in $\mathcal{O}(E)$ time. An optimization algorithm then pairs debtors with creditors, proving mathematically that any connected group of $N$ participants can be fully settled in **at most $N - 1$ transactions**—completely eliminating circular payments.

```
Simplified Settlement Plan:
    Net Balances: Rehan ($0), Pulkit ($0), Arnav ($0)
    Result: 0 transfers needed.
```

---

## 2. Architecture Overview

SettleUp combines a native C++ Object-Oriented settlement engine (with JavaScript V8 fallback) and an append-only double-entry ledger backed by MongoDB multi-document ACID transactions.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client (Browser)                              │
│   Next.js 14 App Router • Mobile-Responsive UI • Interactive SVG Graph │
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
│   Domain Services Layer   │                │   Algorithmic Bridge       │
│ • settlementService.js    │◄───────────────┤ • cppBridge.js             │
│   (ACID Multi-Doc Txns)   │                │   ├── Native C++ Binary    │
│ • currencyService.js      │                │   │   (settleup_cli IPC)   │
│   (Live FX + Stale Cache) │                │   └── Pure JS Engine       │
└────────────┬──────────────┘                │       (simplifier.js)      │
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
   * **Root Router (`app/page.jsx`):** Server-side redirect sending authenticated users straight to `/dashboard` and visitors to `/login`.
   * **Dashboard (`app/dashboard/`):** Summary of personal net balances across all groups, debt breakdowns, and group creation modals.
   * **Group Workspace (`app/groups/[id]/`):** Real-time member balances, interactive SVG debt topology visualizer, shareable 7-day invite links, and CSV export.
   * **Expense Creation (`app/groups/[id]/expenses/new/`):** Multi-payer co-funding support and 4 split types: Equal, Exact, Percentage, and Shares.
   * **Responsive Design:** 100% mobile-friendly across touchscreens, mobile drawers, collapsible tables, and responsive navigation.

2. **C++ Native Settlement Engine (`settleup.cpp` & `src/cppBridge.js`):**
   * Built as an enterprise-grade Object-Oriented C++ project:
     * **Encapsulation:** Integer-cent `Money` value object preventing float drift.
     * **Polymorphism & Strategy Pattern:** `ISettlementStrategy` with dynamic runtime dispatch between `GreedyHeapStrategy` (max-heap) and `ExactMatchGreedyStrategy`.
     * **Inheritance:** Domain-specific hierarchy inheriting from `std::exception`.
     * **RAII:** Zero memory leaks via modern smart pointers (`std::unique_ptr`).
   * Spanned via high-performance `--json` IPC from Node.js with seamless fallback to pure JavaScript V8 execution (`src/simplifier.js`).

3. **Settlement & Ledger Service (`src/services/settlementService.js`):**
   * Manages MongoDB replica set sessions, coordinates multi-document ACID transactions, computes 2D multi-payer contribution matrices, and records reciprocal double-entry ledger rows.

4. **Foreign Exchange Service (`src/services/currencyService.js`):**
   * Real-time currency conversion to group base currency. Caches rates in MongoDB (24-hour TTL), falls back to stale cache during provider outages, and includes offline static rate tables with full audit flags (`isFxStale: true`).

---

## 3. Key Technical Decisions & Trade-Offs

### Decision 1: MongoDB with Append-Only Ledger & Multi-Document Transactions vs. Relational SQL

* **Document Modeling for Hierarchical Expense Data:**
  Real-world expenses involve nested structures: multi-payer co-funding arrays (`paidBy: [{ user, amountCents }]`), variable splits (`splits: [{ user, amount }]`), and pair-based payment constraints (`constraints: [{ avoid: [u1, u2] }]`). Embedding these directly in document models eliminates multi-table joins while keeping write operations atomic per expense.
* **Covered Compound Indexes:**
  Cross-group user balances are computed using covered compound indexes (`{ user: 1, currency: 1, group: 1, signedAmount: 1 }`). MongoDB evaluates balance aggregations entirely in RAM without reading document bodies from disk.
* **WiredTiger ACID Transactions:**
  Multi-document transactions (`session.withTransaction()`) guarantee that creating an expense and inserting its reciprocal double-entry ledger rows are atomic: either all succeed or none do.
* **Append-Only Immutability (WORM):**
  `LedgerEntry` schema enforces immutability at the Mongoose middleware layer: `pre('save')`, `pre('updateOne')`, and `pre('deleteOne')` hooks explicitly reject modifications to existing entries. Corrections require compensating entries (`REVERSAL` or `ADJUSTMENT`).

### Decision 2: Strictly Integer Cents vs. Floating-Point Numbers

* **Why Integers:**
  Standard IEEE 754 floating-point arithmetic introduces binary fraction approximation errors (`0.1 + 0.2 === 0.30000000000000004`). In financial accounting, fractional-cent roundoffs compound, violating the zero-sum conservation invariant ($\sum \text{Credits} \neq \sum \text{Debits}$).
* **Penny Conservation (Hare-Niemeyer Method):**
  When splitting expenses with odd divisions (e.g., \$10.00 split among 3 people = 333.333... cents), the division truncates to integer cents (333¢ each = 999¢) and distributes the remaining 1¢ deterministically to the participant with the largest fractional remainder.
  Every split satisfies: $\sum \text{shares} \equiv \text{totalAmount}$ down to the exact penny.

### Decision 3: Greedy Debt Simplification vs. Optimal Subset Sum

* **The Problem Complexity:**
  Finding the absolute minimum number of transactions is equivalent to the **Minimum Number of Subsets with Zero Sum** problem, which is **NP-hard** ($\mathcal{O}(2^N)$ partition search).
* **Why the Greedy Approach:**
  SettleUp implements a greedy matching algorithm: repeatedly pair the debtor with the largest obligation with the creditor owed the largest sum, settling $\min(\text{debtor}, \text{creditor})$.
  * **Time Complexity:** $\mathcal{O}(E)$ for net balance reduction, plus $\mathcal{O}(N \log N)$ for priority queue matching.
  * **Upper Bound:** Guarantees at most $N - 1$ transactions for any connected group of $N$ participants.
* **Tier 2 Exact-Balance Matching:**
  Before executing a partial settlement, the engine searches for exact pairs ($\text{debtor.amount} === \text{creditor.amount}$). If found, it clears them first, zeroing out two participants in a single transaction and preserving subgroup independence.

---

## 4. Edge Cases Handled

1. **Multi-Payer Co-Funded Bills:**
   Multiple individuals can co-fund a single bill (e.g., Rehan pays \$60 and Pulkit pays \$40 on a \$100 dinner). Handled via a 2D matrix allocation algorithm with strict penny conservation.
2. **Deterministic Leftover Cent Distribution:**
   Percentage and shares splits distribute residual cents using the largest-remainder method with deterministic tie-breaking.
3. **Mutual Avoidance Constraints:**
   When two participants must not transact directly (e.g., estranged roommates), SettleUp routes payment through a neutral third-party intermediary: `[Debtor -> Intermediary, Intermediary -> Creditor]`. The intermediary's net balance delta is guaranteed to be zero.
4. **Constraint Deadlock Detection:**
   If mutual avoidance constraints create an impossible topology where no direct or intermediary path exists, the engine halts before writing to the database and surfaces a descriptive `CONSTRAINT_DEADLOCK (422)` error.
5. **Self-Debt Elimination:**
   Expenses where the payer is also in the split (or accidental debts where debtor equals creditor) are filtered during scalar net balance reduction.
6. **Isolated Subgroup Partitioning:**
   BFS graph partitioning detects disconnected spending clusters and settles each independently so money never crosses unrelated parties.
7. **Offline & Stale Foreign Exchange Resilience:**
   If the live FX provider is unreachable, the system falls back to cached rates or built-in cross-rates, flagging the ledger entry with `isFxStale: true` for auditability.
8. **Append-Only Immutability Protection:**
   Document-level and query-level Mongoose hooks block all `update` and `delete` operations on `LedgerEntry`.
9. **Shareable Invite Expiration & Revocation:**
   Group invite links utilize 64-bit entropy hex tokens with a 7-day sliding expiration and instant revocation support.
10. **Brute-Force Rate Limiting:**
    Public join endpoints enforce a sliding-window rate limiter (10 attempts per 15 minutes per IP) to prevent automated token guessing.
11. **Idempotent Group Joining:**
    Authenticated users who revisit an invite link they have already joined receive confirmation without duplicate member insertions.

---

## 5. Setup & Running Locally

### Prerequisites
* **Node.js:** v18.17.0 or higher
* **npm:** v9.0.0 or higher
* **C++ Compiler (Optional but recommended):** `g++` with C++17 support (e.g. Apple Clang or GCC)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Pulkitgupta2007/settleup.git
cd settleup
npm install
```

### 2. Configure Environment Variables
Create a `.env.local` file in the project root:

```env
# Database (leave empty or use mongodb://127.0.0.1:27017/settleup for local embedded server)
MONGODB_URI=mongodb://127.0.0.1:27017/settleup

# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=settleup-dev-jwt-secret-very-secure-key-32chars

# Optional: Google OAuth Provider (leave placeholders if testing credentials only)
GOOGLE_CLIENT_ID=placeholder-client-id
GOOGLE_CLIENT_SECRET=placeholder-client-secret
```

### 3. Run Locally (Zero-Config Development Server)
SettleUp includes an embedded MongoDB Replica Set manager (`mongodb-memory-server`) that spins up a local database with WiredTiger transactions and compiles the native C++ engine automatically:

```bash
npm run dev
```

* **Local App:** Open [http://localhost:3000](http://localhost:3000) (automatically redirects to `/dashboard` or `/login`)
* **Pre-seeded Demo Accounts:**
  * Email: `rehan@example.com` | Password: `demo-password-123`
  * Email: `pulkit@example.com` | Password: `demo-password-123`
  * Email: `arnav@example.com` | Password: `demo-password-123`

### 4. Build C++ Engine Manually
To compile the C++ OOP settlement engine binary manually:
```bash
npm run build:cpp
```
This outputs `bin/settleup_cli`, which can also be executed directly via terminal:
```bash
./bin/settleup_cli --demo
```

### 5. Running with MongoDB Atlas (Production)
To run against a remote MongoDB Atlas cluster:
1. Create a MongoDB Atlas cluster (M0 free tier or higher).
2. Whitelist your IP address in Atlas Network Access.
3. Update `MONGODB_URI` in `.env.local`:
   ```env
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/settleup?retryWrites=true&w=majority
   ```
4. Build and start:
   ```bash
   npm run seed
   npm run build
   npm start
   ```

---

## 6. What I'd Improve with More Time

1. **Hybrid Exact/Greedy Simplification Engine:**
   Implement an exact branch-and-bound subset-sum solver for small groups ($N \le 12$) to achieve mathematically provable minimal transaction count ($N - k$), while automatically switching to the greedy heuristic for larger groups ($N > 12$) to avoid exponential latency.
2. **Distributed Rate Limiting via Redis:**
   The current rate limiter uses an in-memory sliding-window bucket. Backing this with Redis (e.g., Upstash Redis) would provide shared rate-limiting state across serverless edges.
3. **Database-Enforced Immutability:**
   Move immutability enforcement from Mongoose schema middleware into native MongoDB collection validators (JSON Schema with `$expr` blocking updates) to protect against direct administrative writes.
4. **Real-Time Settlement Broadcasts (WebSockets / SSE):**
   Introduce Server-Sent Events (SSE) on the group dashboard to push real-time debt graph recalculations to all group members simultaneously whenever an expense or settlement is recorded.
