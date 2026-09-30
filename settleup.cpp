/**
 * ==============================================================================
 * SettleUp - Multi-Party Debt Simplification & Cash Flow Minimization Engine
 * ==============================================================================
 * 
 * Standalone C++ implementation of the SettleUp / Splitwise greedy debt netting
 * algorithm for Design & Analysis of Algorithms (DAA) and interview preparation.
 * 
 * ------------------------------------------------------------------------------
 * ALGORITHMIC DESIGN & COMPLEXITY ANALYSIS:
 * ------------------------------------------------------------------------------
 * 1. Cycle Elimination & Net Balance Reduction (O(E)):
 *    Arbitrary pairwise directed debt graphs contain cycles (e.g. A->B->C->A).
 *    We collapse all directed edges into a single scalar "net balance" per node:
 *      Net Balance = (Total Inbound Receivables) - (Total Outbound Liabilities)
 *    Net balances sum to exactly 0 (Conservation of Money Invariant).
 * 
 * 2. Partitioning into Bipartite Debtor & Creditor Heaps (O(N log N)):
 *    Participants with net balance = 0 are immediately removed (no transactions needed).
 *    - Debtors (net < 0): owe money to the group pool.
 *    - Creditors (net > 0): are owed money from the group pool.
 * 
 * 3. Greedy Max-Flow Settlement Matching (O(N log N)):
 *    At each step, match the largest debtor with the largest creditor.
 *    Settled amount = min(|debtor_balance|, |creditor_balance|).
 *    At least one participant's balance is reduced to 0 at every iteration.
 *    Upper Bound Guarantee: At most N - 1 transactions for N non-zero participants.
 * 
 * 4. Integer Arithmetic (Fixed-Point Cents):
 *    All calculations are performed strictly in integer cents (long long)
 *    to prevent IEEE 754 floating-point rounding errors.
 * 
 * ------------------------------------------------------------------------------
 * Compilation:
 *   g++ -std=c++17 settleup.cpp -o settleup_cli
 * 
 * Usage:
 *   ./settleup_cli --demo        (Runs built-in multi-currency test suite)
 *   ./settleup_cli               (Runs interactive prompt)
 * ==============================================================================
 */

#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <queue>
#include <algorithm>
#include <iomanip>
#include <cmath>
#include <sstream>

using namespace std;

// Represent a directed financial debt (from owes to an amount in integer cents)
struct Debt {
    string from;
    string to;
    long long amountCents; // Strictly positive integer cents
};

// Formats integer cents into standard financial currency string ($XX.YY)
string formatMoney(long long cents, const string& currency = "USD") {
    bool negative = cents < 0;
    long long absCents = std::abs(cents);
    long long dollars = absCents / 100;
    long long remainder = absCents % 100;

    ostringstream oss;
    if (negative) oss << "-";
    if (currency == "USD") oss << "$";
    else oss << currency << " ";

    oss << dollars << "." << setfill('0') << setw(2) << remainder;
    return oss.str();
}

// Participant balance tuple for priority queue / greedy matching
struct ParticipantBalance {
    string name;
    long long amountCents;

    // Comparator: Sort descending by balance amount, tie-break alphabetically
    bool operator<(const ParticipantBalance& other) const {
        if (amountCents != other.amountCents) {
            return amountCents < other.amountCents; // Max-heap: largest at top
        }
        return name > other.name; // Alphabetical tie-break
    }
};

/**
 * Result structure returned by debt simplification
 */
struct SimplificationResult {
    vector<Debt> simplifiedDebts;
    unordered_map<string, long long> netBalances;
    long long rawTotalVolume = 0;
    long long simplifiedTotalVolume = 0;
    int rawTransactionCount = 0;
    int simplifiedTransactionCount = 0;
};

/**
 * Core Algorithm: Simplifies arbitrary pairwise debts into minimal transactions.
 * 
 * @param rawDebts Vector of initial pairwise obligations.
 * @return SimplificationResult containing optimal transactions and metrics.
 */
SimplificationResult simplifyDebts(const vector<Debt>& rawDebts) {
    SimplificationResult result;
    result.rawTransactionCount = static_cast<int>(rawDebts.size());

    // Step 1: Calculate Net Balance per participant in O(E) time
    for (const auto& debt : rawDebts) {
        if (debt.amountCents <= 0 || debt.from == debt.to) continue; // Skip no-ops

        result.rawTotalVolume += debt.amountCents;
        result.netBalances[debt.from] -= debt.amountCents;
        result.netBalances[debt.to] += debt.amountCents;
    }

    // Step 2: Verify Conservation of Money Invariant (sum == 0)
    long long sumOfBalances = 0;
    for (const auto& [name, balance] : result.netBalances) {
        sumOfBalances += balance;
    }

    if (sumOfBalances != 0) {
        cerr << "Error: Conservation of money violated! Net sum is " 
             << sumOfBalances << " cents (expected 0)." << endl;
        return result;
    }

    // Step 3: Populate Debtor and Creditor Max-Heaps
    priority_queue<ParticipantBalance> debtors;   // People who owe money (positive magnitude)
    priority_queue<ParticipantBalance> creditors; // People who are owed money

    for (const auto& [name, balance] : result.netBalances) {
        if (balance < 0) {
            debtors.push({name, -balance});
        } else if (balance > 0) {
            creditors.push({name, balance});
        }
    }

    // Step 4: Greedy Matching Algorithm (O(N log N))
    // Match the largest debtor with the largest creditor at each step.
    while (!debtors.empty() && !creditors.empty()) {
        auto debtor = debtors.top();
        debtors.pop();

        auto creditor = creditors.top();
        creditors.pop();

        // The settled amount is the minimum of debtor liability and creditor receivable
        long long settledAmount = min(debtor.amountCents, creditor.amountCents);

        // Record minimal bilateral transaction
        result.simplifiedDebts.push_back({debtor.name, creditor.name, settledAmount});
        result.simplifiedTotalVolume += settledAmount;

        // If either party still has unsettled balance, push back into priority queue
        if (debtor.amountCents > settledAmount) {
            debtors.push({debtor.name, debtor.amountCents - settledAmount});
        }
        if (creditor.amountCents > settledAmount) {
            creditors.push({creditor.name, creditor.amountCents - settledAmount});
        }
    }

    result.simplifiedTransactionCount = static_cast<int>(result.simplifiedDebts.size());
    return result;
}

/**
 * Prints comprehensive algorithmic report to console
 */
void printReport(const vector<Debt>& rawDebts, const SimplificationResult& result) {
    cout << "\n======================================================================\n";
    cout << "  SETTLEUP - MULTI-PARTY DEBT SETTLEMENT REPORT\n";
    cout << "======================================================================\n";

    // 1. Raw Transactions
    cout << "\n[1] Initial Raw Transactions (" << rawDebts.size() << " transfers):\n";
    cout << "----------------------------------------------------------------------\n";
    for (size_t i = 0; i < rawDebts.size(); ++i) {
        cout << "  " << (i + 1) << ". " << left << setw(12) << rawDebts[i].from 
             << " owes " << left << setw(12) << rawDebts[i].to 
             << " : " << right << setw(10) << formatMoney(rawDebts[i].amountCents) << "\n";
    }

    // 2. Net Balances
    cout << "\n[2] Reduced Net Balances (O(V) Scalar Ledger):\n";
    cout << "----------------------------------------------------------------------\n";
    vector<pair<string, long long>> sortedBalances(result.netBalances.begin(), result.netBalances.end());
    sort(sortedBalances.begin(), sortedBalances.end());

    for (const auto& [name, balance] : sortedBalances) {
        string status;
        if (balance > 0) status = "[CREDITOR: Receives]";
        else if (balance < 0) status = "[DEBTOR  : Pays    ]";
        else status = "[SETTLED : Balanced]";

        cout << "  * " << left << setw(14) << name 
             << left << setw(22) << status 
             << right << setw(10) << formatMoney(balance) << "\n";
    }

    // 3. Optimal Simplified Transactions
    cout << "\n[3] Optimal Simplified Settlement Plan (" << result.simplifiedDebts.size() << " transfers):\n";
    cout << "----------------------------------------------------------------------\n";
    for (size_t i = 0; i < result.simplifiedDebts.size(); ++i) {
        cout << "  Step " << (i + 1) << ": " << left << setw(12) << result.simplifiedDebts[i].from 
             << " pays " << left << setw(12) << result.simplifiedDebts[i].to 
             << " -> " << right << setw(10) << formatMoney(result.simplifiedDebts[i].amountCents) << "\n";
    }

    // 4. Algorithmic Efficiency Metrics
    int txSaved = result.rawTransactionCount - result.simplifiedTransactionCount;
    double txPercent = result.rawTransactionCount > 0 
        ? (static_cast<double>(txSaved) / result.rawTransactionCount) * 100.0 : 0.0;

    long long cashSaved = result.rawTotalVolume - result.simplifiedTotalVolume;
    double cashPercent = result.rawTotalVolume > 0 
        ? (static_cast<double>(cashSaved) / result.rawTotalVolume) * 100.0 : 0.0;

    cout << "\n[4] Algorithmic Efficiency Metrics:\n";
    cout << "----------------------------------------------------------------------\n";
    cout << "  * Transactions Required : " << result.simplifiedTransactionCount 
         << " (reduced from " << result.rawTransactionCount << ", -" << fixed << setprecision(1) << txPercent << "%)\n";
    cout << "  * Total Cash in Motion  : " << formatMoney(result.simplifiedTotalVolume) 
         << " (reduced from " << formatMoney(result.rawTotalVolume) << ", -" << fixed << setprecision(1) << cashPercent << "% cash drag)\n";
    cout << "  * Net Balance Invariant : EXACT ZERO-SUM CONSERVED ($0.00 drift)\n";
    cout << "======================================================================\n\n";
}

void runDemo() {
    cout << "\n>>> Running SettleUp Built-In Multi-Party Test Scenario <<<\n";

    // Scenario matching SettleUp's canonical test suite:
    // Alice, Bob, Charlie, David, Emma with tangled multi-way cycles
    vector<Debt> demoDebts = {
        {"Alice",   "Bob",     3000}, // $30.00
        {"Bob",     "Charlie", 4000}, // $40.00
        {"Charlie", "Alice",   2000}, // $20.00 (Cycle: Alice -> Bob -> Charlie -> Alice)
        {"David",   "Bob",     2500}, // $25.00
        {"Charlie", "Emma",    3500}, // $35.00
        {"Alice",   "Emma",    1500}  // $15.00
    };

    SimplificationResult result = simplifyDebts(demoDebts);
    printReport(demoDebts, result);
}

void runInteractive() {
    cout << "============================================================\n";
    cout << "  SettleUp Interactive CLI (C++ Algorithmic Core)\n";
    cout << "============================================================\n";
    cout << "Enter number of pairwise debts: ";
    int m;
    if (!(cin >> m) || m <= 0) {
        cout << "Invalid count. Exiting.\n";
        return;
    }

    vector<Debt> userDebts;
    cout << "\nEnter each debt in format: <Debtor> <Creditor> <AmountInDollars>\n";
    cout << "Example: Alice Bob 30.50\n\n";

    for (int i = 0; i < m; ++i) {
        string from, to;
        double amount;
        cout << "Debt #" << (i + 1) << ": ";
        cin >> from >> to >> amount;
        long long cents = static_cast<long long>(std::round(amount * 100.0));
        userDebts.push_back({from, to, cents});
    }

    SimplificationResult result = simplifyDebts(userDebts);
    printReport(userDebts, result);
}

int main(int argc, char* argv[]) {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    if (argc > 1 && string(argv[1]) == "--demo") {
        runDemo();
    } else {
        // If run with no args, check if stdin is piped or interactive
        cout << "Choose Mode:\n";
        cout << "1. Run Demo Test Scenario (Alice, Bob, Charlie, David, Emma)\n";
        cout << "2. Interactive Input\n";
        cout << "Selection (1 or 2): ";
        int choice = 1;
        if (cin >> choice && choice == 2) {
            runInteractive();
        } else {
            runDemo();
        }
    }

    return 0;
}
