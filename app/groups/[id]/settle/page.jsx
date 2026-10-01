'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ErrorCallout from '@/src/components/ErrorCallout';
import { formatCents } from '@/src/lib/formatters';

export default function SettleGroupPage({ params }) {
  const { id } = params;
  const { data: session, status } = useSession();
  const router = useRouter();

  const [groupData, setGroupData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(null);
  const [settlementSuccess, setSettlementSuccess] = useState(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchGroup = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/groups/${id}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to load group');
      setGroupData(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user) {
      fetchGroup();
    }
  }, [id, session]);

  const handleExecuteSettlement = async () => {
    setExecuting(true);
    setError(null);

    try {
      const res = await fetch(`/api/groups/${id}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message || 'Failed to execute settlement');
      }

      setSettlementSuccess(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setExecuting(false);
    }
  };



  if (loading && !groupData) {
    return (
      <main className="min-h-screen bg-ledger-canvas text-bone flex items-center justify-center p-6">
        <div className="font-mono text-xs text-bone-muted">
          Calculating minimal settlement topology...
        </div>
      </main>
    );
  }

  const { group, rawDebts = [], settlementDebts = [], isFullySettled } = groupData || {};
  const rawTotal = rawDebts.reduce((acc, d) => acc + d.amount, 0);
  const settledTotal = settlementDebts.reduce((acc, d) => acc + d.amount, 0);

  return (
    <main className="min-h-screen bg-ledger-canvas text-bone flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-ledger-border bg-ledger-panel">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/groups/${id}`}
              className="text-xs font-mono text-bone-muted hover:text-bone transition-colors shrink-0"
            >
              Back to {group?.name}
            </Link>
            <span className="text-bone-dark">/</span>
            <span className="text-xs font-sans text-bone">
              Execute Settlement
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 w-full flex-1 space-y-6">
        {error && <ErrorCallout error={{ message: error }} onDismiss={() => setError(null)} />}

        {settlementSuccess ? (
          /* Success Screen */
          <div className="border border-credit/40 bg-ledger-panel p-4 sm:p-8 space-y-6 text-center">
            <div className="w-10 h-10 rounded-full border border-credit/50 bg-credit/10 text-credit flex items-center justify-center mx-auto text-base font-semibold">
              ✓
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-xl sm:text-2xl font-medium tracking-tight text-bone">
                Settlement committed to ledger
              </h2>
              <p className="text-xs text-bone-muted font-sans max-w-lg mx-auto">
                Committed{' '}
                <strong className="text-credit font-mono">{settlementSuccess.ledgerEntriesCount}</strong>{' '}
                reciprocal double-entry journal entries in an atomic session. All debts in{' '}
                <strong className="text-bone">{group?.name}</strong> are now fully netted to zero.
              </p>
            </div>

            <div className="p-4 border border-ledger-border bg-ledger-subpanel max-w-md mx-auto text-left font-mono text-xs space-y-2">
              <div className="flex justify-between text-bone-dark">
                <span>Batch Reference:</span>
                <span className="text-bone truncate max-w-[200px]">
                  {settlementSuccess.settlementBatchId}
                </span>
              </div>
              <div className="flex justify-between text-bone-dark">
                <span>Transfers Executed:</span>
                <span className="text-credit font-semibold">
                  {settlementSuccess.transactions?.length || 0}
                </span>
              </div>
              <div className="flex justify-between text-bone-dark">
                <span>Total Net Settled:</span>
                <span className="text-bone font-semibold">
                  {formatCents(settlementSuccess.totalAmountSettledCents, group?.baseCurrency)}
                </span>
              </div>
            </div>

            <div className="pt-4">
              <Link
                href={`/groups/${id}`}
                className="py-2.5 px-6 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold inline-block transition-colors"
              >
                Return to group overview
              </Link>
            </div>
          </div>
        ) : isFullySettled || settlementDebts.length === 0 ? (
          /* Already Settled State */
          <div className="border border-ledger-border bg-ledger-panel p-6 sm:p-8 text-center space-y-4">
            <div className="w-10 h-10 rounded-full border border-credit/40 bg-credit/10 text-credit flex items-center justify-center mx-auto text-sm font-mono">
              $0
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-xl font-medium text-bone">
                Zero Net Liability
              </h2>
              <p className="text-xs text-bone-muted font-sans max-w-md mx-auto">
                All participant accounts in this group are balanced. There are no outstanding debts to simplify or settle.
              </p>
            </div>
            <Link
              href={`/groups/${id}`}
              className="py-2 px-4 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone inline-block transition-colors"
            >
              Back to group overview
            </Link>
          </div>
        ) : (
          /* Settlement Confirmation & Plan */
          <div className="border border-ledger-border bg-ledger-panel p-4 sm:p-8 space-y-6">
            <div className="border-b border-ledger-border pb-4">
              <h1 className="font-display text-xl sm:text-2xl font-medium tracking-tight text-bone mb-1">
                Execute Minimal Settlement Plan
              </h1>
              <p className="text-xs text-bone-muted font-sans">
                Review the optimal bilateral transfers calculated to resolve all group debts.
              </p>
            </div>

            {/* Algorithmic Efficiency Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border border-ledger-border bg-ledger-subpanel divide-y sm:divide-y-0 sm:divide-x divide-ledger-border">
              <div className="p-2.5 sm:p-3">
                <span className="text-[10px] sm:text-[11px] font-sans text-bone-muted block mb-0.5">
                  Raw transfers
                </span>
                <span className="font-mono text-xs sm:text-base text-bone">
                  {rawDebts.length}
                </span>
              </div>
              <div className="p-2.5 sm:p-3">
                <span className="text-[10px] sm:text-[11px] font-sans text-bone-muted block mb-0.5">
                  Settlement plan
                </span>
                <span className="font-mono text-xs sm:text-base text-credit font-semibold">
                  {settlementDebts.length} transfers
                </span>
              </div>
              <div className="p-2.5 sm:p-3">
                <span className="text-[10px] sm:text-[11px] font-sans text-bone-muted block mb-0.5">
                  Raw cash volume
                </span>
                <span className="font-mono text-xs sm:text-base text-bone">
                  {formatCents(rawTotal, group?.baseCurrency)}
                </span>
              </div>
              <div className="p-2.5 sm:p-3">
                <span className="text-[10px] sm:text-[11px] font-sans text-bone-muted block mb-0.5">
                  Net settled volume
                </span>
                <span className="font-mono text-xs sm:text-base text-credit font-semibold">
                  {formatCents(settledTotal, group?.baseCurrency)}
                </span>
              </div>
            </div>

            {/* Required Transaction Steps */}
            <div className="space-y-3">
              <span className="text-xs font-sans text-bone-muted block">
                Required Settlement Steps ({settlementDebts.length}):
              </span>

              <div className="space-y-2">
                {settlementDebts.map((tx, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border border-ledger-border bg-ledger-subpanel font-mono text-xs gap-2"
                  >
                    <div className="flex items-center gap-3 truncate">
                      <span className="w-5 h-5 rounded-full border border-ledger-border bg-ledger-panel text-bone-muted flex items-center justify-center text-[10px] font-semibold shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex items-center gap-2 truncate">
                        <strong className="text-debt-light font-medium truncate">{tx.from}</strong>
                        <span className="text-bone-dark font-sans shrink-0">pays</span>
                        <strong className="text-credit font-medium truncate">{tx.to}</strong>
                      </div>
                    </div>

                    <span className="font-mono text-sm text-bone font-semibold tabular-nums text-right sm:text-right shrink-0">
                      {formatCents(tx.amount, group?.baseCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Settlement Notes */}
            <div>
              <label className="block text-xs font-sans text-bone-muted mb-1">
                Settlement Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. SettleUp batch executed via bank wire or payment app"
                className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
              />
            </div>

            {/* Atomicity Assurance Callout */}
            <div className="p-4 border border-ledger-border bg-ledger-subpanel/50 space-y-1 text-xs text-bone-muted">
              <div className="text-brass font-sans font-medium text-xs">
                Atomic Transaction Guarantee
              </div>
              <p className="text-[11px] font-sans leading-relaxed text-bone-dark">
                This operation commits inside a database multi-document transaction. If any validation or network fault occurs, all changes roll back instantaneously. No partial settlement entries will be appended to the ledger.
              </p>
            </div>

            {/* Action Bar */}
            <div className="pt-4 border-t border-ledger-border flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <Link
                href={`/groups/${id}`}
                className="py-2.5 px-4 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone-muted hover:text-bone text-center transition-colors"
              >
                Cancel
              </Link>

              <button
                type="button"
                onClick={handleExecuteSettlement}
                disabled={executing}
                className="py-2.5 px-6 text-xs font-mono bg-credit hover:bg-credit/90 text-white font-semibold text-center transition-colors disabled:opacity-40"
              >
                {executing ? 'Committing transaction...' : 'Commit settlement plan'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-ledger-border bg-ledger-panel py-4 text-xs font-mono text-bone-dark">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <span>Settlement Engine</span>
          <span>Greedy Graph Netting</span>
        </div>
      </footer>
    </main>
  );
}
