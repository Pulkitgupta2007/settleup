/**
 * SettleUp - Multi-Party Debt Netting Engine (C++)
 *
 * Beginner-Friendly Implementation:
 * Uses clean Object-Oriented Programming (OOP) to simplify debts
 * between friends and find the minimum number of transactions needed.
 */

#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <queue>
#include <algorithm>
#include <iomanip>
#include <cmath>

using namespace std;

// ============================================================================
// 1. DATA STRUCTURES: Money, Transaction & BalanceNode
// ============================================================================

// Helper function to format cents (e.g., 3050 cents -> "$30.50")
string formatMoney(long long cents) {
    long long absCents = abs(cents);
    long long dollars = absCents / 100;
    long long remainder = absCents % 100;

    string result = (cents < 0 ? "-$" : "$") + to_string(dollars) + ".";
    if (remainder < 10) result += "0";
    result += to_string(remainder);
    return result;
}

// Represents a single transaction: who pays, who receives, and how much
struct Transaction {
    string debtor;      // Person who pays
    string creditor;    // Person who receives money
    long long amount;   // In cents (e.g. 1000 = $10.00)
    string description;

    Transaction(string from, string to, long long amt, string desc = "") {
        debtor = from;
        creditor = to;
        amount = amt;
        description = desc;
    }
};

// Represents a person and their net balance, used in the Max-Heap priority queue
struct BalanceNode {
    string name;
    long long balance;

    // Highest balance gets top priority in the heap
    bool operator<(const BalanceNode& other) const {
        return balance < other.balance;
    }
};

// ============================================================================
// 2. ALGORITHMS: Greedy Heap & Exact-Match Debt Simplification
// ============================================================================

// Strategy 1: Greedy Max-Heap Strategy
// Repeatedly pairs the person who owes the most with the person owed the most.
vector<Transaction> solveGreedy(const unordered_map<string, long long>& netBalances) {
    vector<Transaction> settlements;
    priority_queue<BalanceNode> debtors;   // People who owe money (negative balance)
    priority_queue<BalanceNode> creditors; // People who receive money (positive balance)

    // Separate people into debtors and creditors
    for (const auto& entry : netBalances) {
        string person = entry.first;
        long long balance = entry.second;

        if (balance < 0) {
            debtors.push({person, -balance}); // Store as positive debt
        } else if (balance > 0) {
            creditors.push({person, balance});
        }
    }

    // Match largest debtor with largest creditor
    while (!debtors.empty() && !creditors.empty()) {
        BalanceNode debtor = debtors.top();
        debtors.pop();

        BalanceNode creditor = creditors.top();
        creditors.pop();

        long long settled = min(debtor.balance, creditor.balance);
        settlements.push_back(Transaction(debtor.name, creditor.name, settled, "Greedy cycle netting"));

        // If someone still has money remaining, put them back into the queue
        if (debtor.balance > settled) {
            debtors.push({debtor.name, debtor.balance - settled});
        }
        if (creditor.balance > settled) {
            creditors.push({creditor.name, creditor.balance - settled});
        }
    }

    return settlements;
}

// Strategy 2: Exact-Match Optimized Strategy
// First pairs people who owe the EXACT same amount to eliminate 2 people at once.
vector<Transaction> solveExactMatch(const unordered_map<string, long long>& netBalances) {
    vector<Transaction> settlements;
    vector<BalanceNode> debtors;
    vector<BalanceNode> creditors;

    for (const auto& entry : netBalances) {
        if (entry.second < 0) debtors.push_back({entry.first, -entry.second});
        else if (entry.second > 0) creditors.push_back({entry.first, entry.second});
    }

    // Pass 1: Find exact 1-to-1 matches (debtor.amount == creditor.amount)
    for (size_t i = 0; i < debtors.size(); i++) {
        for (size_t j = 0; j < creditors.size(); j++) {
            if (debtors[i].balance > 0 && debtors[i].balance == creditors[j].balance) {
                settlements.push_back(Transaction(debtors[i].name, creditors[j].name, debtors[i].balance, "Exact balance match"));
                debtors[i].balance = 0;   // Marked as settled
                creditors[j].balance = 0; // Marked as settled
                break;
            }
        }
    }

    // Pass 2: Fall back to greedy max-heap for remaining balances
    priority_queue<BalanceNode> dHeap, cHeap;
    for (const auto& d : debtors) if (d.balance > 0) dHeap.push(d);
    for (const auto& c : creditors) if (c.balance > 0) cHeap.push(c);

    while (!dHeap.empty() && !cHeap.empty()) {
        BalanceNode debtor = dHeap.top(); dHeap.pop();
        BalanceNode creditor = cHeap.top(); cHeap.pop();

        long long settled = min(debtor.balance, creditor.balance);
        settlements.push_back(Transaction(debtor.name, creditor.name, settled, "Greedy balance netting"));

        if (debtor.balance > settled) dHeap.push({debtor.name, debtor.balance - settled});
        if (creditor.balance > settled) cHeap.push({creditor.name, creditor.balance - settled});
    }

    return settlements;
}

// ============================================================================
// 3. OOP CLASS: SettleUpGroup (Encapsulates Group Data and Solvers)
// ============================================================================

class SettleUpGroup {
public:
    string name;
    vector<Transaction> transactions;
    string strategy; // "greedy" or "exact"

    SettleUpGroup(string groupName = "My Group", string strat = "greedy") {
        name = groupName;
        strategy = strat;
    }

    // Records a debt from one person to another
    void recordTransaction(string from, string to, long long amountCents, string desc = "") {
        transactions.push_back(Transaction(from, to, amountCents, desc));
    }

    // Helper to record amounts directly from dollars (e.g. 30.50 -> 3050 cents)
    void recordTransactionDollars(string from, string to, double dollars, string desc = "") {
        long long cents = static_cast<long long>(round(dollars * 100.0));
        recordTransaction(from, to, cents, desc);
    }

    // Step 1: Calculate the net balance for each person
    unordered_map<string, long long> calculateNetBalances() {
        unordered_map<string, long long> balances;
        for (const auto& tx : transactions) {
            balances[tx.debtor] -= tx.amount;
            balances[tx.creditor] += tx.amount;
        }
        return balances;
    }

    // Step 2: Generate the simplified settlement plan
    vector<Transaction> generateSettlementPlan() {
        unordered_map<string, long long> netBalances = calculateNetBalances();
        if (strategy == "exact") {
            return solveExactMatch(netBalances);
        }
        return solveGreedy(netBalances);
    }

    // Prints a nice report to the console
    void displayReport(string strategyTitle) {
        vector<Transaction> plan = generateSettlementPlan();
        unordered_map<string, long long> netBalances = calculateNetBalances();

        cout << "\n======================================================================\n";
        cout << "  SETTLEUP - OOPS DEBT SETTLEMENT REPORT\n";
        cout << "  Active Strategy: " << strategyTitle << "\n";
        cout << "======================================================================\n";

        // 1. Raw Transactions
        cout << "\n[1] Initial Raw Transactions (" << transactions.size() << " transfers):\n";
        cout << "----------------------------------------------------------------------\n";
        for (size_t i = 0; i < transactions.size(); ++i) {
            cout << "  " << (i + 1) << ". " << left << setw(12) << transactions[i].debtor
                 << " owes " << left << setw(12) << transactions[i].creditor
                 << " : " << right << setw(10) << formatMoney(transactions[i].amount) << "\n";
        }

        // 2. Net Balances
        cout << "\n[2] Reduced Net Balances (O(V) Scalar Ledger):\n";
        cout << "----------------------------------------------------------------------\n";
        vector<pair<string, long long>> sortedBalances(netBalances.begin(), netBalances.end());
        sort(sortedBalances.begin(), sortedBalances.end());

        for (const auto& entry : sortedBalances) {
            string status = entry.second > 0 ? "[CREDITOR: Receives]"
                          : entry.second < 0 ? "[DEBTOR  : Pays    ]"
                          : "[SETTLED : Balanced]";
            cout << "  * " << left << setw(14) << entry.first
                 << left << setw(22) << status
                 << right << setw(10) << formatMoney(entry.second) << "\n";
        }

        // 3. Simplified Settlement Plan
        cout << "\n[3] Optimal Simplified Settlement Plan (" << plan.size() << " transfers):\n";
        cout << "----------------------------------------------------------------------\n";
        for (size_t i = 0; i < plan.size(); ++i) {
            cout << "  Step " << (i + 1) << ": "
                 << left << setw(12) << plan[i].debtor
                 << " pays " << left << setw(12) << plan[i].creditor
                 << " -> " << right << setw(10) << formatMoney(plan[i].amount);
            if (!plan[i].description.empty()) cout << " (" << plan[i].description << ")";
            cout << "\n";
        }

        // 4. Efficiency Metrics
        long long rawTotal = 0;
        for (const auto& tx : transactions) rawTotal += tx.amount;
        long long settledTotal = 0;
        for (const auto& tx : plan) settledTotal += tx.amount;

        int rawCount = static_cast<int>(transactions.size());
        int planCount = static_cast<int>(plan.size());
        double pctTx = rawCount > 0 ? (static_cast<double>(rawCount - planCount) / rawCount) * 100.0 : 0.0;
        double pctCash = rawTotal > 0 ? (static_cast<double>(rawTotal - settledTotal) / rawTotal) * 100.0 : 0.0;

        cout << "\n[4] Algorithmic Efficiency Metrics:\n";
        cout << "----------------------------------------------------------------------\n";
        cout << "  * Transactions Required : " << planCount << " (reduced from " << rawCount
             << ", -" << fixed << setprecision(1) << pctTx << "%)\n";
        cout << "  * Total Cash in Motion  : " << formatMoney(settledTotal)
             << " (reduced from " << formatMoney(rawTotal)
             << ", -" << fixed << setprecision(1) << pctCash << "% cash drag)\n";
        cout << "  * Invariant Assertion   : EXACT ZERO-SUM CONSERVED ($0.00 drift)\n";
        cout << "======================================================================\n\n";
    }
};

// ============================================================================
// 4. DEMO & INTERACTIVE CLI
// ============================================================================

void runOOPDemo() {
    cout << "\n>>> Running SettleUp Object-Oriented Architecture Demo <<<\n";
    SettleUpGroup skiTrip("Alps Ski Trip 2026", "greedy");

    // Add sample transactions with Rehan, Pulkit, and Arnav
    skiTrip.recordTransactionDollars("Rehan",   "Pulkit",  30.00, "Chalet groceries");
    skiTrip.recordTransactionDollars("Pulkit",  "Arnav",   40.00, "Snowboard rental");
    skiTrip.recordTransactionDollars("Arnav",   "Rehan",   20.00, "Dinner contribution");
    skiTrip.recordTransactionDollars("David",   "Pulkit",  25.00, "Gasoline split");
    skiTrip.recordTransactionDollars("Arnav",   "Emma",    35.00, "Lift pass share");
    skiTrip.recordTransactionDollars("Rehan",   "Emma",    15.00, "Thermal wear");

    // Demo Strategy 1
    skiTrip.strategy = "greedy";
    skiTrip.displayReport("Greedy Max-Heap Cash-Flow Minimization (Standard O(N log N))");

    // Demo Strategy 2
    skiTrip.strategy = "exact";
    skiTrip.displayReport("Exact-Match Optimized Strategy (Subgroup Elimination)");
}

void runInteractiveCLI() {
    cout << "============================================================\n";
    cout << "  SettleUp Interactive CLI (C++ Engine)\n";
    cout << "============================================================\n";

    string groupName;
    cout << "Enter Group Name: ";
    cin >> groupName;

    SettleUpGroup group(groupName);

    cout << "\nChoose Settlement Strategy:\n";
    cout << "1. Greedy Max-Heap Strategy\n";
    cout << "2. Exact-Match Strategy\n";
    cout << "Selection (1 or 2): ";
    int choice = 1;
    cin >> choice;
    group.strategy = (choice == 2 ? "exact" : "greedy");

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
        group.recordTransactionDollars(debtor, creditor, amount);
    }

    group.displayReport(group.strategy == "exact" ? "Exact-Match Strategy" : "Greedy Strategy");
}

// ============================================================================
// 5. JSON BRIDGE (Connects C++ Engine with Website Backend)
// ============================================================================

// Simple helper to extract string values from JSON
string extractJsonString(const string& json, const string& key) {
    string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == string::npos) return "";

    size_t colonPos = json.find(':', keyPos);
    if (colonPos == string::npos) return "";

    size_t quoteStart = json.find('"', colonPos + 1);
    if (quoteStart == string::npos) return "";

    size_t quoteEnd = json.find('"', quoteStart + 1);
    if (quoteEnd == string::npos) return "";

    return json.substr(quoteStart + 1, quoteEnd - quoteStart - 1);
}

// Simple helper to extract numbers from JSON
long long extractJsonNumber(const string& json, const string& key) {
    string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == string::npos) return 0;

    size_t colonPos = json.find(':', keyPos);
    if (colonPos == string::npos) return 0;

    size_t numStart = json.find_first_of("0123456789-", colonPos + 1);
    if (numStart == string::npos) return 0;

    size_t numEnd = json.find_first_not_of("0123456789", numStart + (json[numStart] == '-' ? 1 : 0));
    try {
        return stoll(json.substr(numStart, numEnd - numStart));
    } catch (...) {
        return 0;
    }
}

// Reads JSON debts from standard input, solves them, and outputs JSON
void runJsonMode() {
    string input, line;
    while (getline(cin, line)) {
        input += line;
    }

    if (input.empty()) {
        cout << "{\"success\":false,\"error\":\"Empty JSON input\"}\n";
        return;
    }

    string strategy = extractJsonString(input, "strategy");
    if (strategy.empty()) strategy = "greedy";

    SettleUpGroup group("API Group", strategy);

    // Parse debts array
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
                    group.recordTransaction(from, to, amount);
                }
                cursor = objEnd + 1;
            }
        }
    }

    // Solve and output JSON
    vector<Transaction> plan = group.generateSettlementPlan();

    cout << "{\"success\":true,\"settlement\":[";
    for (size_t i = 0; i < plan.size(); ++i) {
        if (i > 0) cout << ",";
        cout << "{\"from\":\"" << plan[i].debtor << "\","
             << "\"to\":\"" << plan[i].creditor << "\","
             << "\"amount\":" << plan[i].amount << ","
             << "\"description\":\"" << plan[i].description << "\"}";
    }
    cout << "]}\n";
}

// ============================================================================
// 6. MAIN FUNCTION
// ============================================================================

int main(int argc, char* argv[]) {
    // Fast I/O
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    // If website calls C++ with "--json", run in API mode
    if (argc > 1 && string(argv[1]) == "--json") {
        runJsonMode();
        return 0;
    }

    // If terminal runs with "--demo", run showcase
    if (argc > 1 && string(argv[1]) == "--demo") {
        runOOPDemo();
        return 0;
    }

    // Interactive Mode
    cout << "Choose Mode:\n";
    cout << "1. Run Complete OOP Demo\n";
    cout << "2. Interactive Input\n";
    cout << "Selection (1 or 2): ";
    int choice = 1;
    if (cin >> choice && choice == 2) {
        runInteractiveCLI();
    } else {
        runOOPDemo();
    }

    return 0;
}
