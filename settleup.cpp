/**
 * SettleUp - Multi-Party Debt Netting Engine (C++)
 *
 * Implements greedy max-heap and exact-match settlement strategies
 * with an append-safe integer-cent money representation.
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

// Domain Exception
class SettleUpException : public exception {
protected:
    string message;
public:
    explicit SettleUpException(string msg) : message(std::move(msg)) {}
    const char* what() const noexcept override { return message.c_str(); }
};

// Value Object: Money (integer cents prevents floating-point drift)
class Money {
private:
    long long cents;
    string currency;

public:
    explicit Money(long long cents = 0, string currency = "USD")
        : cents(cents), currency(std::move(currency)) {}

    static Money fromDollars(double dollars, const string& currency = "USD") {
        return Money(static_cast<long long>(round(dollars * 100.0)), currency);
    }

    long long getCents() const noexcept { return cents; }
    bool isPositive() const noexcept { return cents > 0; }
    bool isNegative() const noexcept { return cents < 0; }
    Money abs() const { return Money(std::abs(cents), currency); }

    Money operator-(const Money& other) const { return Money(cents - other.cents, currency); }
    Money& operator+=(const Money& other) { cents += other.cents; return *this; }
    Money& operator-=(const Money& other) { cents -= other.cents; return *this; }
    bool operator<(const Money& other) const noexcept { return cents < other.cents; }
    bool operator>(const Money& other) const noexcept { return cents > other.cents; }
    bool operator==(const Money& other) const noexcept { return cents == other.cents; }
    bool operator!=(const Money& other) const noexcept { return cents != other.cents; }

    friend ostream& operator<<(ostream& os, const Money& m) {
        long long absC = std::abs(m.cents);
        if (m.cents < 0) os << "-";
        if (m.currency == "USD") os << "$";
        else os << m.currency << " ";
        os << (absC / 100) << "." << setfill('0') << setw(2) << (absC % 100) << setfill(' ');
        return os;
    }
};

// Value Object: Transaction
struct Transaction {
    string debtor;
    string creditor;
    Money amount;
    string description;

    Transaction(string from, string to, Money amt, string desc = "")
        : debtor(std::move(from)), creditor(std::move(to)), amount(amt), description(std::move(desc)) {
        if (debtor == creditor) {
            throw SettleUpException("Debtor and creditor cannot be the same person: " + debtor);
        }
        if (amount.getCents() <= 0) {
            throw SettleUpException("Transaction amount must be strictly positive.");
        }
    }

    friend ostream& operator<<(ostream& os, const Transaction& t) {
        os << left << setw(12) << t.debtor 
           << " pays " << left << setw(12) << t.creditor 
           << " -> " << right << setw(10) << t.amount;
        if (!t.description.empty()) os << " (" << t.description << ")";
        return os;
    }
};

struct BalanceNode {
    string name;
    Money balance;

    bool operator<(const BalanceNode& other) const {
        if (balance != other.balance) return balance < other.balance;
        return name > other.name;
    }
};

// Common heap-based greedy cash flow resolution
static void resolveGreedyHeap(
    priority_queue<BalanceNode>& debtors,
    priority_queue<BalanceNode>& creditors,
    vector<Transaction>& settlements,
    const string& label
) {
    while (!debtors.empty() && !creditors.empty()) {
        auto debtor = debtors.top();
        debtors.pop();
        auto creditor = creditors.top();
        creditors.pop();

        Money settled = min(debtor.balance, creditor.balance);
        settlements.emplace_back(debtor.name, creditor.name, settled, label);

        if (debtor.balance > settled) {
            debtors.push({debtor.name, debtor.balance - settled});
        }
        if (creditor.balance > settled) {
            creditors.push({creditor.name, creditor.balance - settled});
        }
    }
}

// Strategy Pattern Interface
class ISettlementStrategy {
public:
    virtual ~ISettlementStrategy() = default;
    virtual vector<Transaction> settle(const unordered_map<string, Money>& netBalances) = 0;
    virtual string getStrategyName() const = 0;
};

// Strategy 1: Greedy Max-Heap Strategy (Standard O(N log N))
class GreedyHeapStrategy : public ISettlementStrategy {
public:
    string getStrategyName() const override {
        return "Greedy Max-Heap Cash-Flow Minimization (Standard O(N log N))";
    }

    vector<Transaction> settle(const unordered_map<string, Money>& netBalances) override {
        vector<Transaction> settlements;
        priority_queue<BalanceNode> debtors, creditors;

        for (const auto& [name, balance] : netBalances) {
            if (balance.isNegative()) debtors.push({name, balance.abs()});
            else if (balance.isPositive()) creditors.push({name, balance});
        }

        resolveGreedyHeap(debtors, creditors, settlements, "Greedy cycle netting");
        return settlements;
    }
};

// Strategy 2: Exact-Match Optimized Greedy Strategy
class ExactMatchGreedyStrategy : public ISettlementStrategy {
public:
    string getStrategyName() const override {
        return "Exact-Match Optimized Greedy Strategy (Subgroup Elimination)";
    }

    vector<Transaction> settle(const unordered_map<string, Money>& netBalances) override {
        vector<Transaction> settlements;
        vector<BalanceNode> debtors, creditors;

        for (const auto& [name, balance] : netBalances) {
            if (balance.isNegative()) debtors.push_back({name, balance.abs()});
            else if (balance.isPositive()) creditors.push_back({name, balance});
        }

        // Pass 1: Eliminate exact 1:1 bilateral matches
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
            if (!matched) ++dIt;
        }

        // Pass 2: Heap-based greedy resolution for remaining balances
        priority_queue<BalanceNode> dHeap(debtors.begin(), debtors.end());
        priority_queue<BalanceNode> cHeap(creditors.begin(), creditors.end());
        resolveGreedyHeap(dHeap, cHeap, settlements, "Greedy balance netting");

        return settlements;
    }
};

// Settlement Report & JSON Serializer
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
        for (const auto& tx : rawTransactions) rawTotalVolume += tx.amount;
        for (const auto& tx : settlementPlan) settledTotalVolume += tx.amount;
    }

    void display() const {
        cout << "\n======================================================================\n";
        cout << "  SETTLEUP - OOPS DEBT SETTLEMENT REPORT\n";
        cout << "  Active Strategy: " << strategyName << "\n";
        cout << "======================================================================\n";

        cout << "\n[1] Initial Raw Transactions (" << rawTransactions.size() << " transfers):\n";
        cout << "----------------------------------------------------------------------\n";
        for (size_t i = 0; i < rawTransactions.size(); ++i) {
            cout << "  " << (i + 1) << ". " << left << setw(12) << rawTransactions[i].debtor
                 << " owes " << left << setw(12) << rawTransactions[i].creditor
                 << " : " << right << setw(10) << rawTransactions[i].amount << "\n";
        }

        cout << "\n[2] Reduced Net Balances (O(V) Scalar Ledger):\n";
        cout << "----------------------------------------------------------------------\n";
        vector<pair<string, Money>> sortedBalances(netBalances.begin(), netBalances.end());
        sort(sortedBalances.begin(), sortedBalances.end());

        for (const auto& [name, balance] : sortedBalances) {
            string status = balance.isPositive() ? "[CREDITOR: Receives]" 
                          : balance.isNegative() ? "[DEBTOR  : Pays    ]" 
                          : "[SETTLED : Balanced]";
            cout << "  * " << left << setw(14) << name 
                 << left << setw(22) << status 
                 << right << setw(10) << balance << "\n";
        }

        cout << "\n[3] Optimal Simplified Settlement Plan (" << settlementPlan.size() << " transfers):\n";
        cout << "----------------------------------------------------------------------\n";
        for (size_t i = 0; i < settlementPlan.size(); ++i) {
            cout << "  Step " << (i + 1) << ": " << settlementPlan[i] << "\n";
        }

        int rawCount = static_cast<int>(rawTransactions.size());
        int planCount = static_cast<int>(settlementPlan.size());
        double pctTx = rawCount > 0 ? (static_cast<double>(rawCount - planCount) / rawCount) * 100.0 : 0.0;
        long long savedC = rawTotalVolume.getCents() - settledTotalVolume.getCents();
        double pctCash = rawTotalVolume.getCents() > 0 ? (static_cast<double>(savedC) / rawTotalVolume.getCents()) * 100.0 : 0.0;

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
            oss << "{\"from\":\"" << settlementPlan[i].debtor << "\","
                << "\"to\":\"" << settlementPlan[i].creditor << "\","
                << "\"amount\":" << settlementPlan[i].amount.getCents() << ","
                << "\"description\":\"" << settlementPlan[i].description << "\"}";
        }
        oss << "],\"metrics\":{";
        oss << "\"rawCount\":" << rawTransactions.size() << ",";
        oss << "\"settledCount\":" << settlementPlan.size() << ",";
        oss << "\"rawVolume\":" << rawTotalVolume.getCents() << ",";
        oss << "\"settledVolume\":" << settledTotalVolume.getCents() << "}}";
        return oss.str();
    }
};

// SettleUpGroup Facade
class SettleUpGroup {
private:
    string groupName;
    string baseCurrency;
    unordered_set<string> members;
    vector<Transaction> transactions;
    unique_ptr<ISettlementStrategy> strategy;

public:
    explicit SettleUpGroup(string name, string currency = "USD")
        : groupName(std::move(name)), 
          baseCurrency(std::move(currency)), 
          strategy(make_unique<GreedyHeapStrategy>()) {}

    void setStrategy(unique_ptr<ISettlementStrategy> newStrategy) {
        if (!newStrategy) throw SettleUpException("Strategy cannot be null.");
        strategy = std::move(newStrategy);
    }

    void recordTransaction(const string& from, const string& to, Money amount, const string& desc = "") {
        members.insert(from);
        members.insert(to);
        transactions.emplace_back(from, to, amount, desc);
    }

    unordered_map<string, Money> calculateNetBalances() const {
        unordered_map<string, Money> balances;
        for (const auto& m : members) balances[m] = Money(0, baseCurrency);

        for (const auto& tx : transactions) {
            balances[tx.debtor] -= tx.amount;
            balances[tx.creditor] += tx.amount;
        }

        long long netSum = 0;
        for (const auto& [name, bal] : balances) netSum += bal.getCents();
        if (netSum != 0) {
            throw SettleUpException("Conservation of Money Invariant Violated: Net balance sum is " 
                                    + to_string(netSum) + " cents (expected 0).");
        }
        return balances;
    }

    SettlementReport generateSettlementPlan() const {
        auto netBalances = calculateNetBalances();
        auto plan = strategy->settle(netBalances);
        return SettlementReport(strategy->getStrategyName(), transactions, plan, netBalances);
    }
};

// Interactive CLI and Demos
void runOOPDemo() {
    cout << "\n>>> Running SettleUp Object-Oriented Architecture Demo <<<\n";
    SettleUpGroup skiTrip("Alps Ski Trip 2026", "USD");

    skiTrip.recordTransaction("Rehan",   "Pulkit",  Money::fromDollars(30.00), "Chalet groceries");
    skiTrip.recordTransaction("Pulkit",  "Arnav",   Money::fromDollars(40.00), "Snowboard rental");
    skiTrip.recordTransaction("Arnav",   "Rehan",   Money::fromDollars(20.00), "Dinner contribution");
    skiTrip.recordTransaction("David",   "Pulkit",  Money::fromDollars(25.00), "Gasoline split");
    skiTrip.recordTransaction("Arnav",   "Emma",    Money::fromDollars(35.00), "Lift pass share");
    skiTrip.recordTransaction("Rehan",   "Emma",    Money::fromDollars(15.00), "Thermal wear");

    cout << "\n[Demonstrating Strategy 1: Greedy Max-Heap Strategy]";
    skiTrip.setStrategy(make_unique<GreedyHeapStrategy>());
    skiTrip.generateSettlementPlan().display();

    cout << "\n[Demonstrating Strategy 2: Exact-Match Optimized Strategy (Polymorphic Swap)]";
    skiTrip.setStrategy(make_unique<ExactMatchGreedyStrategy>());
    skiTrip.generateSettlementPlan().display();
}

void runInteractiveCLI() {
    cout << "============================================================\n";
    cout << "  SettleUp OOP Interactive CLI (C++ Engine)\n";
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
        group.generateSettlementPlan().display();
    } catch (const SettleUpException& ex) {
        cerr << "Execution Error: " << ex.what() << "\n";
    }
}

// JSON Bridge for Next.js / Node.js Interoperability
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
    try {
        return stoll(obj.substr(numStart, numEnd - numStart));
    } catch (...) {
        return 0;
    }
}

void runJsonMode() {
    string input((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());
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
        cout << group.generateSettlementPlan().toJson() << "\n";
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
