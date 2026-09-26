'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ErrorCallout from '@/src/components/ErrorCallout';
import { formatCents } from '@/src/lib/formatters';
import { calculatePercentageSplit, calculateSharesSplit } from '@/src/simplifier';

export default function NewExpensePage({ params }) {
  const { id } = params;
  const { data: session, status } = useSession();
  const router = useRouter();

  const [group, setGroup] = useState(null);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Form Fields
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [paidBy, setPaidBy] = useState('');

  // Split Mode: 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES'
  const [splitMode, setSplitMode] = useState('EQUAL');

  // Selected participants for equal split (Set of member user IDs)
  const [selectedParticipants, setSelectedParticipants] = useState(new Set());

  // Custom split amounts per member (map of memberId -> string amount)
  const [customAmounts, setCustomAmounts] = useState({});

  // Percentage split per member (map of memberId -> string percentage)
  const [percentages, setPercentages] = useState({});

  // Shares split per member (map of memberId -> string share count)
  const [shares, setShares] = useState({});

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Fetch group info to get members and base currency
  useEffect(() => {
    async function loadGroup() {
      try {
        setLoadingGroup(true);
        const res = await fetch(`/api/groups/${id}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message || 'Failed to load group');

        const g = json.data.group;
        setGroup(g);
        setCurrency(g.baseCurrency || 'USD');

        // Set default paidBy to logged in user if they are in the group
        const memberIds = (g.members || []).map(m => m._id.toString());
        setSelectedParticipants(new Set(memberIds));

        const myId = session?.user?.id;
        if (myId && memberIds.includes(myId)) {
          setPaidBy(myId);
        } else if (memberIds.length > 0) {
          setPaidBy(memberIds[0]);
        }

        // Initialize maps for split modes
        const initialCustom = {};
        const initialPercentages = {};
        const initialShares = {};
        for (const mId of memberIds) {
          initialCustom[mId] = '';
          initialPercentages[mId] = '';
          initialShares[mId] = '1';
        }
        setCustomAmounts(initialCustom);
        setPercentages(initialPercentages);
        setShares(initialShares);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingGroup(false);
      }
    }

    if (session?.user) {
      loadGroup();
    }
  }, [id, session]);

  // Parse total amount to integer cents
  const totalCents = Math.round((parseFloat(amountStr) || 0) * 100);

  // 1. Equal Split Calculation
  const computedEqualSplits = React.useMemo(() => {
    if (!group || totalCents <= 0) return [];
    const participants = Array.from(selectedParticipants);
    const n = participants.length;
    if (n === 0) return [];

    const baseCents = Math.floor(totalCents / n);
    const remainder = totalCents % n;

    return participants.map((userId, index) => {
      // First remainder members get 1 extra cent to preserve exact penny conservation
      const amount = index < remainder ? baseCents + 1 : baseCents;
      return { user: userId, amount };
    });
  }, [group, totalCents, selectedParticipants]);

  // 2. Custom Exact Split Calculation
  const customSumCents = React.useMemo(() => {
    let sum = 0;
    for (const val of Object.values(customAmounts)) {
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed > 0) {
        sum += Math.round(parsed * 100);
      }
    }
    return sum;
  }, [customAmounts]);

  const customDifferenceCents = totalCents - customSumCents;

  // 3. Percentage Split Calculation
  const percentageSum = React.useMemo(() => {
    let sum = 0;
    for (const val of Object.values(percentages)) {
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed > 0) {
        sum += parsed;
      }
    }
    return Math.round(sum * 100) / 100;
  }, [percentages]);

  const percentageDifference = Math.round((100 - percentageSum) * 100) / 100;

  const computedPercentageSplits = React.useMemo(() => {
    if (!group || totalCents <= 0 || Math.abs(percentageSum - 100) > 0.05) return [];
    try {
      const items = (group.members || []).map(m => ({
        user: m._id.toString(),
        percentage: parseFloat(percentages[m._id.toString()]) || 0,
      }));
      return calculatePercentageSplit(totalCents, items);
    } catch {
      return [];
    }
  }, [group, totalCents, percentages, percentageSum]);

  // 4. Shares Split Calculation
  const sharesSum = React.useMemo(() => {
    let sum = 0;
    for (const val of Object.values(shares)) {
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed > 0) {
        sum += parsed;
      }
    }
    return sum;
  }, [shares]);

  const computedSharesSplits = React.useMemo(() => {
    if (!group || totalCents <= 0 || sharesSum <= 0) return [];
    try {
      const items = (group.members || []).map(m => ({
        user: m._id.toString(),
        shares: parseFloat(shares[m._id.toString()]) || 0,
      }));
      return calculateSharesSplit(totalCents, items);
    } catch {
      return [];
    }
  }, [group, totalCents, shares, sharesSum]);

  const handleToggleParticipant = (memberId) => {
    const next = new Set(selectedParticipants);
    if (next.has(memberId)) {
      if (next.size === 1) return; // Must have at least 1 participant
      next.delete(memberId);
    } else {
      next.add(memberId);
    }
    setSelectedParticipants(next);
  };

  const handleCustomAmountChange = (memberId, val) => {
    setCustomAmounts(prev => ({
      ...prev,
      [memberId]: val,
    }));
  };

  const handlePercentageChange = (memberId, val) => {
    setPercentages(prev => ({
      ...prev,
      [memberId]: val,
    }));
  };

  const handleShareChange = (memberId, val) => {
    setShares(prev => ({
      ...prev,
      [memberId]: val,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (totalCents <= 0) {
      setError('Please enter a valid expense amount greater than 0.');
      return;
    }

    let finalSplits = [];
    if (splitMode === 'EQUAL') {
      if (selectedParticipants.size === 0) {
        setError('At least one member must be included in the split.');
        return;
      }
      finalSplits = computedEqualSplits;
    } else if (splitMode === 'EXACT') {
      if (customDifferenceCents !== 0) {
        const diffStr = (Math.abs(customDifferenceCents) / 100).toFixed(2);
        setError(
          customDifferenceCents > 0
            ? `Splits are short by $${diffStr}. Total must match exactly.`
            : `Splits exceed total by $${diffStr}. Total must match exactly.`
        );
        return;
      }

      finalSplits = Object.entries(customAmounts)
        .filter(([, val]) => parseFloat(val) > 0)
        .map(([userId, val]) => ({
          user: userId,
          amount: Math.round(parseFloat(val) * 100),
        }));
    } else if (splitMode === 'PERCENTAGE') {
      if (Math.abs(percentageSum - 100) > 0.01) {
        setError(
          percentageDifference > 0
            ? `Percentages are short by ${percentageDifference.toFixed(2)}%. Must sum to 100% exactly.`
            : `Percentages exceed 100% by ${Math.abs(percentageDifference).toFixed(2)}%. Must sum to 100% exactly.`
        );
        return;
      }
      finalSplits = computedPercentageSplits;
    } else if (splitMode === 'SHARES') {
      if (sharesSum <= 0) {
        setError('Total shares must be greater than 0.');
        return;
      }
      finalSplits = computedSharesSplits;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/groups/${id}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          paidBy,
          totalAmount: totalCents,
          currency,
          splitType: splitMode === 'CUSTOM' ? 'EXACT' : splitMode,
          splits: finalSplits,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message || 'Failed to record expense');
      }

      // Success -> Return to group detail
      router.push(`/groups/${id}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  if (loadingGroup) {
    return (
      <main className="min-h-screen bg-ledger-canvas text-bone flex items-center justify-center p-6">
        <div className="font-mono text-xs text-bone-muted">
          Loading group details...
        </div>
      </main>
    );
  }

  const members = group?.members || [];

  return (
    <main className="min-h-screen bg-ledger-canvas text-bone flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-ledger-border bg-ledger-panel">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/groups/${id}`}
              className="text-xs font-mono text-bone-muted hover:text-bone transition-colors"
            >
              Back to {group?.name}
            </Link>
            <span className="text-bone-dark">/</span>
            <span className="text-xs font-sans text-bone">
              Record Expense
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-4xl mx-auto px-6 py-8 w-full flex-1">
        <div className="border border-ledger-border bg-ledger-panel p-6 sm:p-8 space-y-6">
          <div className="border-b border-ledger-border pb-4">
            <h1 className="font-display text-2xl font-medium tracking-tight text-bone mb-1">
              Record Group Expense
            </h1>
            <p className="text-xs text-bone-muted font-sans">
              Transaction will append immutable double-entry records converted to base currency ({group?.baseCurrency}).
            </p>
          </div>

          {error && <ErrorCallout error={{ message: error }} onDismiss={() => setError(null)} />}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Description & Amount Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-mono uppercase tracking-wider text-bone-dark mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  placeholder="e.g. Kyoto Ryokan Dinner, Team Lunch, Airport Taxi"
                  className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-bone-dark mb-1">
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="INR">INR (₹)</option>
                  <option value="CAD">CAD (C$)</option>
                  <option value="JPY">JPY (¥)</option>
                </select>
                {currency !== group?.baseCurrency && (
                  <span className="text-[10px] font-mono text-brass mt-1 block">
                    Auto-converts to {group?.baseCurrency} at live FX rate
                  </span>
                )}
              </div>
            </div>

            {/* Amount & Paid By */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-bone-dark mb-1">
                  Total Amount ({currency})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    required
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
                  />
                  <div className="absolute right-3 top-2 text-xs font-mono text-bone-dark">
                    {totalCents > 0 ? `${totalCents} cents` : ''}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-bone-dark mb-1">
                  Paid By (Creditor)
                </label>
                <select
                  value={paidBy}
                  onChange={(e) => setPaidBy(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
                >
                  {members.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name} ({m.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Split Mode Selector */}
            <div className="pt-4 border-t border-ledger-border space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-medium text-bone">
                    Split Distribution
                  </h3>
                  <p className="text-xs font-mono text-bone-muted">
                    Deterministic conservation of cents across debtors.
                  </p>
                </div>

                <div className="flex flex-wrap border border-ledger-border bg-ledger-subpanel p-0.5 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setSplitMode('EQUAL')}
                    className={`px-3 py-1 transition-colors ${
                      splitMode === 'EQUAL'
                        ? 'bg-ledger-border text-bone font-medium'
                        : 'text-bone-muted hover:text-bone'
                    }`}
                  >
                    Equally
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitMode('EXACT')}
                    className={`px-3 py-1 transition-colors ${
                      splitMode === 'EXACT'
                        ? 'bg-ledger-border text-bone font-medium'
                        : 'text-bone-muted hover:text-bone'
                    }`}
                  >
                    Exact Amounts
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitMode('PERCENTAGE')}
                    className={`px-3 py-1 transition-colors ${
                      splitMode === 'PERCENTAGE'
                        ? 'bg-ledger-border text-bone font-medium'
                        : 'text-bone-muted hover:text-bone'
                    }`}
                  >
                    Percentages (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitMode('SHARES')}
                    className={`px-3 py-1 transition-colors ${
                      splitMode === 'SHARES'
                        ? 'bg-ledger-border text-bone font-medium'
                        : 'text-bone-muted hover:text-bone'
                    }`}
                  >
                    Shares (Ratio)
                  </button>
                </div>
              </div>

              {/* 1. EQUAL SPLIT MODE */}
              {splitMode === 'EQUAL' && (
                <div className="space-y-3">
                  <span className="text-[11px] font-mono text-bone-dark uppercase tracking-wider block">
                    Select Participants in this split:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {members.map((m) => {
                      const isIncluded = selectedParticipants.has(m._id);
                      const splitShare = computedEqualSplits.find(s => s.user === m._id);

                      return (
                        <div
                          key={m._id}
                          onClick={() => handleToggleParticipant(m._id)}
                          className={`flex items-center justify-between p-3 border cursor-pointer select-none transition-colors ${
                            isIncluded
                              ? 'border-bone-dark bg-ledger-subpanel text-bone'
                              : 'border-ledger-border bg-ledger-panel text-bone-dark hover:border-ledger-border-light'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isIncluded}
                              onChange={() => {}} // handled by parent div
                              className="accent-credit rounded-none"
                            />
                            <span className="text-xs font-mono font-medium">
                              {m.name}
                            </span>
                          </div>

                          {isIncluded && splitShare && (
                            <span className="text-xs font-mono text-credit font-semibold">
                              {formatCents(splitShare.amount, currency)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {totalCents > 0 && selectedParticipants.size > 0 && (
                    <div className="p-3 border border-ledger-border bg-ledger-subpanel text-xs font-mono text-bone-muted flex items-center justify-between">
                      <span>
                        Splitting between {selectedParticipants.size} members
                      </span>
                      <span>
                        Total Cents:{' '}
                        <strong className="text-bone">
                          {computedEqualSplits.reduce((acc, s) => acc + s.amount, 0)}¢
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 2. EXACT SPLIT MODE */}
              {splitMode === 'EXACT' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-bone-dark uppercase tracking-wider">
                      Specify exact amount for each member:
                    </span>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        customDifferenceCents === 0
                          ? 'text-credit'
                          : customDifferenceCents > 0
                          ? 'text-brass'
                          : 'text-debt'
                      }`}
                    >
                      {customDifferenceCents === 0
                        ? '✓ Exact match (Balanced)'
                        : customDifferenceCents > 0
                        ? `Remaining to allocate: $${(customDifferenceCents / 100).toFixed(2)}`
                        : `Over-allocated by: $${(Math.abs(customDifferenceCents) / 100).toFixed(2)}`}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {members.map((m) => (
                      <div
                        key={m._id}
                        className="flex items-center justify-between p-2.5 border border-ledger-border bg-ledger-subpanel"
                      >
                        <span className="text-xs font-mono text-bone">
                          {m.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-bone-dark">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={customAmounts[m._id] || ''}
                            onChange={(e) => handleCustomAmountChange(m._id, e.target.value)}
                            placeholder="0.00"
                            className="w-28 px-2 py-1 text-xs font-mono bg-ledger-panel border border-ledger-border text-bone text-right focus:border-bone focus:outline-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. PERCENTAGE SPLIT MODE */}
              {splitMode === 'PERCENTAGE' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-bone-dark uppercase tracking-wider">
                      Specify percentage for each member:
                    </span>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        Math.abs(percentageDifference) < 0.01
                          ? 'text-credit'
                          : percentageDifference > 0
                          ? 'text-brass'
                          : 'text-debt'
                      }`}
                    >
                      {Math.abs(percentageDifference) < 0.01
                        ? '✓ Exact 100.0% (Balanced)'
                        : percentageDifference > 0
                        ? `Remaining to allocate: ${percentageDifference.toFixed(1)}%`
                        : `Exceeds 100% by: ${Math.abs(percentageDifference).toFixed(1)}%`}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {members.map((m) => {
                      const share = computedPercentageSplits.find(s => s.user === m._id);

                      return (
                        <div
                          key={m._id}
                          className="flex items-center justify-between p-2.5 border border-ledger-border bg-ledger-subpanel"
                        >
                          <span className="text-xs font-mono text-bone">
                            {m.name}
                          </span>
                          <div className="flex items-center gap-3">
                            {share && (
                              <span className="text-xs font-mono text-credit font-semibold">
                                {formatCents(share.amount, currency)}
                              </span>
                            )}
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                max="100"
                                value={percentages[m._id] || ''}
                                onChange={(e) => handlePercentageChange(m._id, e.target.value)}
                                placeholder="0"
                                className="w-20 px-2 py-1 text-xs font-mono bg-ledger-panel border border-ledger-border text-bone text-right focus:border-bone focus:outline-none"
                              />
                              <span className="text-xs font-mono text-bone-dark">%</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {totalCents > 0 && Math.abs(percentageDifference) < 0.01 && (
                    <div className="p-3 border border-ledger-border bg-ledger-subpanel text-xs font-mono text-bone-muted flex items-center justify-between">
                      <span>Exact penny conservation across {members.length} members</span>
                      <span>
                        Total Cents:{' '}
                        <strong className="text-bone">
                          {computedPercentageSplits.reduce((acc, s) => acc + s.amount, 0)}¢
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 4. SHARES SPLIT MODE */}
              {splitMode === 'SHARES' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-bone-dark uppercase tracking-wider">
                      Specify relative shares (e.g. 2 for couple, 1 for single):
                    </span>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        sharesSum > 0 ? 'text-credit' : 'text-debt'
                      }`}
                    >
                      {sharesSum > 0
                        ? `Total Shares: ${sharesSum}`
                        : 'Enter at least 1 share'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {members.map((m) => {
                      const share = computedSharesSplits.find(s => s.user === m._id);
                      const memberShares = parseFloat(shares[m._id]) || 0;
                      const pctOfShares = sharesSum > 0 ? ((memberShares / sharesSum) * 100).toFixed(1) : '0.0';

                      return (
                        <div
                          key={m._id}
                          className="flex items-center justify-between p-2.5 border border-ledger-border bg-ledger-subpanel"
                        >
                          <span className="text-xs font-mono text-bone">
                            {m.name}
                          </span>
                          <div className="flex items-center gap-3">
                            {share && (
                              <div className="text-right">
                                <span className="text-xs font-mono text-bone-muted mr-2">
                                  ({pctOfShares}%)
                                </span>
                                <span className="text-xs font-mono text-credit font-semibold">
                                  {formatCents(share.amount, currency)}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={shares[m._id] || ''}
                                onChange={(e) => handleShareChange(m._id, e.target.value)}
                                placeholder="1"
                                className="w-20 px-2 py-1 text-xs font-mono bg-ledger-panel border border-ledger-border text-bone text-right focus:border-bone focus:outline-none"
                              />
                              <span className="text-xs font-mono text-bone-dark">share(s)</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {totalCents > 0 && sharesSum > 0 && (
                    <div className="p-3 border border-ledger-border bg-ledger-subpanel text-xs font-mono text-bone-muted flex items-center justify-between">
                      <span>Proportional penny conservation across {members.length} members</span>
                      <span>
                        Total Cents:{' '}
                        <strong className="text-bone">
                          {computedSharesSplits.reduce((acc, s) => acc + s.amount, 0)}¢
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="pt-6 border-t border-ledger-border flex items-center justify-between">
              <Link
                href={`/groups/${id}`}
                className="py-2 px-4 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone-muted hover:text-bone transition-colors"
              >
                Cancel
              </Link>

              <button
                type="submit"
                disabled={
                  submitting ||
                  totalCents <= 0 ||
                  (splitMode === 'EXACT' && customDifferenceCents !== 0) ||
                  (splitMode === 'PERCENTAGE' && Math.abs(percentageDifference) >= 0.01) ||
                  (splitMode === 'SHARES' && sharesSum <= 0)
                }
                className="py-2.5 px-6 text-xs font-mono tracking-tight bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors disabled:opacity-40"
              >
                {submitting ? 'Appending to Ledger...' : 'Record Expense'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-ledger-border bg-ledger-panel py-4 text-xs font-mono text-bone-dark">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between">
          <span>SettleUp Expense Entry</span>
          <span>Append-Only Journal Log</span>
        </div>
      </footer>
    </main>
  );
}
