'use client';

import React from 'react';

/**
 * Domain-specific error component rendering contextual, actionable error states
 * instead of generic "Something went wrong".
 * 
 * Distinctive, non-AI styling: sharp borders, muted carbon/zinc palette,
 * monospaced error tagging, and direct remediation advice.
 */
export default function ErrorCallout({
  error,
  type = 'error', // 'error' | 'warning' | 'stale-fx'
  onRetry,
  onDismiss,
}) {
  if (!error) return null;

  // Extract structured properties if it's an AppError object or string
  const errorCode = typeof error === 'object' ? error.code || 'UNKNOWN_ERROR' : 'ERROR';
  const errorMessage = typeof error === 'object' ? error.message : String(error);
  const details = typeof error === 'object' ? error.details : null;

  // Domain-specific tailored content
  let title = 'Operation Failed';
  let badgeColor = 'bg-rose-950 text-rose-300 border-rose-800';
  let containerBg = 'bg-[#18181b] border-rose-900/60 text-zinc-200';
  let actionAdvice = null;

  if (errorCode === 'CONSTRAINT_DEADLOCK') {
    title = 'Settlement Routing Deadlock';
    badgeColor = 'bg-amber-950 text-amber-300 border-amber-800';
    containerBg = 'bg-[#1a1714] border-amber-900/60 text-zinc-200';
    actionAdvice =
      'Two or more members have mutually exclusive payment avoidance rules with no available intermediary. Add a mutual connection to the group or remove direct payment constraints.';
  } else if (errorCode === 'PENNY_DISCREPANCY' || errorMessage.includes('does not match total')) {
    title = 'Penny Conservation Discrepancy';
    badgeColor = 'bg-amber-950 text-amber-300 border-amber-800';
    containerBg = 'bg-[#1a1714] border-amber-900/60 text-zinc-200';
    actionAdvice =
      'The split shares do not sum exactly to the total expense. Financial ledgers reject partial cents to prevent money loss or fabrication.';
  } else if (errorCode === 'TRANSACTION_ABORTED') {
    title = 'Atomic Transaction Rolled Back';
    badgeColor = 'bg-rose-950 text-rose-300 border-rose-800';
    containerBg = 'bg-[#18181b] border-rose-900/60 text-zinc-200';
    actionAdvice =
      'A database constraint or concurrent conflict interrupted the settlement write. MongoDB rolled back all entries; the ledger remains untainted.';
  } else if (type === 'stale-fx' || errorCode === 'FX_STALE') {
    title = 'Exchange Rates Degraded (Using Stale Cache)';
    badgeColor = 'bg-yellow-950 text-yellow-300 border-yellow-800';
    containerBg = 'bg-[#181816] border-yellow-900/60 text-zinc-200';
    actionAdvice =
      'The live FX provider timed out or is unreachable. Amounts were converted using the last verified rates and flagged in the immutable ledger.';
  }

  return (
    <div
      role="alert"
      className={`relative my-4 rounded-none border-l-4 border ${containerBg} p-4 font-sans shadow-none`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block px-1.5 py-0.5 text-[10px] font-mono tracking-wider uppercase border ${badgeColor}`}
            >
              {errorCode}
            </span>
            <h4 className="text-sm font-semibold tracking-tight text-zinc-100">
              {title}
            </h4>
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed font-normal">
            {errorMessage}
          </p>

          {actionAdvice && (
            <div className="mt-2 pt-2 border-t border-zinc-800 text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-300 uppercase tracking-wider text-[10px]">
                Recommended Resolution:{' '}
              </span>
              {actionAdvice}
            </div>
          )}

          {details && Array.isArray(details) && details.length > 0 && (
            <ul className="mt-2 space-y-1 pl-4 list-disc text-[11px] text-zinc-400 font-mono">
              {details.map((item, idx) => (
                <li key={idx}>
                  {item.field ? <strong className="text-zinc-300">{item.field}: </strong> : null}
                  {item.message || JSON.stringify(item)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          {onRetry && (
            <button
              onClick={onRetry}
              type="button"
              className="px-2.5 py-1 text-xs font-mono tracking-tight bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors"
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              type="button"
              className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors text-right"
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
