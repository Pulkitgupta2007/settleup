#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <queue>
#include <algorithm>
#include <cmath>
#include <iomanip>

using namespace std;

// Represents a debt between two people
struct Transaction {
    string from;
    string to;
    long long amount; // in cents
    string note;

    Transaction(string f, string t, long long amt, string n = "")
        : from(f), to(t), amount(amt), note(n) {}
};

// Helper struct for the priority queue
struct Person {
    string name;
    long long amount;

    // Highest amount gets priority in max-heap
    bool operator<(const Person& other) const {
        return amount < other.amount;
    }
};

// Converts cents into a clean dollar string (e.g. 3050 -> "$30.50")
string formatMoney(long long cents) {
    long long absVal = abs(cents);
    long long dollars = absVal / 100;
    long long rem = absVal % 100;

    string s = (cents < 0 ? "-$" : "$") + to_string(dollars) + ".";
    if (rem < 10) s += "0";
    s += to_string(rem);
    return s;
}

// Strategy 1: Greedy max-heap solver
// Repeatedly pairs the biggest debtor with the biggest creditor
vector<Transaction> settleGreedy(const unordered_map<string, long long>& balances) {
    vector<Transaction> result;
    priority_queue<Person> debtors;
    priority_queue<Person> creditors;

    for (const auto& pair : balances) {
        if (pair.second < 0) {
            debtors.push({pair.first, -pair.second});
        } else if (pair.second > 0) {
            creditors.push({pair.first, pair.second});
        }
    }

    while (!debtors.empty() && !creditors.empty()) {
        Person debtor = debtors.top(); debtors.pop();
        Person creditor = creditors.top(); creditors.pop();

        long long settled = min(debtor.amount, creditor.amount);
        result.push_back(Transaction(debtor.name, creditor.name, settled, "Greedy netting"));

        if (debtor.amount > settled) {
            debtors.push({debtor.name, debtor.amount - settled});
        }
        if (creditor.amount > settled) {
            creditors.push({creditor.name, creditor.amount - settled});
        }
    }

    return result;
}

// Strategy 2: Exact match solver
// Checks for exact 1-to-1 matches first, then falls back to greedy
vector<Transaction> settleExactMatch(const unordered_map<string, long long>& balances) {
    vector<Transaction> result;
    vector<Person> debtors;
    vector<Person> creditors;

    for (const auto& pair : balances) {
        if (pair.second < 0) debtors.push_back({pair.first, -pair.second});
        else if (pair.second > 0) creditors.push_back({pair.first, pair.second});
    }

    // Step 1: look for people with exact matching amounts
    for (size_t i = 0; i < debtors.size(); i++) {
        for (size_t j = 0; j < creditors.size(); j++) {
            if (debtors[i].amount > 0 && debtors[i].amount == creditors[j].amount) {
                result.push_back(Transaction(debtors[i].name, creditors[j].name, debtors[i].amount, "Exact match"));
                debtors[i].amount = 0;
                creditors[j].amount = 0;
                break;
            }
        }
    }

    // Step 2: settle any remaining debts using max-heaps
    priority_queue<Person> dHeap, cHeap;
    for (const auto& d : debtors) if (d.amount > 0) dHeap.push(d);
    for (const auto& c : creditors) if (c.amount > 0) cHeap.push(c);

    while (!dHeap.empty() && !cHeap.empty()) {
        Person debtor = dHeap.top(); dHeap.pop();
        Person creditor = cHeap.top(); cHeap.pop();

        long long settled = min(debtor.amount, creditor.amount);
        result.push_back(Transaction(debtor.name, creditor.name, settled, "Greedy netting"));

        if (debtor.amount > settled) dHeap.push({debtor.name, debtor.amount - settled});
        if (creditor.amount > settled) cHeap.push({creditor.name, creditor.amount - settled});
    }

    return result;
}

// Manages a group, tracks raw expenses, and calculates settlements
class Group {
public:
    string name;
    vector<Transaction> transactions;

    Group(string groupName = "Trip") : name(groupName) {}

    void addTransaction(string from, string to, long long cents, string note = "") {
        transactions.push_back(Transaction(from, to, cents, note));
    }

    void addTransactionDollars(string from, string to, double dollars, string note = "") {
        long long cents = static_cast<long long>(round(dollars * 100.0));
        addTransaction(from, to, cents, note);
    }

    unordered_map<string, long long> getNetBalances() {
        unordered_map<string, long long> balances;
        for (const auto& t : transactions) {
            balances[t.from] -= t.amount;
            balances[t.to] += t.amount;
        }
        return balances;
    }

    vector<Transaction> settle(string strategy = "greedy") {
        auto balances = getNetBalances();
        if (strategy == "exact") {
            return settleExactMatch(balances);
        }
        return settleGreedy(balances);
    }

    void printReport(string strategy = "greedy") {
        vector<Transaction> plan = settle(strategy);
        auto balances = getNetBalances();

        cout << "\n========================================\n";
        cout << "  SettleUp Debt Report: " << name << "\n";
        cout << "  Strategy: " << (strategy == "exact" ? "Exact Match" : "Greedy Heap") << "\n";
        cout << "========================================\n";

        cout << "\n1. Original Debts (" << transactions.size() << " transfers):\n";
        for (size_t i = 0; i < transactions.size(); i++) {
            cout << "  " << (i + 1) << ". " << left << setw(10) << transactions[i].from 
                 << " owes " << left << setw(10) << transactions[i].to 
                 << " : " << formatMoney(transactions[i].amount) << "\n";
        }

        cout << "\n2. Net Balances:\n";
        vector<pair<string, long long>> sorted(balances.begin(), balances.end());
        sort(sorted.begin(), sorted.end());
        for (const auto& p : sorted) {
            string status = (p.second > 0) ? "[Receives]" : (p.second < 0) ? "[Pays]    " : "[Settled] ";
            cout << "  * " << left << setw(10) << p.first << " " << status 
                 << " " << right << setw(8) << formatMoney(p.second) << "\n";
        }

        cout << "\n3. Settlement Plan (" << plan.size() << " transfers):\n";
        for (size_t i = 0; i < plan.size(); i++) {
            cout << "  Step " << (i + 1) << ": " << left << setw(10) << plan[i].from 
                 << " pays " << left << setw(10) << plan[i].to 
                 << " -> " << formatMoney(plan[i].amount) 
                 << " (" << plan[i].note << ")\n";
        }

        long long origTotal = 0;
        for (const auto& t : transactions) origTotal += t.amount;
        long long newTotal = 0;
        for (const auto& t : plan) newTotal += t.amount;

        cout << "\n4. Summary:\n";
        cout << "  Transfers: " << transactions.size() << " -> " << plan.size() 
             << " (" << (transactions.size() - plan.size()) << " eliminated)\n";
        cout << "  Total cash moving: " << formatMoney(origTotal) << " -> " << formatMoney(newTotal) << "\n";
        cout << "========================================\n\n";
    }
};

// Demo showcasing the ski trip expenses
void runDemo() {
    Group skiTrip("Alps Ski Trip 2026");

    skiTrip.addTransactionDollars("Rehan",  "Pulkit", 30.00, "Chalet groceries");
    skiTrip.addTransactionDollars("Pulkit", "Arnav",  40.00, "Snowboard rental");
    skiTrip.addTransactionDollars("Arnav",  "Rehan",  20.00, "Dinner contribution");
    skiTrip.addTransactionDollars("David",  "Pulkit", 25.00, "Gasoline split");
    skiTrip.addTransactionDollars("Arnav",  "Emma",   35.00, "Lift pass share");
    skiTrip.addTransactionDollars("Rehan",  "Emma",   15.00, "Thermal wear");

    skiTrip.printReport("greedy");
    skiTrip.printReport("exact");
}

// Interactive terminal CLI
void runInteractiveCLI() {
    string groupName;
    cout << "Enter group name: ";
    cin >> groupName;

    Group group(groupName);

    cout << "Choose strategy (1 for Greedy, 2 for Exact Match): ";
    int choice = 1;
    cin >> choice;
    string strat = (choice == 2) ? "exact" : "greedy";

    int count = 0;
    cout << "How many debts do you want to enter? ";
    cin >> count;

    cout << "\nEnter debts in format: <Debtor> <Creditor> <Amount>\n";
    cout << "Example: Rehan Pulkit 30.50\n\n";

    for (int i = 0; i < count; i++) {
        string from, to;
        double amount;
        cout << "Debt #" << (i + 1) << ": ";
        cin >> from >> to >> amount;
        group.addTransactionDollars(from, to, amount);
    }

    group.printReport(strat);
}

// Helpers for the JSON bridge
string getJsonString(const string& json, const string& key) {
    size_t k = json.find("\"" + key + "\"");
    if (k == string::npos) return "";
    size_t colon = json.find(':', k);
    if (colon == string::npos) return "";
    size_t q1 = json.find('"', colon + 1);
    if (q1 == string::npos) return "";
    size_t q2 = json.find('"', q1 + 1);
    if (q2 == string::npos) return "";
    return json.substr(q1 + 1, q2 - q1 - 1);
}

long long getJsonNumber(const string& json, const string& key) {
    size_t k = json.find("\"" + key + "\"");
    if (k == string::npos) return 0;
    size_t colon = json.find(':', k);
    if (colon == string::npos) return 0;
    size_t start = json.find_first_of("0123456789-", colon + 1);
    if (start == string::npos) return 0;
    size_t end = json.find_first_not_of("0123456789", start + (json[start] == '-' ? 1 : 0));
    try {
        return stoll(json.substr(start, end - start));
    } catch (...) {
        return 0;
    }
}

// JSON mode used by Node.js backend
void runJsonMode() {
    string json, line;
    while (getline(cin, line)) {
        json += line;
    }

    if (json.empty()) {
        cout << "{\"success\":false,\"error\":\"No input provided\"}\n";
        return;
    }

    string strategy = getJsonString(json, "strategy");
    if (strategy.empty()) strategy = "greedy";

    Group group("API Group");

    size_t pos = json.find("\"debts\"");
    if (pos != string::npos) {
        size_t start = json.find('[', pos);
        size_t end = json.find(']', start);

        if (start != string::npos && end != string::npos) {
            size_t curr = start;
            while (curr < end) {
                size_t o1 = json.find('{', curr);
                if (o1 == string::npos || o1 >= end) break;
                size_t o2 = json.find('}', o1);
                if (o2 == string::npos || o2 > end) break;

                string chunk = json.substr(o1, o2 - o1 + 1);
                string from = getJsonString(chunk, "from");
                string to = getJsonString(chunk, "to");
                long long amount = getJsonNumber(chunk, "amount");

                if (!from.empty() && !to.empty() && amount > 0) {
                    group.addTransaction(from, to, amount);
                }
                curr = o2 + 1;
            }
        }
    }

    vector<Transaction> plan = group.settle(strategy);

    cout << "{\"success\":true,\"settlement\":[";
    for (size_t i = 0; i < plan.size(); i++) {
        if (i > 0) cout << ",";
        cout << "{\"from\":\"" << plan[i].from << "\","
             << "\"to\":\"" << plan[i].to << "\","
             << "\"amount\":" << plan[i].amount << ","
             << "\"description\":\"" << plan[i].note << "\"}";
    }
    cout << "]}\n";
}

int main(int argc, char* argv[]) {
    if (argc > 1) {
        string flag = argv[1];
        if (flag == "--json") {
            runJsonMode();
            return 0;
        }
        if (flag == "--demo") {
            runDemo();
            return 0;
        }
    }

    cout << "SettleUp - Debt Simplification Engine\n";
    cout << "1. Run Demo\n";
    cout << "2. Enter Custom Debts\n";
    cout << "Select (1 or 2): ";

    int choice = 1;
    if (cin >> choice && choice == 2) {
        runInteractiveCLI();
    } else {
        runDemo();
    }

    return 0;
}
