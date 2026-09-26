'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import DebtGraph from '../src/components/DebtGraph';
import ErrorCallout from '../src/components/ErrorCallout';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('graph');
  const [showDemoError, setShowDemoError] = useState(false);

  // Concrete 5-person cycle dataset from Phase 1 walkthrough
  const participants = ['Alice', 'Bob', 'Charlie', 'David', 'Emma'];
  const rawDebts = [
    { from: 'Alice', to: 'Bob', amount: 3000 },
    { from: 'Bob', to: 'Charlie', amount: 4000 },
    { from: 'Charlie', to: 'Alice', amount: 2000 }, // cycle leg A -> B -> C -> A
    { from: 'David', to: 'Bob', amount: 2500 },
    { from: 'Charlie', to: 'Emma', amount: 3500 },
    { from: 'Alice', to: 'Emma', amount: 1500 },
  ];

  const settlementDebts = [
    { from: 'Alice', to: 'Emma', amount: 2500 },
    { from: 'David', to: 'Emma', amount: 2500 },
    { from: 'Charlie', to: 'Bob', amount: 1500 },
  ];

  // Ledger entries matching the 5-person settlement
  const sampleLedger = [
    {
      seq: '001',
      date: '2026-09-25 17:40',
      type: 'EXPENSE',
      payer: 'Bob',
      recipient: 'Charlie',
      baseAmount: '$40.00',
      origAmount: '€36.36 EUR',
      rate: '1.10',
      isStale: false,
      direction: 'DEBIT',
    },
    {
      seq: '002',
      date: '2026-09-25 17:41',
      type: 'EXPENSE',
      payer: 'Emma',
      recipient: 'Charlie',
      baseAmount: '$35.00',
      origAmount: '$35.00 USD',
      rate: '1.00',
      isStale: false,
      direction: 'DEBIT',
    },
    {
      seq: '003',
      date: '2026-09-25 17:42',
      type: 'SETTLEMENT',
      payer: 'Alice',
      recipient: 'Emma',
      baseAmount: '$25.00',
      origAmount: '$25.00 USD',
      rate: '1.00',
      isStale: false,
      direction: 'CREDIT',
    },
    {
      seq: '004',
      date: '2026-09-25 17:42',
      type: 'SETTLEMENT',
      payer: 'David',
      recipient: 'Emma',
      baseAmount: '$25.00',
      origAmount: '$25.00 USD',
      rate: '1.00',
      isStale: false,
      direction: 'CREDIT',
    },
    {
      seq: '005',
      date: '2026-09-25 17:42',
      type: 'SETTLEMENT',
      payer: 'Charlie',
      recipient: 'Bob',
      baseAmount: '$15.00',
      origAmount: '£11.81 GBP',
      rate: '1.27',
      isStale: true,
      direction: 'CREDIT',
    },
  ];

  return (
    <main className="min-h-screen bg-ledger-canvas text-bone flex flex-col justify-between">
      {/* Masthead */}
      <header className="border-b border-ledger-border bg-ledger-panel">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-2xl tracking-tight text-bone font-medium">
              SettleUp
            </h1>
            <span className="text-xs text-bone-muted font-sans hidden md:inline">
              Multi-party debt netting and immutable transaction ledger
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="text-bone-muted hidden sm:inline">
              Base Currency: <strong className="text-bone font-medium">USD ($)</strong>
            </span>
            <Link
              href="/dashboard"
              className="py-1.5 px-3.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors"
            >
              Open Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <div className="max-w-7xl mx-auto px-6 py-8 w-full space-y-8 flex-1">
        {/* Architectural Principles Strip */}
        <section className="border border-ledger-border bg-ledger-panel grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-ledger-border">
          <div className="p-4">
            <span className="text-[11px] font-sans text-bone-muted block mb-1">
              Direct Cycle Netting
            </span>
            <div className="text-base font-sans font-medium text-bone">
              O(V + E) Resolution
            </div>
            <p className="text-xs text-bone-dark font-sans mt-1">
              Resolves multi-party payment loops into minimum bilateral transfers.
            </p>
          </div>

          <div className="p-4">
            <span className="text-[11px] font-sans text-bone-muted block mb-1">
              Exact Penny Arithmetic
            </span>
            <div className="text-base font-sans font-medium text-credit">
              Integer Cents Storage
            </div>
            <p className="text-xs text-bone-dark font-sans mt-1">
              Strict integer arithmetic prevents IEEE 754 floating-point drift.
            </p>
          </div>

          <div className="p-4">
            <span className="text-[11px] font-sans text-bone-muted block mb-1">
              Audit Trail
            </span>
            <div className="text-base font-sans font-medium text-bone">
              Append-Only Journal
            </div>
            <p className="text-xs text-bone-dark font-sans mt-1">
              Write-once double entries; record mutations are barred by database schema.
            </p>
          </div>

          <div className="p-4">
            <span className="text-[11px] font-sans text-bone-muted block mb-1">
              Consistency Guarantees
            </span>
            <div className="text-base font-sans font-medium text-brass">
              Atomic Transactions
            </div>
            <p className="text-xs text-bone-dark font-sans mt-1">
              Reciprocal journal entries commit in all-or-nothing database sessions.
            </p>
          </div>
        </section>

        {/* View Switcher and Auxiliary Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-ledger-border pb-3">
          <div className="flex gap-6 text-xs font-mono">
            <button
              onClick={() => setActiveTab('graph')}
              className={`pb-1 transition-colors ${
                activeTab === 'graph'
                  ? 'border-b-2 border-bone text-bone font-medium'
                  : 'text-bone-muted hover:text-bone'
              }`}
            >
              Debt Settlement Graph
            </button>
            <button
              onClick={() => setActiveTab('ledger')}
              className={`pb-1 transition-colors ${
                activeTab === 'ledger'
                  ? 'border-b-2 border-bone text-bone font-medium'
                  : 'text-bone-muted hover:text-bone'
              }`}
            >
              Transaction Journal
            </button>
          </div>

          <button
            onClick={() => setShowDemoError(!showDemoError)}
            type="button"
            className="text-xs font-mono underline hover:text-bone text-bone-dark transition-colors self-start sm:self-auto"
          >
            {showDemoError ? 'Hide constraint demo' : 'Simulate constraint deadlock'}
          </button>
        </div>

        {/* Error Callout Demo */}
        {showDemoError && (
          <ErrorCallout
            error={{
              code: 'CONSTRAINT_DEADLOCK',
              message:
                'Settlement cannot proceed: Alice has a direct avoidance rule with Bob, and all remaining intermediaries in the group have mutual constraints.',
              details: [
                { field: 'rule_1', message: 'avoid: [Alice, Bob] requested by Alice' },
                { field: 'rule_2', message: 'avoid: [Charlie, Bob] requested by Charlie' },
              ],
            }}
            onRetry={() => setShowDemoError(false)}
            onDismiss={() => setShowDemoError(false)}
          />
        )}

        {/* Tab 1: Debt Graph Visualization */}
        {activeTab === 'graph' && (
          <section>
            <DebtGraph
              participants={participants}
              rawDebts={rawDebts}
              settlementDebts={settlementDebts}
              currency="USD"
            />
          </section>
        )}

        {/* Tab 2: Append-Only Immutable Ledger */}
        {activeTab === 'ledger' && (
          <section className="border border-ledger-border bg-ledger-panel overflow-x-auto">
            <div className="p-4 border-b border-ledger-border flex items-center justify-between">
              <div>
                <h3 className="font-display text-base text-bone font-medium">
                  Append-Only Journal Entries
                </h3>
                <p className="text-xs text-bone-muted font-sans">
                  Write-once double-entry records. Mutations are rejected at the data tier.
                </p>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 bg-ledger-subpanel border border-ledger-border text-credit">
                Reconciled: Net Sum = $0.00
              </span>
            </div>

            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-ledger-border bg-ledger-subpanel text-bone-muted uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-4 font-normal">Seq</th>
                  <th className="py-2.5 px-4 font-normal">Date & Time</th>
                  <th className="py-2.5 px-4 font-normal">Type</th>
                  <th className="py-2.5 px-4 font-normal">Debtor (Owes)</th>
                  <th className="py-2.5 px-4 font-normal">Creditor (Receives)</th>
                  <th className="py-2.5 px-4 font-normal text-right">Base Amount (USD)</th>
                  <th className="py-2.5 px-4 font-normal text-right">Original (FX)</th>
                  <th className="py-2.5 px-4 font-normal text-center">FX Rate Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ledger-border">
                {sampleLedger.map((row) => (
                  <tr key={row.seq} className="hover:bg-ledger-subpanel/50 transition-colors">
                    <td className="py-3 px-4 text-bone-dark">{row.seq}</td>
                    <td className="py-3 px-4 text-bone-muted">{row.date}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-1.5 py-0.5 text-[10px] border ${
                          row.type === 'SETTLEMENT'
                            ? 'border-credit/40 text-credit bg-credit/10'
                            : 'border-ledger-border text-bone-muted bg-ledger-subpanel'
                        }`}
                      >
                        {row.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-debt-light font-medium">{row.payer}</td>
                    <td className="py-3 px-4 text-credit font-medium">{row.recipient}</td>
                    <td className="py-3 px-4 text-right text-bone font-medium tabular-nums">
                      {row.baseAmount}
                    </td>
                    <td className="py-3 px-4 text-right text-bone-muted tabular-nums">
                      {row.origAmount}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {row.isStale ? (
                        <span className="px-1.5 py-0.5 text-[9px] border border-amber-800 bg-amber-950/80 text-amber-300">
                          Stale FX @ {row.rate}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[9px] border border-zinc-800 bg-zinc-900 text-zinc-400">
                          Live @ {row.rate}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-ledger-border bg-ledger-panel py-4 text-xs font-mono text-bone-dark">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>SettleUp Debt Netting Engine</span>
          <span>Integer-Cent Ledger Architecture</span>
        </div>
      </footer>
    </main>
  );
}
