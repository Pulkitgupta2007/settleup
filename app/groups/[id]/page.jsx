'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DebtGraph from '@/src/components/DebtGraph';
import ErrorCallout from '@/src/components/ErrorCallout';
import { formatCents, formatSignedCents, formatLedgerTimestamp } from '@/src/lib/formatters';

export default function GroupDetailPage({ params }) {
  const { id } = params;
  const { data: session, status } = useSession();
  const router = useRouter();

  const [groupData, setGroupData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Add Member State
  const [showAddMember, setShowAddMember] = useState(false);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  // Quick Demo Add State
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');

  // Constraint Management State
  const [showConstraintModal, setShowConstraintModal] = useState(false);
  const [constraintAvoidFrom, setConstraintAvoidFrom] = useState('');
  const [constraintAvoidTo, setConstraintAvoidTo] = useState('');

  // Ledger Filter State
  const [ledgerFilter, setLedgerFilter] = useState('ALL'); // 'ALL' | 'EXPENSE' | 'SETTLEMENT'

  // CSV Export State
  const [exporting, setExporting] = useState(false);

  // Invite Link State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteData, setInviteData] = useState(null);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [regeneratingInvite, setRegeneratingInvite] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchGroup = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/groups/${id}`);
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error?.message || 'Failed to load group');
      }

      setGroupData(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (session?.user) {
      fetchGroup();
    }
  }, [session, fetchGroup]);

  // Load available users when add member modal opens
  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const json = await res.json();
      if (json.success) {
        setAvailableUsers(json.data || []);
      }
    } catch {
      // Ignore user search failure
    }
  };

  const handleOpenAddMember = () => {
    setShowAddMember(true);
    fetchUsers();
  };

  const handleAddExistingMember = async (e) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setAddingMember(true);
    setError(null);

    try {
      const res = await fetch(`/api/groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_member',
          userId: selectedUserId,
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to add member');

      setActionSuccess('Member successfully added to group.');
      setShowAddMember(false);
      setSelectedUserId('');
      fetchGroup();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleCreateAndAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberName || !newMemberEmail) return;
    setAddingMember(true);
    setError(null);

    try {
      // 1. Create or find user
      const userRes = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMemberName,
          email: newMemberEmail,
        }),
      });
      const userJson = await userRes.json();
      if (!userJson.success) throw new Error(userJson.error?.message || 'Failed to register member');

      // 2. Add to group
      const res = await fetch(`/api/groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_member',
          userId: userJson.data._id,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to add member to group');

      setActionSuccess(`Added ${newMemberName} to group.`);
      setShowAddMember(false);
      setNewMemberName('');
      setNewMemberEmail('');
      fetchGroup();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const handleAddConstraint = async (e) => {
    e.preventDefault();
    if (!constraintAvoidFrom || !constraintAvoidTo) return;
    setError(null);

    try {
      const res = await fetch(`/api/groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_constraint',
          avoid: [constraintAvoidFrom, constraintAvoidTo],
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to save constraint');

      setActionSuccess('Avoidance constraint added. Debt graph recalculating.');
      setShowConstraintModal(false);
      setConstraintAvoidFrom('');
      setConstraintAvoidTo('');
      fetchGroup();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveConstraint = async (index) => {
    try {
      const res = await fetch(`/api/groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_constraint',
          constraintIndex: index,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to remove constraint');

      setActionSuccess('Constraint removed.');
      fetchGroup();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      setError(null);
      const res = await fetch(`/api/groups/${id}/export`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error?.message || `Export failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (groupData?.group?.name || 'group').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      a.download = `${safeName}_ledger.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setActionSuccess('Ledger transaction history downloaded as CSV.');
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const fetchInvite = useCallback(async () => {
    try {
      setLoadingInvite(true);
      const res = await fetch(`/api/groups/${id}/invite`);
      const json = await res.json();
      if (json.success) {
        setInviteData(json.data);
      } else {
        throw new Error(json.error?.message || 'Failed to fetch invite link');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInvite(false);
    }
  }, [id]);

  const handleOpenInviteModal = () => {
    setShowInviteModal(true);
    fetchInvite();
  };

  const handleCopyInvite = async () => {
    if (!inviteData?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteData.inviteUrl);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    }
  };

  const handleRegenerateInvite = async () => {
    try {
      setRegeneratingInvite(true);
      setError(null);
      const res = await fetch(`/api/groups/${id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryDays: 7 }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed to regenerate invite link');
      setInviteData(json.data);
      setActionSuccess('New invite link generated! Any previous links have been revoked.');
    } catch (err) {
      setError(err.message);
    } finally {
      setRegeneratingInvite(false);
    }
  };

  if (status === 'loading' || (loading && !groupData)) {
    return (
      <main className="min-h-screen bg-ledger-canvas text-bone flex items-center justify-center p-6">
        <div className="font-mono text-xs text-bone-muted flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-credit animate-pulse" />
          Loading Group Debt Topology...
        </div>
      </main>
    );
  }

  const { group, membersWithBalances = [], ledgerEntries = [], rawDebts = [], settlementDebts = [], isFullySettled } = groupData || {};
  const participantNames = membersWithBalances.map(m => m.name);

  // Filtered ledger entries
  const filteredLedger = ledgerEntries.filter(entry => {
    if (ledgerFilter === 'ALL') return true;
    if (ledgerFilter === 'EXPENSE') return entry.entryType === 'EXPENSE';
    if (ledgerFilter === 'SETTLEMENT') return entry.entryType === 'SETTLEMENT';
    return true;
  });

  return (
    <main className="min-h-screen bg-ledger-canvas text-bone flex flex-col justify-between">
      {/* Top Navigation */}
      <header className="border-b border-ledger-border bg-ledger-panel sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-xs font-mono text-bone-muted hover:text-bone transition-colors"
            >
              Dashboard
            </Link>
            <span className="text-bone-dark">/</span>
            <h1 className="font-display text-base font-medium tracking-tight text-bone">
              {group?.name}
            </h1>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exporting}
              className="py-1.5 px-3 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone-muted hover:text-bone transition-colors disabled:opacity-50"
              title="Download complete ledger transaction history as CSV"
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>

            <Link
              href={`/groups/${id}/expenses/new`}
              className="py-1.5 px-3.5 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors"
            >
              Add expense
            </Link>

            <Link
              href={`/groups/${id}/settle`}
              className={`py-1.5 px-3.5 text-xs font-mono border transition-colors ${
                isFullySettled
                  ? 'border-ledger-border bg-ledger-subpanel text-bone-muted opacity-80 hover:text-bone'
                  : 'border-credit bg-credit text-white font-semibold hover:bg-credit/90'
              }`}
            >
              {isFullySettled ? 'Review settlement' : 'Settle up'}
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-6 py-8 w-full space-y-8 flex-1">
        {error && <ErrorCallout error={{ message: error }} onDismiss={() => setError(null)} />}

        {actionSuccess && (
          <div className="p-3 border border-credit/40 bg-credit/10 text-credit text-xs font-mono flex items-center justify-between">
            <span>{actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)} className="text-credit hover:text-white">✕</button>
          </div>
        )}

        {/* Group Information Bar */}
        <section className="border border-ledger-border bg-ledger-panel p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-ledger-border">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="font-display text-2xl font-medium tracking-tight text-bone">
                  {group?.name}
                </h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 border border-ledger-border bg-ledger-subpanel text-bone">
                  Base: {group?.baseCurrency}
                </span>
                <span
                  className={`text-[10px] font-mono uppercase px-2 py-0.5 border ${
                    isFullySettled
                      ? 'border-credit/50 bg-credit/10 text-credit'
                      : 'border-debt/50 bg-debt/10 text-debt-light'
                  }`}
                >
                  {isFullySettled ? 'Fully settled' : 'Settlement pending'}
                </span>
              </div>
              <p className="text-xs text-bone-muted font-sans">
                {group?.description || 'Append-only ledger group with multi-currency conversion.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenInviteModal}
                type="button"
                className="py-1 px-3 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone transition-colors"
                title="Generate and copy shareable group invite link"
              >
                Invite link
              </button>
              <button
                onClick={handleOpenAddMember}
                type="button"
                className="py-1 px-3 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone transition-colors"
              >
                Add member
              </button>
              <button
                onClick={() => setShowConstraintModal(true)}
                type="button"
                className="py-1 px-3 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone transition-colors"
              >
                Constraints ({group?.constraints?.length || 0})
              </button>
            </div>
          </div>

          {/* Members Balances Strip */}
          <div className="pt-4">
            <span className="text-xs font-sans text-bone-muted block mb-3">
              Participant standing ({membersWithBalances.length})
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {membersWithBalances.map((m) => {
                const isCreditor = m.netBalanceCents > 0;
                const isDebtor = m.netBalanceCents < 0;
                const isMe = m._id === session?.user?.id;

                return (
                  <div
                    key={m._id}
                    className={`border p-2.5 transition-colors ${
                      isMe ? 'border-bone-dark bg-ledger-subpanel' : 'border-ledger-border bg-ledger-panel'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-sans text-xs text-bone font-medium truncate">
                        {m.name} {isMe && '(You)'}
                      </span>
                    </div>
                    <div
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        isCreditor ? 'text-credit' : isDebtor ? 'text-debt' : 'text-bone-muted'
                      }`}
                    >
                      {formatSignedCents(m.netBalanceCents, group?.baseCurrency)}
                    </div>
                    <span className="text-[10px] font-sans text-bone-dark block">
                      {isCreditor ? 'Receives' : isDebtor ? 'Pays' : 'Balanced'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Add Member Modal / Drawer */}
        {showAddMember && (
          <div className="border border-ledger-border bg-ledger-panel p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-ledger-border pb-3">
              <h3 className="font-display text-base font-medium text-bone">
                Add Participant to Group
              </h3>
              <button
                onClick={() => setShowAddMember(false)}
                className="text-xs font-mono text-bone-muted hover:text-bone"
              >
                ✕ Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Option A: Select from existing users */}
              <form onSubmit={handleAddExistingMember} className="space-y-3">
                <h4 className="text-xs font-mono uppercase tracking-wider text-bone-dark">
                  Select Existing User
                </h4>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
                >
                  <option value="">-- Choose User --</option>
                  {availableUsers
                    .filter((u) => !membersWithBalances.some((m) => m._id === u._id))
                    .map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                </select>

                <button
                  type="submit"
                  disabled={!selectedUserId || addingMember}
                  className="py-1.5 px-4 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:opacity-50"
                >
                  {addingMember ? 'Adding...' : 'Add to Group'}
                </button>
              </form>

              {/* Option B: Invite/Create New User */}
              <form onSubmit={handleCreateAndAddMember} className="space-y-3">
                <h4 className="text-xs font-mono uppercase tracking-wider text-bone-dark">
                  Or Create New Member
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="Name (e.g. David)"
                    className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
                  />
                  <input
                    type="email"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="david@example.com"
                    className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!newMemberName || !newMemberEmail || addingMember}
                  className="py-1.5 px-4 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:opacity-50"
                >
                  {addingMember ? 'Creating...' : 'Create & Add'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Constraint Management Drawer */}
        {showConstraintModal && (
          <div className="border border-ledger-border bg-ledger-panel p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-ledger-border pb-3">
              <div>
                <h3 className="font-display text-base font-medium text-bone">
                  Avoidance Constraints
                </h3>
                <p className="text-xs font-mono text-bone-muted">
                  Enforce that two participants never settle directly. The algorithm routes through an intermediary.
                </p>
              </div>
              <button
                onClick={() => setShowConstraintModal(false)}
                className="text-xs font-mono text-bone-muted hover:text-bone"
              >
                ✕ Close
              </button>
            </div>

            {/* Existing constraints */}
            {group?.constraints?.length > 0 ? (
              <div className="space-y-2">
                {group.constraints.map((c, idx) => {
                  const name1 = membersWithBalances.find((m) => m._id === c.avoid[0])?.name || c.avoid[0];
                  const name2 = membersWithBalances.find((m) => m._id === c.avoid[1])?.name || c.avoid[1];

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 border border-ledger-border bg-ledger-subpanel text-xs font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-brass">⚠ No Direct Settlement:</span>
                        <strong className="text-bone">{name1}</strong>
                        <span className="text-bone-dark">↮</span>
                        <strong className="text-bone">{name2}</strong>
                      </div>
                      <button
                        onClick={() => handleRemoveConstraint(idx)}
                        className="text-debt hover:text-white px-2 py-0.5 border border-debt/30"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs font-mono text-bone-dark">
                No avoidance constraints configured for this group.
              </p>
            )}

            {/* Add constraint form */}
            <form onSubmit={handleAddConstraint} className="pt-3 border-t border-ledger-border space-y-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-bone-dark block">
                Add Avoidance Rule
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={constraintAvoidFrom}
                  onChange={(e) => setConstraintAvoidFrom(e.target.value)}
                  className="px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone"
                >
                  <option value="">-- Member 1 --</option>
                  {membersWithBalances.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name}
                    </option>
                  ))}
                </select>

                <select
                  value={constraintAvoidTo}
                  onChange={(e) => setConstraintAvoidTo(e.target.value)}
                  className="px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone"
                >
                  <option value="">-- Member 2 --</option>
                  {membersWithBalances
                    .filter((m) => m._id !== constraintAvoidFrom)
                    .map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={!constraintAvoidFrom || !constraintAvoidTo}
                className="py-1.5 px-4 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:opacity-50"
              >
                Add Rule
              </button>
            </form>
          </div>
        )}

        {/* Shareable Invite Modal / Panel */}
        {showInviteModal && (
          <div className="border border-ledger-border bg-ledger-panel p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-ledger-border pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-credit">🔗</span>
                  <h3 className="font-display text-base font-medium text-bone">
                    Shareable Group Invite Link
                  </h3>
                </div>
                <p className="text-xs font-mono text-bone-muted mt-0.5">
                  Anyone with this link can join this group. Unauthenticated users will be redirected to sign in or register first.
                </p>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-xs font-mono text-bone-muted hover:text-bone"
              >
                ✕ Close
              </button>
            </div>

            {loadingInvite ? (
              <div className="py-6 text-center text-xs font-mono text-bone-muted animate-pulse">
                Loading invite link details...
              </div>
            ) : inviteData ? (
              <div className="space-y-4">
                {/* Link display & Copy */}
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-bone-dark mb-1">
                    Invite URL (7-Day Sliding Expiry)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteData.inviteUrl || ''}
                      className="flex-1 px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone select-all focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      className="py-2 px-4 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors flex items-center gap-1.5"
                    >
                      <span>{copiedInvite ? '✓' : '📋'}</span>
                      <span>{copiedInvite ? 'Copied!' : 'Copy Link'}</span>
                    </button>
                  </div>
                </div>

                {/* Status & Expiration info */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 border border-ledger-border bg-ledger-subpanel text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-bone-dark">Status:</span>
                    {inviteData.isExpired ? (
                      <span className="text-debt font-semibold">Expired</span>
                    ) : (
                      <span className="text-credit font-semibold">Active & Valid</span>
                    )}
                    {inviteData.expiresAt && (
                      <span className="text-bone-muted">
                        (Expires {new Date(inviteData.expiresAt).toLocaleDateString()} at {new Date(inviteData.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={regeneratingInvite}
                    onClick={handleRegenerateInvite}
                    className="py-1 px-3 text-xs font-mono border border-ledger-border hover:border-bone text-bone transition-colors disabled:opacity-50"
                    title="Immediately invalidates previous links and generates a new code"
                  >
                    {regeneratingInvite ? 'Regenerating...' : '🔄 Revoke & Regenerate'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-4 text-xs font-mono text-debt">
                Failed to load invite link. Please try again.
              </div>
            )}
          </div>
        )}

        {/* SECTION: Plain SVG Debt Graph Visualization */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-ledger-border pb-2">
            <div>
              <h3 className="font-display text-lg text-bone font-medium">
                Debt Settlement Topology
              </h3>
              <p className="text-xs text-bone-muted font-sans">
                Direct cycle netting and optimal transfer reduction.
              </p>
            </div>
            {settlementDebts.length > 0 && (
              <Link
                href={`/groups/${id}/settle`}
                className="text-xs font-mono text-credit hover:underline underline-offset-4"
              >
                Execute settlement
              </Link>
            )}
          </div>

          {membersWithBalances.length >= 2 ? (
            <DebtGraph
              participants={participantNames}
              rawDebts={rawDebts}
              settlementDebts={settlementDebts}
              currency={group?.baseCurrency || 'USD'}
            />
          ) : (
            <div className="border border-ledger-border bg-ledger-panel p-8 text-center space-y-2">
              <p className="text-xs font-mono text-bone-muted">
                At least 2 members are required to construct a debt graph.
              </p>
              <button
                onClick={handleOpenAddMember}
                className="py-1.5 px-3 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors"
              >
                Add members
              </button>
            </div>
          )}
        </section>

        {/* SECTION: Double-Entry Immutable Ledger Journal */}
        <section className="space-y-4 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-ledger-border gap-3">
            <div>
              <h3 className="font-display text-lg text-bone font-medium">
                Append-Only Transaction Journal
              </h3>
              <p className="text-xs text-bone-muted font-sans">
                Immutable financial record. Mutations and deletions are prohibited by schema guards.
              </p>
            </div>

            {/* Filter buttons */}
            <div className="flex border border-ledger-border bg-ledger-subpanel p-0.5 text-xs font-mono">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'EXPENSE', label: 'Expenses' },
                { key: 'SETTLEMENT', label: 'Settlements' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLedgerFilter(key)}
                  className={`px-3 py-1 transition-colors ${
                    ledgerFilter === key ? 'bg-ledger-highlight text-bone font-medium' : 'text-bone-muted hover:text-bone'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Ledger Table */}
          <div className="border border-ledger-border bg-ledger-panel overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-ledger-border bg-ledger-subpanel text-bone-dark uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-4 font-normal">Date & Time</th>
                  <th className="py-2.5 px-4 font-normal">Type</th>
                  <th className="py-2.5 px-4 font-normal">Account</th>
                  <th className="py-2.5 px-4 font-normal">Counterparty</th>
                  <th className="py-2.5 px-4 font-normal text-right">Signed Net ({group?.baseCurrency})</th>
                  <th className="py-2.5 px-4 font-normal text-right">Original FX</th>
                  <th className="py-2.5 px-4 font-normal">FX Audit</th>
                  <th className="py-2.5 px-4 font-normal">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ledger-border">
                {filteredLedger.map((entry) => {
                  const isCredit = entry.signedAmount > 0;
                  const isDebit = entry.signedAmount < 0;
                  const dateStr = formatLedgerTimestamp(entry.createdAt);

                  return (
                    <tr key={entry._id} className="hover:bg-ledger-subpanel/50 transition-colors">
                      <td className="py-2.5 px-4 text-bone-muted whitespace-nowrap">
                        {dateStr}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span
                          className={`text-[9px] uppercase px-1.5 py-0.5 border ${
                            entry.entryType === 'SETTLEMENT'
                              ? 'border-credit/40 bg-credit/10 text-credit'
                              : 'border-ledger-border bg-ledger-subpanel text-bone-muted'
                          }`}
                        >
                          {entry.entryType}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-bone whitespace-nowrap">
                        {entry.user?.name || entry.user?.email || 'Unknown User'}
                      </td>
                      <td className="py-2.5 px-4 text-bone-muted whitespace-nowrap">
                        {entry.counterparty?.name || entry.counterparty?.email || '—'}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-semibold whitespace-nowrap ${
                          isCredit ? 'text-credit' : isDebit ? 'text-debt' : 'text-bone'
                        }`}
                      >
                        {formatSignedCents(entry.signedAmount, group?.baseCurrency)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-bone-muted whitespace-nowrap">
                        {entry.originalCurrency !== group?.baseCurrency ? (
                          <span>
                            {formatCents(entry.originalAmount, entry.originalCurrency)} {entry.originalCurrency}
                          </span>
                        ) : (
                          <span className="text-bone-dark">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {entry.originalCurrency !== group?.baseCurrency ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-bone-dark">
                              ×{entry.exchangeRate?.toFixed(4)}
                            </span>
                            {entry.isFxStale && (
                              <span className="text-[9px] uppercase px-1 py-0.2 border border-brass/50 bg-brass/10 text-brass">
                                Stale FX
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-bone-dark text-[10px]">1:1 Base</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-bone-muted max-w-xs truncate">
                        {entry.notes || '—'}
                      </td>
                    </tr>
                  );
                })}

                {filteredLedger.length === 0 && (
                  <tr>
                    <td colSpan="8" className="py-8 text-center text-bone-dark text-xs font-mono">
                      No ledger entries match current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-ledger-border bg-ledger-panel py-4 text-xs font-mono text-bone-dark">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <span>{group?.name} Group Ledger</span>
          <span>Append-Only Journal Log</span>
        </div>
      </footer>
    </main>
  );
}
