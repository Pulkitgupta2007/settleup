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
 *    - Custom domain exception hierarchy deriving from `std::exception`.
 * 
 * 4. POLYMORPHISM:
 *    - Runtime Polymorphism: Dynamic strategy dispatch via `std::unique_ptr<ISettlementStrategy>`.
 *    - Compile-time Polymorphism: Operator overloading (`<<`, `+`, `-`, `<`, `==`).
 * 
 * 5. DESIGN PATTERNS:
 *    - Strategy Pattern: `SettlementContext` allows hot-swapping settlement heuristics.
 *    - Value Object Pattern: `Money` encapsulates integer-cent currency representations.
 *    - RAII: Modern smart pointers (`std::unique_ptr`, `std::shared_ptr`) with zero leaks.
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

// ==============================================================================
// 1. CUSTOM EXCEPTION HIERARCHY (Inheritance & Polymorphism)
// ==============================================================================

class SettleUpException : public std::exception {
protected:
    std::string message;
public:
    explicit SettleUpException(std::string msg) : message(std::move(msg)) {}
    const char* what() const noexcept override {
        return message.c_str();
    }
};

class ConservationViolationException : public SettleUpException {
public:
    explicit ConservationViolationException(long long netSum)
        : SettleUpException("Conservation of Money Invariant Violated: Net balance sum is " 
                            + std::to_string(netSum) + " cents (expected 0).") {}
};

class InvalidTransactionException : public SettleUpException {
public:
    explicit InvalidTransactionException(const std::string& reason)
        : SettleUpException("Invalid Transaction: " + reason) {}
};

// ==============================================================================
// 2. VALUE OBJECT: Money (Encapsulation & Operator Overloading)
// ==============================================================================

class Money {
private:
    long long cents; // Fixed-point integer cents (Prevents floating-point drift)
    std::string currency;

public:
    explicit Money(long long cents = 0, std::string currency = "USD")
        : cents(cents), currency(std::move(currency)) {}

    // Factory method from dollars
    static Money fromDollars(double dollars, const std::string& currency = "USD") {
        long long c = static_cast<long long>(std::round(dollars * 100.0));
        return Money(c, currency);
    }

    // Getters (Encapsulation)
    long long getCents() const noexcept { return cents; }
    const std::string& getCurrency() const noexcept { return currency; }
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
    friend std::ostream& operator<<(std::ostream& os, const Money& m) {
        bool neg = m.cents < 0;
        long long absC = std::abs(m.cents);
        long long dollars = absC / 100;
        long long rem = absC % 100;

        if (neg) os << "-";
        if (m.currency == "USD") os << "$";
        else os << m.currency << " ";

        os << dollars << "." << std::setfill('0') << std::setw(2) << rem << std::setfill(' ');
        return os;
    }
};

// ==============================================================================
// 3. DOMAIN ENTITIES: Participant & Transaction (Encapsulation)
// ==============================================================================

class Participant {
private:
    std::string id;
    std::string name;

public:
    Participant(std::string id, std::string name)
        : id(std::move(id)), name(std::move(name)) {}

    const std::string& getId() const noexcept { return id; }
    const std::string& getName() const noexcept { return name; }

    bool operator==(const Participant& other) const noexcept {
        return id == other.id;
    }
};

class Transaction {
private:
    std::string debtor;   // Person who pays
    std::string creditor; // Person who receives
    Money amount;
    std::string description;

public:
    Transaction(std::string from, std::string to, Money amt, std::string desc = "")
        : debtor(std::move(from)), creditor(std::move(to)), amount(amt), description(std::move(desc)) {
        if (debtor == creditor) {
            throw InvalidTransactionException("Debtor and creditor cannot be the same person: " + debtor);
        }
        if (amount.getCents() <= 0) {
            throw InvalidTransactionException("Transaction amount must be strictly positive.");
        }
    }

    const std::string& getDebtor() const noexcept { return debtor; }
    const std::string& getCreditor() const noexcept { return creditor; }
    const Money& getAmount() const noexcept { return amount; }
    const std::string& getDescription() const noexcept { return description; }

    friend std::ostream& operator<<(std::ostream& os, const Transaction& t) {
        os << std::left << std::setw(12) << t.debtor 
           << " pays " << std::left << std::setw(12) << t.creditor 
           << " -> " << std::right << std::setw(10) << t.amount;
        if (!t.description.empty()) {
            os << " (" << t.description << ")";
        }
        return os;
    }
};

// Priority Queue Entry for Heap-based greedy netting
struct BalanceNode {
    std::string name;
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
    virtual std::vector<Transaction> settle(
        const std::unordered_map<std::string, Money>& netBalances
    ) = 0;

    virtual std::string getStrategyName() const = 0;
};

/**
 * Concrete Strategy 1: Greedy Max-Heap Settlement Strategy
 * Matches maximum debtor with maximum creditor in O(N log N) time.
 */
class GreedyHeapStrategy : public ISettlementStrategy {
public:
    std::string getStrategyName() const override {
        return "Greedy Max-Heap Cash-Flow Minimization (Standard O(N log N))";
    }

    std::vector<Transaction> settle(
        const std::unordered_map<std::string, Money>& netBalances
    ) override {
        std::vector<Transaction> settlements;
        std::priority_queue<BalanceNode> debtors;
        std::priority_queue<BalanceNode> creditors;

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

            Money settled = std::min(debtor.balance, creditor.balance);
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
    std::string getStrategyName() const override {
        return "Exact-Match Optimized Greedy Strategy (Subgroup Elimination)";
    }

    std::vector<Transaction> settle(
        const std::unordered_map<std::string, Money>& netBalances
    ) override {
        std::vector<Transaction> settlements;
        std::vector<BalanceNode> debtors;
        std::vector<BalanceNode> creditors;

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
        std::priority_queue<BalanceNode> dHeap(debtors.begin(), debtors.end());
        std::priority_queue<BalanceNode> cHeap(creditors.begin(), creditors.end());

        while (!dHeap.empty() && !cHeap.empty()) {
            auto debtor = dHeap.top();
            dHeap.pop();

            auto creditor = cHeap.top();
            cHeap.pop();

            Money settled = std::min(debtor.balance, creditor.balance);
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
    std::string strategyName;
    std::vector<Transaction> rawTransactions;
    std::vector<Transaction> settlementPlan;
    std::unordered_map<std::string, Money> netBalances;
    Money rawTotalVolume;
    Money settledTotalVolume;

public:
    SettlementReport(
        std::string strategy,
        std::vector<Transaction> raw,
        std::vector<Transaction> plan,
        std::unordered_map<std::string, Money> balances
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
        std::cout << "\n======================================================================\n";
        std::cout << "  SETTLEUP - OOPS DEBT SETTLEMENT REPORT\n";
        std::cout << "  Active Strategy: " << strategyName << "\n";
        std::cout << "======================================================================\n";

        // 1. Raw Pairwise Transfers
        std::cout << "\n[1] Initial Raw Transactions (" << rawTransactions.size() << " transfers):\n";
        std::cout << "----------------------------------------------------------------------\n";
        for (size_t i = 0; i < rawTransactions.size(); ++i) {
            std::cout << "  " << (i + 1) << ". " << std::left << std::setw(12) << rawTransactions[i].getDebtor()
                      << " owes " << std::left << std::setw(12) << rawTransactions[i].getCreditor()
                      << " : " << std::right << std::setw(10) << rawTransactions[i].getAmount() << "\n";
        }

        // 2. Reduced Net Balances (O(V) Scalar Ledger)
        std::cout << "\n[2] Reduced Net Balances (O(V) Scalar Ledger):\n";
        std::cout << "----------------------------------------------------------------------\n";
        std::vector<std::pair<std::string, Money>> sortedBalances(netBalances.begin(), netBalances.end());
        std::sort(sortedBalances.begin(), sortedBalances.end());

        for (const auto& [name, balance] : sortedBalances) {
            std::string status;
            if (balance.isPositive()) status = "[CREDITOR: Receives]";
            else if (balance.isNegative()) status = "[DEBTOR  : Pays    ]";
            else status = "[SETTLED : Balanced]";

            std::cout << "  * " << std::left << std::setw(14) << name 
                      << std::left << std::setw(22) << status 
                      << std::right << std::setw(10) << balance << "\n";
        }

        // 3. Optimal Settlement Plan
        std::cout << "\n[3] Optimal Simplified Settlement Plan (" << settlementPlan.size() << " transfers):\n";
        std::cout << "----------------------------------------------------------------------\n";
        for (size_t i = 0; i < settlementPlan.size(); ++i) {
            std::cout << "  Step " << (i + 1) << ": " << settlementPlan[i] << "\n";
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

        std::cout << "\n[4] Algorithmic Efficiency Metrics:\n";
        std::cout << "----------------------------------------------------------------------\n";
        std::cout << "  * Transactions Required : " << planCount << " (reduced from " << rawCount 
                  << ", -" << std::fixed << std::setprecision(1) << pctTx << "%)\n";
        std::cout << "  * Total Cash in Motion  : " << settledTotalVolume 
                  << " (reduced from " << rawTotalVolume 
                  << ", -" << std::fixed << std::setprecision(1) << pctCash << "% cash drag)\n";
        std::cout << "  * Invariant Assertion   : EXACT ZERO-SUM CONSERVED ($0.00 drift)\n";
        std::cout << "======================================================================\n\n";
    }

    std::string toJson() const {
        std::ostringstream oss;
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
    std::string groupName;
    std::string baseCurrency;
    std::unordered_set<std::string> members;
    std::vector<Transaction> transactions;
    std::unique_ptr<ISettlementStrategy> strategy; // Strategy Pattern (Polymorphism via pointer)

public:
    explicit SettleUpGroup(std::string name, std::string currency = "USD")
        : groupName(std::move(name)), 
          baseCurrency(std::move(currency)), 
          strategy(std::make_unique<GreedyHeapStrategy>()) {}

    // Dynamic Strategy Injection (Strategy Pattern)
    void setStrategy(std::unique_ptr<ISettlementStrategy> newStrategy) {
        if (!newStrategy) throw std::invalid_argument("Strategy cannot be null.");
        strategy = std::move(newStrategy);
    }

    void addMember(const std::string& memberName) {
        members.insert(memberName);
    }

    void recordTransaction(const std::string& from, const std::string& to, Money amount, const std::string& desc = "") {
        members.insert(from);
        members.insert(to);
        transactions.emplace_back(from, to, amount, desc);
    }

    // Step 1: Calculate Net Balances in O(E)
    std::unordered_map<std::string, Money> calculateNetBalances() const {
        std::unordered_map<std::string, Money> balances;
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

    const std::string& getGroupName() const noexcept { return groupName; }
    size_t getMemberCount() const noexcept { return members.size(); }
    size_t getTransactionCount() const noexcept { return transactions.size(); }
};

// ==============================================================================
// 7. CLI APPLICATION & DEMONSTRATION RUNNER
// ==============================================================================

void runOOPDemo() {
    std::cout << "\n>>> Running SettleUp Object-Oriented Architecture Demo <<<\n";

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
    std::cout << "\n[Demonstrating Strategy 1: Greedy Max-Heap Strategy]";
    skiTrip.setStrategy(std::make_unique<GreedyHeapStrategy>());
    SettlementReport report1 = skiTrip.generateSettlementPlan();
    report1.display();

    // 2. Solve using Strategy 2 (ExactMatchGreedyStrategy - Polymorphic swap)
    std::cout << "\n[Demonstrating Strategy 2: Exact-Match Optimized Strategy (Polymorphic Swap)]";
    skiTrip.setStrategy(std::make_unique<ExactMatchGreedyStrategy>());
    SettlementReport report2 = skiTrip.generateSettlementPlan();
    report2.display();
}

void runInteractiveCLI() {
    std::cout << "============================================================\n";
    std::cout << "  SettleUp OOP Interactive CLI (C++ Class Engine)\n";
    std::cout << "============================================================\n";

    std::string groupName;
    std::cout << "Enter Group Name: ";
    std::getline(std::cin >> std::ws, groupName);

    SettleUpGroup group(groupName, "USD");

    std::cout << "\nChoose Settlement Strategy:\n";
    std::cout << "1. Greedy Max-Heap Strategy (Standard O(N log N))\n";
    std::cout << "2. Exact-Match Optimized Greedy Strategy\n";
    std::cout << "Selection (1 or 2): ";
    int stratChoice = 1;
    std::cin >> stratChoice;

    if (stratChoice == 2) {
        group.setStrategy(std::make_unique<ExactMatchGreedyStrategy>());
    } else {
        group.setStrategy(std::make_unique<GreedyHeapStrategy>());
    }

    std::cout << "\nEnter number of pairwise debts: ";
    int count = 0;
    if (!(std::cin >> count) || count <= 0) {
        std::cout << "Invalid count. Exiting.\n";
        return;
    }

    std::cout << "\nEnter transactions in format: <Debtor> <Creditor> <AmountInDollars>\n";
    std::cout << "Example: Rehan Pulkit 30.50\n\n";

    for (int i = 0; i < count; ++i) {
        std::string debtor, creditor;
        double amount;
        std::cout << "Debt #" << (i + 1) << ": ";
        std::cin >> debtor >> creditor >> amount;
        try {
            group.recordTransaction(debtor, creditor, Money::fromDollars(amount));
        } catch (const SettleUpException& ex) {
            std::cerr << "Validation Error: " << ex.what() << ". Skipping.\n";
        }
    }

    try {
        SettlementReport report = group.generateSettlementPlan();
        report.display();
    } catch (const SettleUpException& ex) {
        std::cerr << "Execution Error: " << ex.what() << "\n";
    }
}

// ==============================================================================
// 8. JSON BRIDGE FOR NEXT.JS / NODE.JS INTEROPERABILITY
// ==============================================================================

static std::string extractJsonString(const std::string& obj, const std::string& key) {
    std::string pattern = "\"" + key + "\"";
    size_t keyPos = obj.find(pattern);
    if (keyPos == std::string::npos) return "";
    size_t colonPos = obj.find(':', keyPos + pattern.length());
    if (colonPos == std::string::npos) return "";
    size_t quoteStart = obj.find('"', colonPos + 1);
    if (quoteStart == std::string::npos) return "";
    size_t quoteEnd = obj.find('"', quoteStart + 1);
    if (quoteEnd == std::string::npos) return "";
    return obj.substr(quoteStart + 1, quoteEnd - quoteStart - 1);
}

static long long extractJsonNumber(const std::string& obj, const std::string& key) {
    std::string pattern = "\"" + key + "\"";
    size_t keyPos = obj.find(pattern);
    if (keyPos == std::string::npos) return 0;
    size_t colonPos = obj.find(':', keyPos + pattern.length());
    if (colonPos == std::string::npos) return 0;
    size_t numStart = obj.find_first_of("0123456789-", colonPos + 1);
    if (numStart == std::string::npos) return 0;
    size_t numEnd = obj.find_first_not_of("0123456789", numStart + (obj[numStart] == '-' ? 1 : 0));
    std::string numStr = obj.substr(numStart, numEnd - numStart);
    try {
        return std::stoll(numStr);
    } catch (...) {
        return 0;
    }
}

void runJsonMode() {
    std::string input((std::istreambuf_iterator<char>(std::cin)),
                       std::istreambuf_iterator<char>());

    if (input.empty()) {
        std::cout << "{\"success\":false,\"error\":\"Empty JSON input\"}\n";
        return;
    }

    std::string strategyName = extractJsonString(input, "strategy");
    if (strategyName.empty()) strategyName = "greedy";

    SettleUpGroup group("API Group", "USD");
    if (strategyName == "exact") {
        group.setStrategy(std::make_unique<ExactMatchGreedyStrategy>());
    } else {
        group.setStrategy(std::make_unique<GreedyHeapStrategy>());
    }

    size_t debtsPos = input.find("\"debts\"");
    if (debtsPos != std::string::npos) {
        size_t arrayStart = input.find('[', debtsPos);
        size_t arrayEnd = input.find(']', arrayStart);
        if (arrayStart != std::string::npos && arrayEnd != std::string::npos) {
            size_t cursor = arrayStart;
            while (cursor < arrayEnd) {
                size_t objStart = input.find('{', cursor);
                if (objStart == std::string::npos || objStart >= arrayEnd) break;
                size_t objEnd = input.find('}', objStart);
                if (objEnd == std::string::npos || objEnd > arrayEnd) break;

                std::string debtObj = input.substr(objStart, objEnd - objStart + 1);
                std::string from = extractJsonString(debtObj, "from");
                std::string to = extractJsonString(debtObj, "to");
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
        std::cout << report.toJson() << "\n";
    } catch (const std::exception& ex) {
        std::cout << "{\"success\":false,\"error\":\"" << ex.what() << "\"}\n";
    }
}

int main(int argc, char* argv[]) {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    try {
        if (argc > 1 && std::string(argv[1]) == "--json") {
            runJsonMode();
        } else if (argc > 1 && std::string(argv[1]) == "--demo") {
            runOOPDemo();
        } else {
            std::cout << "Choose Mode:\n";
            std::cout << "1. Run Complete OOP Project Showcase Demo\n";
            std::cout << "2. Interactive Input\n";
            std::cout << "Selection (1 or 2): ";
            int choice = 1;
            if (std::cin >> choice && choice == 2) {
                runInteractiveCLI();
            } else {
                runOOPDemo();
            }
        }
    } catch (const std::exception& ex) {
        std::cerr << "Fatal Error: " << ex.what() << std::endl;
        return 1;
    }

    return 0;
}
