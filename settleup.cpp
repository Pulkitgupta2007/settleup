/**
 * ==============================================================================
 * SettleUp - Object-Oriented Multi-Party Debt Netting Engine
 * ==============================================================================
 * 
 * An Enterprise-grade C++ Object-Oriented Programming (OOP) Project
 * demonstrating Core Software Engineering and OOP Principles:
 * 
 * 1. ENCAPSULATION:
 *    - All internal states (cents, balances, ledger logs) are private.
 *    - Public interfaces, getters, const-correct member functions, and invariants.
 * 
 * 2. ABSTRACTION:
 *    - Pure abstract interface `ISettlementStrategy` decoupling algorithm from context.
 *    - Complex greedy graph reduction is abstracted behind simple `settle()` calls.
 * 
 * 3. INHERITANCE:
 *    - `GreedyHeapStrategy` and `ExactMatchGreedyStrategy` derive from `ISettlementStrategy`.
 *    - Custom domain exception hierarchy deriving from `exception`.
 * 
 * 4. POLYMORPHISM:
 *    - Runtime Polymorphism: Dynamic strategy dispatch via `unique_ptr<ISettlementStrategy>`.
 *    - Compile-time Polymorphism: Operator overloading (`<<`, `+`, `-`, `<`, `==`).
 * 
 * 5. DESIGN PATTERNS:
 *    - Strategy Pattern: `SettlementContext` allows hot-swapping settlement heuristics.
 *    - Value Object Pattern: `Money` encapsulates integer-cent currency representations.
 *    - RAII: Modern smart pointers (`unique_ptr`, `shared_ptr`) with zero leaks.
 * 
 * ==============================================================================
 * Compilation:
 *   g++ -std=c++17 settleup.cpp -o settleup_cli
 * 
 * Usage:
 *   ./settleup_cli --demo        (Runs built-in multi-party test suite)
 *   ./settleup_cli               (Interactive OOP CLI)
 * ==============================================================================
 */

#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <queue>
#include <memory>
#include <algorithm>
#include <iomanip>
#include <sstream>
#include <cmath>
#include <exception>

using namespace std;

// ==============================================================================
// 1. CUSTOM EXCEPTION HIERARCHY (Inheritance & Polymorphism)
// ==============================================================================

class SettleUpException : public exception {
protected:
    string message;
public:
    explicit SettleUpException(string msg) : message(std::move(msg)) {}
    const char* what() const noexcept override {
        return message.c_str();
    }
};

class ConservationViolationException : public SettleUpException {
public:
    explicit ConservationViolationException(long long netSum)
        : SettleUpException("Conservation of Money Invariant Violated: Net balance sum is " 
                            + to_string(netSum) + " cents (expected 0).") {}
};

class InvalidTransactionException : public SettleUpException {
public:
    explicit InvalidTransactionException(const string& reason)
        : SettleUpException("Invalid Transaction: " + reason) {}
};

// ==============================================================================
// 2. VALUE OBJECT: Money (Encapsulation & Operator Overloading)
// ==============================================================================

class Money {
private:
    long long cents; // Fixed-point integer cents (Prevents floating-point drift)
    string currency;

public:
    explicit Money(long long cents = 0, string currency = "USD")
        : cents(cents), currency(std::move(currency)) {}

    // Factory method from dollars
    static Money fromDollars(double dollars, const string& currency = "USD") {
        long long c = static_cast<long long>(round(dollars * 100.0));
        return Money(c, currency);
    }

    // Getters (Encapsulation)
    long long getCents() const noexcept { return cents; }
    const string& getCurrency() const noexcept { return currency; }
    bool isZero() const noexcept { return cents == 0; }
    bool isPositive() const noexcept { return cents > 0; }
    bool isNegative() const noexcept { return cents < 0; }

    Money abs() const {
        return Money(std::abs(cents), currency);
    }

    // Operator Overloading (Compile-time Polymorphism)
    Money operator+(const Money& other) const {
        return Money(cents + other.cents, currency);
    }

    Money operator-(const Money& other) const {
        return Money(cents - other.cents, currency);
    }

    Money& operator+=(const Money& other) {
        cents += other.cents;
        return *this;
    }

    Money& operator-=(const Money& other) {
        cents -= other.cents;
        return *this;
    }

    bool operator<(const Money& other) const noexcept { return cents < other.cents; }
    bool operator>(const Money& other) const noexcept { return cents > other.cents; }
    bool operator==(const Money& other) const noexcept { return cents == other.cents; }
    bool operator!=(const Money& other) const noexcept { return cents != other.cents; }

    // Stream Insertion Operator
    friend ostream& operator<<(ostream& os, const Money& m) {
        bool neg = m.cents < 0;
        long long absC = std::abs(m.cents);
        long long dollars = absC / 100;
        long long rem = absC % 100;

        if (neg) os << "-";
        if (m.currency == "USD") os << "$";
        else os << m.currency << " ";

        os << dollars << "." << setfill('0') << setw(2) << rem << setfill(' ');
        return os;
    }
};

// ==============================================================================
// 3. DOMAIN ENTITIES: Participant & Transaction (Encapsulation)
// ==============================================================================

class Participant {
private:
    string id;
    string name;

public:
    Participant(string id, string name)
        : id(std::move(id)), name(std::move(name)) {}

    const string& getId() const noexcept { return id; }
    const string& getName() const noexcept { return name; }

    bool operator==(const Participant& other) const noexcept {
        return id == other.id;
    }
};

class Transaction {
private:
    string debtor;   // Person who pays
    string creditor; // Person who receives
    Money amount;
    string description;

public:
    Transaction(string from, string to, Money amt, string desc = "")
        : debtor(std::move(from)), creditor(std::move(to)), amount(amt), description(std::move(desc)) {
        if (debtor == creditor) {
            throw InvalidTransactionException("Debtor and creditor cannot be the same person: " + debtor);
        }
        if (amount.getCents() <= 0) {
            throw InvalidTransactionException("Transaction amount must be strictly positive.");
        }
    }

    const string& getDebtor() const noexcept { return debtor; }
    const string& getCreditor() const noexcept { return creditor; }
    const Money& getAmount() const noexcept { return amount; }
    const string& getDescription() const noexcept { return description; }

    friend ostream& operator<<(ostream& os, const Transaction& t) {
        os << left << setw(12) << t.debtor 
           << " pays " << left << setw(12) << t.creditor 
           << " -> " << right << setw(10) << t.amount;
        if (!t.description.empty()) {
            os << " (" << t.description << ")";
        }
        return os;
    }
};

// Priority Queue Entry for Heap-based greedy netting
struct BalanceNode {
    string name;
    Money balance;

    bool operator<(const BalanceNode& other) const {
        if (balance != other.balance) {
            return balance < other.balance; // Max-heap: largest at top
        }
        return name > other.name; // Alphabetical tie-break
    }
};

// ==============================================================================
// 4. STRATEGY PATTERN: Abstract Interface & Implementations (Abstraction & Inheritance)
// ==============================================================================

/**
 * ISettlementStrategy: Abstract Strategy Interface (Pure Virtual Class)
 */
class ISettlementStrategy {
public:
    virtual ~ISettlementStrategy() = default;

    /**
     * Solves multi-party debts given a map of net scalar balances.
     * @param netBalances Map of participant name -> Net Balance
     * @return List of minimal settlement transactions
     */
    virtual vector<Transaction> settle(
        const unordered_map<string, Money>& netBalances
    ) = 0;

    virtual string getStrategyName() const = 0;
};

/**
 * Concrete Strategy 1: Greedy Max-Heap Settlement Strategy
 * Matches maximum debtor with maximum creditor in O(N log N) time.
 */
class GreedyHeapStrategy : public ISettlementStrategy {
public:
    string getStrategyName() const override {
        return "Greedy Max-Heap Cash-Flow Minimization (Standard O(N log N))";
    }

    vector<Transaction> settle(
        const unordered_map<string, Money>& netBalances
    ) override {
        vector<Transaction> settlements;
        priority_queue<BalanceNode> debtors;
        priority_queue<BalanceNode> creditors;

        for (const auto& [name, balance] : netBalances) {
            if (balance.isNegative()) {
                debtors.push({name, balance.abs()});
            } else if (balance.isPositive()) {
                creditors.push({name, balance});
            }
        }

        while (!debtors.empty() && !creditors.empty()) {
            auto debtor = debtors.top();
            debtors.pop();

            auto creditor = creditors.top();
            creditors.pop();

            Money settled = min(debtor.balance, creditor.balance);
            settlements.emplace_back(debtor.name, creditor.name, settled, "Greedy cycle netting");

            if (debtor.balance > settled) {
                debtors.push({debtor.name, debtor.balance - settled});
            }
            if (creditor.balance > settled) {
                creditors.push({creditor.name, creditor.balance - settled});
            }
        }

        return settlements;
    }
};

/**
 * Concrete Strategy 2: Exact-Match Optimized Greedy Strategy
 * Prioritizes matching debtors and creditors with EXACT matching amounts
 * to simultaneously resolve two parties in a single transfer, falling back
 * to greedy heap matching for remaining balances.
 */
class ExactMatchGreedyStrategy : public ISettlementStrategy {
public:
    string getStrategyName() const override {
        return "Exact-Match Optimized Greedy Strategy (Subgroup Elimination)";
    }

    vector<Transaction> settle(
        const unordered_map<string, Money>& netBalances
    ) override {
        vector<Transaction> settlements;
        vector<BalanceNode> debtors;
        vector<BalanceNode> creditors;

        for (const auto& [name, balance] : netBalances) {
            if (balance.isNegative()) {
                debtors.push_back({name, balance.abs()});
            } else if (balance.isPositive()) {
                creditors.push_back({name, balance});
            }
        }

        // Pass 1: Greedily eliminate exact bilateral matches (Debtor.amount == Creditor.amount)
        for (auto dIt = debtors.begin(); dIt != debtors.end(); ) {
            bool matched = false;
            for (auto cIt = creditors.begin(); cIt != creditors.end(); ++cIt) {
                if (dIt->balance == cIt->balance) {
                    settlements.emplace_back(dIt->name, cIt->name, dIt->balance, "Exact balance match");
                    creditors.erase(cIt);
                    dIt = debtors.erase(dIt);
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                ++dIt;
            }
        }

        // Pass 2: Fall back to Max-Heap greedy resolution for remaining balances
        priority_queue<BalanceNode> dHeap(debtors.begin(), debtors.end());
        priority_queue<BalanceNode> cHeap(creditors.begin(), creditors.end());

        while (!dHeap.empty() && !cHeap.empty()) {
            auto debtor = dHeap.top();
            dHeap.pop();

            auto creditor = cHeap.top();
            cHeap.pop();

            Money settled = min(debtor.balance, creditor.balance);
            settlements.emplace_back(debtor.name, creditor.name, settled, "Greedy balance netting");

            if (debtor.balance > settled) {
                dHeap.push({debtor.name, debtor.balance - settled});
            }
            if (creditor.balance > settled) {
                cHeap.push({creditor.name, creditor.balance - settled});
            }
        }

        return settlements;
    }
};

// ==============================================================================
// 5. SETTLEMENT REPORT (Presentation & Encapsulation)
// ==============================================================================

class SettlementReport {
private:
    string strategyName;
    vector<Transaction> rawTransactions;
    vector<Transaction> settlementPlan;
    unordered_map<string, Money> netBalances;
    Money rawTotalVolume;
    Money settledTotalVolume;

public:
    SettlementReport(
        string strategy,
        vector<Transaction> raw,
        vector<Transaction> plan,
        unordered_map<string, Money> balances
    ) : strategyName(std::move(strategy)),
        rawTransactions(std::move(raw)),
        settlementPlan(std::move(plan)),
        netBalances(std::move(balances)),
        rawTotalVolume(0),
        settledTotalVolume(0) {
        
        for (const auto& tx : rawTransactions) rawTotalVolume += tx.getAmount();
        for (const auto& tx : settlementPlan) settledTotalVolume += tx.getAmount();
    }

    void display() const {
        cout << "\n======================================================================\n";
        cout << "  SETTLEUP - OOPS DEBT SETTLEMENT REPORT\n";
        cout << "  Active Strategy: " << strategyName << "\n";
        cout << "======================================================================\n";

        // 1. Raw Pairwise Transfers
        cout << "\n[1] Initial Raw Transactions (" << rawTransactions.size() << " transfers):\n";
        cout << "----------------------------------------------------------------------\n";
        for (size_t i = 0; i < rawTransactions.size(); ++i) {
            cout << "  " << (i + 1) << ". " << left << setw(12) << rawTransactions[i].getDebtor()
                      << " owes " << left << setw(12) << rawTransactions[i].getCreditor()
                      << " : " << right << setw(10) << rawTransactions[i].getAmount() << "\n";
        }

        // 2. Reduced Net Balances (O(V) Scalar Ledger)
        cout << "\n[2] Reduced Net Balances (O(V) Scalar Ledger):\n";
        cout << "----------------------------------------------------------------------\n";
        vector<pair<string, Money>> sortedBalances(netBalances.begin(), netBalances.end());
        sort(sortedBalances.begin(), sortedBalances.end());

        for (const auto& [name, balance] : sortedBalances) {
            string status;
            if (balance.isPositive()) status = "[CREDITOR: Receives]";
            else if (balance.isNegative()) status = "[DEBTOR  : Pays    ]";
            else status = "[SETTLED : Balanced]";

            cout << "  * " << left << setw(14) << name 
                      << left << setw(22) << status 
                      << right << setw(10) << balance << "\n";
        }

        // 3. Optimal Settlement Plan
        cout << "\n[3] Optimal Simplified Settlement Plan (" << settlementPlan.size() << " transfers):\n";
        cout << "----------------------------------------------------------------------\n";
        for (size_t i = 0; i < settlementPlan.size(); ++i) {
            cout << "  Step " << (i + 1) << ": " << settlementPlan[i] << "\n";
        }

        // 4. Algorithmic Efficiency Metrics
        int rawCount = static_cast<int>(rawTransactions.size());
        int planCount = static_cast<int>(settlementPlan.size());
        int savedTx = rawCount - planCount;
        double pctTx = rawCount > 0 ? (static_cast<double>(savedTx) / rawCount) * 100.0 : 0.0;

        long long rawC = rawTotalVolume.getCents();
        long long settledC = settledTotalVolume.getCents();
        long long savedC = rawC - settledC;
        double pctCash = rawC > 0 ? (static_cast<double>(savedC) / rawC) * 100.0 : 0.0;

        cout << "\n[4] Algorithmic Efficiency Metrics:\n";
        cout << "----------------------------------------------------------------------\n";
        cout << "  * Transactions Required : " << planCount << " (reduced from " << rawCount 
                  << ", -" << fixed << setprecision(1) << pctTx << "%)\n";
        cout << "  * Total Cash in Motion  : " << settledTotalVolume 
                  << " (reduced from " << rawTotalVolume 
                  << ", -" << fixed << setprecision(1) << pctCash << "% cash drag)\n";
        cout << "  * Invariant Assertion   : EXACT ZERO-SUM CONSERVED ($0.00 drift)\n";
        cout << "======================================================================\n\n";
    }

    string toJson() const {
        ostringstream oss;
        oss << "{\"success\":true,\"engine\":\"C++ Native OOP Engine (v1.0)\",";
        oss << "\"strategy\":\"" << strategyName << "\",";
        oss << "\"settlement\":[";
        for (size_t i = 0; i < settlementPlan.size(); ++i) {
            if (i > 0) oss << ",";
            oss << "{\"from\":\"" << settlementPlan[i].getDebtor() << "\","
                << "\"to\":\"" << settlementPlan[i].getCreditor() << "\","
                << "\"amount\":" << settlementPlan[i].getAmount().getCents() << ","
                << "\"description\":\"" << settlementPlan[i].getDescription() << "\"}";
        }
        oss << "],\"metrics\":{";
        oss << "\"rawCount\":" << rawTransactions.size() << ",";
        oss << "\"settledCount\":" << settlementPlan.size() << ",";
        oss << "\"rawVolume\":" << rawTotalVolume.getCents() << ",";
        oss << "\"settledVolume\":" << settledTotalVolume.getCents() << "}}";
        return oss.str();
    }
};

// ==============================================================================
// 6. CONTEXT & FACADE: SettleUpGroup (Encapsulation, Aggregation & Strategy Pattern)
// ==============================================================================

class SettleUpGroup {
private:
    string groupName;
    string baseCurrency;
    unordered_set<string> members;
    vector<Transaction> transactions;
    unique_ptr<ISettlementStrategy> strategy; // Strategy Pattern (Polymorphism via pointer)

public:
    explicit SettleUpGroup(string name, string currency = "USD")
        : groupName(std::move(name)), 
          baseCurrency(std::move(currency)), 
          strategy(make_unique<GreedyHeapStrategy>()) {}

    // Dynamic Strategy Injection (Strategy Pattern)
    void setStrategy(unique_ptr<ISettlementStrategy> newStrategy) {
        if (!newStrategy) throw invalid_argument("Strategy cannot be null.");
        strategy = std::move(newStrategy);
    }

    void addMember(const string& memberName) {
        members.insert(memberName);
    }

    void recordTransaction(const string& from, const string& to, Money amount, const string& desc = "") {
        members.insert(from);
        members.insert(to);
        transactions.emplace_back(from, to, amount, desc);
    }

    // Step 1: Calculate Net Balances in O(E)
    unordered_map<string, Money> calculateNetBalances() const {
        unordered_map<string, Money> balances;
        for (const auto& m : members) {
            balances[m] = Money(0, baseCurrency);
        }

        for (const auto& tx : transactions) {
            balances[tx.getDebtor()] -= tx.getAmount();
            balances[tx.getCreditor()] += tx.getAmount();
        }

        // Step 2: Conservation of Money Verification
        long long netSum = 0;
        for (const auto& [name, bal] : balances) {
            netSum += bal.getCents();
        }

        if (netSum != 0) {
            throw ConservationViolationException(netSum);
        }

        return balances;
    }

    // Solves the debt graph using currently active polymorphic strategy
    SettlementReport generateSettlementPlan() const {
        auto netBalances = calculateNetBalances();
        auto plan = strategy->settle(netBalances);
        return SettlementReport(strategy->getStrategyName(), transactions, plan, netBalances);
    }

    const string& getGroupName() const noexcept { return groupName; }
    size_t getMemberCount() const noexcept { return members.size(); }
    size_t getTransactionCount() const noexcept { return transactions.size(); }
};

// ==============================================================================
// 7. CLI APPLICATION & DEMONSTRATION RUNNER
// ==============================================================================

void runOOPDemo() {
    cout << "\n>>> Running SettleUp Object-Oriented Architecture Demo <<<\n";

    // Instantiate SettleUp Group (Encapsulation)
    SettleUpGroup skiTrip("Alps Ski Trip 2026", "USD");

    // Record multi-party transactions
    skiTrip.recordTransaction("Rehan",   "Pulkit",  Money::fromDollars(30.00), "Chalet groceries");
    skiTrip.recordTransaction("Pulkit",  "Arnav",   Money::fromDollars(40.00), "Snowboard rental");
    skiTrip.recordTransaction("Arnav",   "Rehan",   Money::fromDollars(20.00), "Dinner contribution");
    skiTrip.recordTransaction("David",   "Pulkit",  Money::fromDollars(25.00), "Gasoline split");
    skiTrip.recordTransaction("Arnav",   "Emma",    Money::fromDollars(35.00), "Lift pass share");
    skiTrip.recordTransaction("Rehan",   "Emma",    Money::fromDollars(15.00), "Thermal wear");

    // 1. Solve using Strategy 1 (GreedyHeapStrategy)
    cout << "\n[Demonstrating Strategy 1: Greedy Max-Heap Strategy]";
    skiTrip.setStrategy(make_unique<GreedyHeapStrategy>());
    SettlementReport report1 = skiTrip.generateSettlementPlan();
    report1.display();

    // 2. Solve using Strategy 2 (ExactMatchGreedyStrategy - Polymorphic swap)
    cout << "\n[Demonstrating Strategy 2: Exact-Match Optimized Strategy (Polymorphic Swap)]";
    skiTrip.setStrategy(make_unique<ExactMatchGreedyStrategy>());
    SettlementReport report2 = skiTrip.generateSettlementPlan();
    report2.display();
}

void runInteractiveCLI() {
    cout << "============================================================\n";
    cout << "  SettleUp OOP Interactive CLI (C++ Class Engine)\n";
    cout << "============================================================\n";

    string groupName;
    cout << "Enter Group Name: ";
    getline(cin >> ws, groupName);

    SettleUpGroup group(groupName, "USD");

    cout << "\nChoose Settlement Strategy:\n";
    cout << "1. Greedy Max-Heap Strategy (Standard O(N log N))\n";
    cout << "2. Exact-Match Optimized Greedy Strategy\n";
    cout << "Selection (1 or 2): ";
    int stratChoice = 1;
    cin >> stratChoice;

    if (stratChoice == 2) {
        group.setStrategy(make_unique<ExactMatchGreedyStrategy>());
    } else {
        group.setStrategy(make_unique<GreedyHeapStrategy>());
    }

    cout << "\nEnter number of pairwise debts: ";
    int count = 0;
    if (!(cin >> count) || count <= 0) {
        cout << "Invalid count. Exiting.\n";
        return;
    }

    cout << "\nEnter transactions in format: <Debtor> <Creditor> <AmountInDollars>\n";
    cout << "Example: Rehan Pulkit 30.50\n\n";

    for (int i = 0; i < count; ++i) {
        string debtor, creditor;
        double amount;
        cout << "Debt #" << (i + 1) << ": ";
        cin >> debtor >> creditor >> amount;
        try {
            group.recordTransaction(debtor, creditor, Money::fromDollars(amount));
        } catch (const SettleUpException& ex) {
            cerr << "Validation Error: " << ex.what() << ". Skipping.\n";
        }
    }

    try {
        SettlementReport report = group.generateSettlementPlan();
        report.display();
    } catch (const SettleUpException& ex) {
        cerr << "Execution Error: " << ex.what() << "\n";
    }
}

// ==============================================================================
// 8. JSON BRIDGE FOR NEXT.JS / NODE.JS INTEROPERABILITY
// ==============================================================================

static string extractJsonString(const string& obj, const string& key) {
    string pattern = "\"" + key + "\"";
    size_t keyPos = obj.find(pattern);
    if (keyPos == string::npos) return "";
    size_t colonPos = obj.find(':', keyPos + pattern.length());
    if (colonPos == string::npos) return "";
    size_t quoteStart = obj.find('"', colonPos + 1);
    if (quoteStart == string::npos) return "";
    size_t quoteEnd = obj.find('"', quoteStart + 1);
    if (quoteEnd == string::npos) return "";
    return obj.substr(quoteStart + 1, quoteEnd - quoteStart - 1);
}

static long long extractJsonNumber(const string& obj, const string& key) {
    string pattern = "\"" + key + "\"";
    size_t keyPos = obj.find(pattern);
    if (keyPos == string::npos) return 0;
    size_t colonPos = obj.find(':', keyPos + pattern.length());
    if (colonPos == string::npos) return 0;
    size_t numStart = obj.find_first_of("0123456789-", colonPos + 1);
    if (numStart == string::npos) return 0;
    size_t numEnd = obj.find_first_not_of("0123456789", numStart + (obj[numStart] == '-' ? 1 : 0));
    string numStr = obj.substr(numStart, numEnd - numStart);
    try {
        return stoll(numStr);
    } catch (...) {
        return 0;
    }
}

void runJsonMode() {
    string input((istreambuf_iterator<char>(cin)),
                       istreambuf_iterator<char>());

    if (input.empty()) {
        cout << "{\"success\":false,\"error\":\"Empty JSON input\"}\n";
        return;
    }

    string strategyName = extractJsonString(input, "strategy");
    if (strategyName.empty()) strategyName = "greedy";

    SettleUpGroup group("API Group", "USD");
    if (strategyName == "exact") {
        group.setStrategy(make_unique<ExactMatchGreedyStrategy>());
    } else {
        group.setStrategy(make_unique<GreedyHeapStrategy>());
    }

    size_t debtsPos = input.find("\"debts\"");
    if (debtsPos != string::npos) {
        size_t arrayStart = input.find('[', debtsPos);
        size_t arrayEnd = input.find(']', arrayStart);
        if (arrayStart != string::npos && arrayEnd != string::npos) {
            size_t cursor = arrayStart;
            while (cursor < arrayEnd) {
                size_t objStart = input.find('{', cursor);
                if (objStart == string::npos || objStart >= arrayEnd) break;
                size_t objEnd = input.find('}', objStart);
                if (objEnd == string::npos || objEnd > arrayEnd) break;

                string debtObj = input.substr(objStart, objEnd - objStart + 1);
                string from = extractJsonString(debtObj, "from");
                string to = extractJsonString(debtObj, "to");
                long long amount = extractJsonNumber(debtObj, "amount");

                if (!from.empty() && !to.empty() && amount > 0) {
                    try {
                        group.recordTransaction(from, to, Money(amount));
                    } catch (...) {}
                }
                cursor = objEnd + 1;
            }
        }
    }

    try {
        SettlementReport report = group.generateSettlementPlan();
        cout << report.toJson() << "\n";
    } catch (const exception& ex) {
        cout << "{\"success\":false,\"error\":\"" << ex.what() << "\"}\n";
    }
}

int main(int argc, char* argv[]) {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    try {
        if (argc > 1 && string(argv[1]) == "--json") {
            runJsonMode();
        } else if (argc > 1 && string(argv[1]) == "--demo") {
            runOOPDemo();
        } else {
            cout << "Choose Mode:\n";
            cout << "1. Run Complete OOP Project Showcase Demo\n";
            cout << "2. Interactive Input\n";
            cout << "Selection (1 or 2): ";
            int choice = 1;
            if (cin >> choice && choice == 2) {
                runInteractiveCLI();
            } else {
                runOOPDemo();
            }
        }
    } catch (const exception& ex) {
        cerr << "Fatal Error: " << ex.what() << endl;
        return 1;
    }

    return 0;
}
