#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <queue>
#include <algorithm>
#include <cmath>
#include <iomanip>

using namespace std;
// 1. DATA STRUCTURES
struct Transaction
{
    string from;
    string to;
    long long amount;
    string note;
};

struct Person
{
    string name;
    long long amount;
    bool operator<(const Person& other) const
    {
        return amount < other.amount;
    }
};

string formatMoney(long long cents)
{
    long long dollars = abs(cents) / 100;
    long long rem = abs(cents) % 100;

    string result = "";

    if (cents < 0)
    {
        result += "-$";
    }
    else
    {
        result += "$";
    }

    result += to_string(dollars);
    result += ".";

    if (rem < 10)
    {
        result += "0";
    }

    result += to_string(rem);

    return result;
}

// 2. CORE DEBT SIMPLIFICATION ALGORITHM
vector<Transaction> simplifyDebts(const unordered_map<string, long long>& balances, bool exactMatch = false)
{
    vector<Transaction> result;
    vector<Person> debtors;
    vector<Person> creditors;

    for (const auto& p : balances)
    {
        if (p.second < 0)
        {
            debtors.push_back({
                p.first, 
                -p.second
            });
        }
        else if (p.second > 0)
        {
            creditors.push_back({
                p.first, 
                p.second
            });
        }
    }

    if (exactMatch)
    {
        for (auto& d : debtors)
        {
            for (auto& c : creditors)
            {
                if (d.amount > 0 && d.amount == c.amount)
                {
                    result.push_back({
                        d.name, 
                        c.name, 
                        d.amount, 
                        "Exact match"
                    });

                    d.amount = 0;
                    c.amount = 0;
                    break;
                }
            }
        }
    }

    priority_queue<Person> dHeap;
    priority_queue<Person> cHeap;

    for (const auto& d : debtors)
    {
        if (d.amount > 0)
        {
            dHeap.push(d);
        }
    }

    for (const auto& c : creditors)
    {
        if (c.amount > 0)
        {
            cHeap.push(c);
        }
    }

    while (!dHeap.empty() && !cHeap.empty())
    {
        Person d = dHeap.top();
        dHeap.pop();

        Person c = cHeap.top();
        cHeap.pop();

        long long settled = min(d.amount, c.amount);

        result.push_back({
            d.name, 
            c.name, 
            settled, 
            "Greedy netting"
        });

        if (d.amount > settled)
        {
            dHeap.push({
                d.name, 
                d.amount - settled
            });
        }

        if (c.amount > settled)
        {
            cHeap.push({
                c.name, 
                c.amount - settled
            });
        }
    }

    return result;
}

// 3. GROUP MANAGEMENT CLASS
// Group class: manages group members, expenses, and settlements
class Group
{
public:
    string name;
    vector<Transaction> transactions;

    Group(string groupName = "Trip")
    {
        name = groupName;
    }

    void addDebt(string from, string to, long long cents, string note = "")
    {
        transactions.push_back({
            from, 
            to, 
            cents, 
            note
        });
    }

    void addDebtDollars(string from, string to, double dollars, string note = "")
    {
        long long cents = static_cast<long long>(round(dollars * 100.0));
        addDebt(from, to, cents, note);
    }

    // Calculates the net scalar balance for each person
    unordered_map<string, long long> getNetBalances()
    {
        unordered_map<string, long long> balances;

        for (const auto& t : transactions)
        {
            balances[t.from] -= t.amount;
            balances[t.to] += t.amount;
        }

        return balances;
    }

    vector<Transaction> settle(bool exact = false)
    {
        unordered_map<string, long long> balances = getNetBalances();
        return simplifyDebts(balances, exact);
    }

    void printReport(bool exact = false)
    {
        vector<Transaction> plan = settle(exact);
        unordered_map<string, long long> balances = getNetBalances();

        cout << "\n\n";
        cout << "  SettleUp: " << name << " (" << (exact ? "Exact Match" : "Greedy Heap") << ")\n";

        cout << "\n1. Original Expenses (" << transactions.size() << "):\n";
        for (size_t i = 0; i < transactions.size(); i++)
        {
            cout << "  " << (i + 1) << ". " 
                 << left << setw(10) << transactions[i].from 
                 << " owes " 
                 << left << setw(10) << transactions[i].to 
                 << " : " 
                 << formatMoney(transactions[i].amount) 
                 << "\n";
        }

        cout << "\n2. Net Balances:\n";
        vector<pair<string, long long>> sorted(balances.begin(), balances.end());
        sort(sorted.begin(), sorted.end());

        for (const auto& p : sorted)
        {
            string status = "";

            if (p.second > 0)
            {
                status = "[Receives]";
            }
            else if (p.second < 0)
            {
                status = "[Pays]    ";
            }
            else
            {
                status = "[Settled] ";
            }

            cout << "  * " 
                 << left << setw(10) << p.first 
                 << " " << status 
                 << " " << formatMoney(p.second) 
                 << "\n";
        }

        cout << "\n3. Settlement Plan (" << plan.size() << " transfers):\n";
        for (size_t i = 0; i < plan.size(); i++)
        {
            cout << "  Step " << (i + 1) << ": " 
                 << left << setw(10) << plan[i].from 
                 << " pays " 
                 << left << setw(10) << plan[i].to 
                 << " -> " 
                 << formatMoney(plan[i].amount) 
                 << " (" << plan[i].note << ")\n";
        }

        cout << "\n";
    }
};

// 4. DEMO RUNNER

void runDemo()
{
    Group skiTrip("Trip 2026");

    skiTrip.addDebtDollars("Rehan",  "Pulkit", 30.00, "Chalet groceries");
    skiTrip.addDebtDollars("Pulkit", "Arnav",  40.00, "Snowboard rental");
    skiTrip.addDebtDollars("Arnav",  "Rehan",  20.00, "Dinner contribution");
    skiTrip.addDebtDollars("David",  "Pulkit", 25.00, "Gasoline split");
    skiTrip.addDebtDollars("Arnav",  "Emma",   35.00, "Lift pass share");
    skiTrip.addDebtDollars("Rehan",  "Emma",   15.00, "Thermal wear");

    skiTrip.printReport(false); 
    skiTrip.printReport(true); 
}

// 5. INTERACTIVE CLI MODE

void runInteractiveCLI()
{
    string groupName;
    cout << "Enter group name: ";
    getline(cin >> ws, groupName);

    Group group(groupName);

    int choice = 1;
    int count = 0;

    cout << "Strategy (1: Greedy, 2: Exact Match): ";
    cin >> choice;

    cout << "How many debts? ";
    cin >> count;

    cout << "Enter debts (format: Debtor Creditor Amount):\n";

    for (int i = 0; i < count; i++)
    {
        string from;
        string to;
        double amount;

        cout << "Debt #" << (i + 1) << ": ";
        cin >> from >> to >> amount;

        group.addDebtDollars(from, to, amount);
    }

    bool useExact = (choice == 2);
    group.printReport(useExact);
}


// 6. JSON PARSING & IPC BRIDGE FOR NEXT.JS
// Extracts field value from simple JSON string
string parseJsonField(const string& json, const string& key)
{
    size_t k = json.find("\"" + key + "\"");
    if (k == string::npos)
    {
        return "";
    }

    size_t colon = json.find(':', k);
    if (colon == string::npos)
    {
        return "";
    }

    size_t start = json.find_first_not_of(" \":", colon);
    if (start == string::npos)
    {
        return "";
    }

    size_t end = json.find_first_of("\",}", start);
    if (end == string::npos)
    {
        return json.substr(start);
    }
    else
    {
        return json.substr(start, end - start);
    }
}

// JSON bridge for website backend
void runJsonMode()
{
    string json = "";
    string line = "";

    while (getline(cin, line))
    {
        json += line;
    }

    if (json.empty())
    {
        return;
    }

    bool exact = (parseJsonField(json, "strategy") == "exact");
    Group group("API Group");

    // Parse debts array
    size_t pos = json.find("\"debts\"");
    if (pos != string::npos)
    {
        size_t start = json.find('[', pos);
        size_t end = json.find(']', start);

        size_t curr = start;

        while (curr < end)
        {
            size_t o1 = json.find('{', curr);
            if (o1 == string::npos || o1 >= end)
            {
                break;
            }

            size_t o2 = json.find('}', o1);
            if (o2 == string::npos || o2 > end)
            {
                break;
            }

            string item = json.substr(o1, o2 - o1 + 1);
            string from = parseJsonField(item, "from");
            string to = parseJsonField(item, "to");
            string amtStr = parseJsonField(item, "amount");

            if (!from.empty() && !to.empty() && !amtStr.empty())
            {
                try
                {
                    group.addDebt(from, to, stoll(amtStr));
                }
                catch (...)
                {
                }
            }

            curr = o2 + 1;
        }
    }

    // Output JSON result
    vector<Transaction> plan = group.settle(exact);

    cout << "{\"success\":true,\"settlement\":[";
    for (size_t i = 0; i < plan.size(); i++)
    {
        if (i > 0)
        {
            cout << ",";
        }

        cout << "{\"from\":\"" << plan[i].from << "\","
             << "\"to\":\"" << plan[i].to << "\","
             << "\"amount\":" << plan[i].amount << ","
             << "\"description\":\"" << plan[i].note << "\"}";
    }
    cout << "]}\n";
}

// 7. MAIN FUNCTION
int main(int argc, char* argv[])
{
    if (argc > 1)
    {
        string flag = argv[1];

        if (flag == "--json")
        {
            runJsonMode();
            return 0;
        }

        if (flag == "--demo")
        {
            runDemo();
            return 0;
        }
    }

    cout << "SettleUp Engine\n";
    cout << "1. Run Demo\n";
    cout << "2. Enter Custom Debts\n";
    cout << "Select: ";

    int choice = 1;

    if (cin >> choice && choice == 2)
    {
        runInteractiveCLI();
    }
    else
    {
        runDemo();
    }

    return 0;
}
