'use client';

import React, { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ErrorCallout from '@/src/components/ErrorCallout';
import { formatCents, formatSignedCents } from '@/src/lib/formatters';

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [groups, setGroups] = useState([]);
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // New Group Form State
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupSelectModal, setShowGroupSelectModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [creating, setCreating] = useState(false);

  const handleAddExpenseClick = () => {
    if (groups.length === 0) {
      setShowCreateGroup(true);
    } else if (groups.length === 1) {
      router.push(`/groups/${groups[0]._id}/expenses/new`);
    } else {
      setShowGroupSelectModal(true);
    }
  };

  useEffect(() => {
    if (status === 'unauthenticated') {
      setLoading(false);
      router.push('/login');
    }
  }, [status, router]);

  const fetchData = async () => {
    if (!session?.user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch all groups
      const groupsRes = await fetch('/api/groups');
      const groupsJson = await groupsRes.json();
      if (!groupsJson.success) throw new Error(groupsJson.error?.message || 'Failed to fetch groups');

      // 2. Fetch user's net balances across groups
      const balancesRes = await fetch(`/api/users/${session.user.id}/balances?currency=${session.user.defaultCurrency || 'USD'}`);
      const balancesJson = await balancesRes.json();

      setGroups(groupsJson.data || []);
      setBalances(balancesJson.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id) {
      fetchData();
    } else if (status === 'authenticated' && !session?.user?.id) {
      setLoading(false);
    }
  }, [session, status]);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName,
          baseCurrency,
          members: [session.user.id],
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to create group');

      setGroupName('');
      setShowCreateGroup(false);
      fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  // Compute aggregate totals across all groups
  const totalCredited = balances.reduce((sum, b) => sum + (b.totalCreditedCents || 0), 0);
  const totalDebited = balances.reduce((sum, b) => sum + (b.totalDebitedCents || 0), 0);
  const netPosition = balances.reduce((sum, b) => sum + (b.netBalanceCents || 0), 0);



  if (status === 'loading' || (status === 'authenticated' && loading && !groups.length && !error)) {
    return (
      <main className="min-h-screen bg-ledger-canvas text-bone flex items-center justify-center p-6">
        <div className="font-mono text-xs text-bone-muted">
          Loading ledger accounts...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ledger-canvas text-bone flex flex-col justify-between">
      {/* Masthead */}
      <header className="border-b border-ledger-border bg-ledger-panel">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-2xl font-medium tracking-tight text-bone">
              SettleUp
            </h1>
            <span className="text-xs text-bone-muted font-sans hidden sm:inline">
              Portfolio Overview
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="text-bone-muted hidden sm:inline">
              Account: <strong className="text-bone font-medium">{session?.user?.name || session?.user?.email}</strong>
            </span>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              type="button"
              className="py-1 px-3 border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone-muted hover:text-bone transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-6 py-8 w-full space-y-8 flex-1">
        {error && <ErrorCallout error={{ message: error }} onDismiss={() => setError(null)} />}

        {/* Global Net Balance Statement Bar */}
        <section className="border border-ledger-border bg-ledger-panel divide-y sm:divide-y-0 sm:divide-x divide-ledger-border grid grid-cols-1 sm:grid-cols-3">
          <div className="p-6">
            <span className="text-[11px] font-sans text-bone-muted block mb-1">
              Net balance across all groups
            </span>
            <div
              className={`font-display text-3xl font-medium tabular-nums ${
                netPosition > 0 ? 'text-credit' : netPosition < 0 ? 'text-debt' : 'text-bone'
              }`}
            >
              {formatSignedCents(netPosition)}
            </div>
            <span className="text-xs font-mono text-bone-dark block mt-1">
              Consolidated portfolio standing
            </span>
          </div>

          <div className="p-6">
            <span className="text-[11px] font-sans text-bone-muted block mb-1">
              Total receivables (you are owed)
            </span>
            <div className="font-display text-3xl font-medium text-credit tabular-nums">
              +{formatCents(totalCredited)}
            </div>
            <span className="text-xs font-mono text-bone-dark block mt-1">
              Pending reimbursements from participants
            </span>
          </div>

          <div className="p-6">
            <span className="text-[11px] font-sans text-bone-muted block mb-1">
              Total payables (you owe)
            </span>
            <div className="font-display text-3xl font-medium text-debt tabular-nums">
              -{formatCents(totalDebited)}
            </div>
            <span className="text-xs font-mono text-bone-dark block mt-1">
              Outstanding settlement liabilities
            </span>
          </div>
        </section>

        {/* Groups Header & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-ledger-border pb-3">
          <div>
            <h2 className="font-display text-xl text-bone font-medium">Settlement Groups</h2>
            <p className="text-xs text-bone-muted font-sans">
              Independent debt graphs with local cycle resolution.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {groups.length > 0 && (
              <button
                onClick={handleAddExpenseClick}
                type="button"
                className="py-1.5 px-3 text-xs font-mono bg-credit hover:bg-credit/90 text-white font-semibold transition-colors"
                title="Add a new expense to a group"
              >
                Add expense
              </button>
            )}

            <button
              onClick={() => setShowCreateGroup(!showCreateGroup)}
              type="button"
              className="py-1.5 px-3 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone font-medium transition-colors"
            >
              {showCreateGroup ? 'Cancel' : 'Create group'}
            </button>
          </div>
        </div>

        {/* Inline Create Group Form */}
        {showCreateGroup && (
          <form
            onSubmit={handleCreateGroup}
            className="border border-ledger-border bg-ledger-panel p-5 space-y-4 max-w-lg"
          >
            <h3 className="text-sm font-semibold tracking-tight text-bone font-mono">
              Initialize New Settlement Group
            </h3>

            <div>
              <label className="block text-xs font-sans text-bone-muted mb-1">
                Group Name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
                placeholder="e.g. Alps Ski Trip, Flatmates 4B"
                className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-sans text-bone-muted mb-1">
                Base Currency (Calculation Standard)
              </label>
              <select
                value={baseCurrency}
                onChange={(e) => setBaseCurrency(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
              >
                <option value="USD">USD - US Dollar ($)</option>
                <option value="EUR">EUR - Euro (€)</option>
                <option value="GBP">GBP - British Pound (£)</option>
                <option value="INR">INR - Indian Rupee (₹)</option>
                <option value="CAD">CAD - Canadian Dollar (C$)</option>
                <option value="JPY">JPY - Japanese Yen (¥)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={creating}
              className="py-2 px-4 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Initialize group'}
            </button>
          </form>
        )}

        {/* Groups Grid with Structural Hierarchy */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => {
            const groupBalance = balances.find((b) => b.groupId === group._id);
            const netCents = groupBalance?.netBalanceCents || 0;

            return (
              <div
                key={group._id}
                className="border border-ledger-border bg-ledger-panel p-5 flex flex-col justify-between space-y-4 hover:border-ledger-highlight transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono text-bone-muted">
                    <span className="text-[10px] px-1.5 py-0.5 border border-ledger-border bg-ledger-subpanel">
                      {group.baseCurrency}
                    </span>
                    <span className="text-bone-dark">
                      {(group.members || []).length} participants
                    </span>
                  </div>

                  <h3 className="font-display text-lg text-bone font-medium tracking-tight">
                    {group.name}
                  </h3>
                  {group.description && (
                    <p className="text-xs text-bone-muted font-sans line-clamp-2">
                      {group.description}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-ledger-border flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-sans text-bone-dark block">
                      Your net standing
                    </span>
                    <span
                      className={`font-mono text-sm font-semibold tabular-nums ${
                        netCents > 0
                          ? 'text-credit'
                          : netCents < 0
                          ? 'text-debt'
                          : 'text-bone-muted'
                      }`}
                    >
                      {formatSignedCents(netCents, group.baseCurrency)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/groups/${group._id}/expenses/new`}
                      className="py-1 px-2.5 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors"
                      title={`Add an expense to ${group.name}`}
                    >
                      Expense
                    </Link>
                    <Link
                      href={`/groups/${group._id}`}
                      className="py-1 px-2.5 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:bg-ledger-highlight text-bone transition-colors"
                      title="Open group ledger and graph"
                    >
                      Open group
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {groups.length === 0 && (
          <div className="border border-ledger-border bg-ledger-panel p-8 text-center space-y-3">
            <p className="text-xs text-bone-muted font-mono">
              No active groups found in the ledger.
            </p>
            <p className="text-xs font-sans text-bone-muted max-w-md mx-auto">
              In SettleUp, expenses belong to groups so the algorithm can net debts among that group's participants. Create a group to begin recording expenses.
            </p>
            <button
              onClick={() => setShowCreateGroup(true)}
              className="py-2 px-4 text-xs font-mono bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors"
            >
              Create first group
            </button>
          </div>
        )}

        {/* Select Group Modal for Adding Expense */}
        {showGroupSelectModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-ledger-panel border border-ledger-border max-w-md w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-ledger-border pb-3">
                <h3 className="font-display text-base text-bone font-medium">
                  Select Group for Expense
                </h3>
                <button
                  onClick={() => setShowGroupSelectModal(false)}
                  className="text-bone-muted hover:text-bone text-xs font-mono"
                >
                  ✕ Close
                </button>
              </div>

              <p className="text-xs font-mono text-bone-muted">
                Expenses belong to specific groups so debts can be netted and simplified within that social circle.
              </p>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <Link
                    key={g._id}
                    href={`/groups/${g._id}/expenses/new`}
                    onClick={() => setShowGroupSelectModal(false)}
                    className="block p-3 border border-ledger-border bg-ledger-subpanel hover:border-bone hover:bg-ledger-canvas transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm font-medium text-bone">
                        {g.name}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 border border-ledger-border text-bone-muted">
                        {g.baseCurrency}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-bone-dark block mt-1">
                      {(g.members || []).length} members
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-ledger-border bg-ledger-panel py-4 text-xs font-mono text-bone-dark">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <span>SettleUp Portfolio Dashboard</span>
          <span>Double-Entry Database Journal</span>
        </div>
      </footer>
    </main>
  );
}
