'use client';

import React, { useEffect, useState } from 'react';

/**
 * Route-level Error Boundary for Next.js 14 App Router.
 * 
 * Avoids generic templates. Features:
 * - Monospaced crash metadata and digest tags
 * - Technical trace accordion for pair programmers and interviewers
 * - Graceful client retry mechanism
 */
export default function ErrorBoundary({ error, reset }) {
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    // Log exception to client monitoring / console
    console.error('[UI_UNHANDLED_EXCEPTION]', error);
  }, [error]);

  return (
    <div className="min-h-[500px] flex items-center justify-center p-6 bg-ledger-canvas text-bone font-sans">
      <div className="w-full max-w-xl border border-ledger-border bg-ledger-panel p-8">
        <div className="flex items-center justify-between border-b border-ledger-border pb-4 mb-6">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-debt" />
            <span className="text-xs font-mono text-bone-muted">
              System Boundary Intercept
            </span>
          </div>
          {error?.digest && (
            <span className="text-[10px] font-mono bg-ledger-subpanel border border-ledger-border px-2 py-0.5 text-bone-dark">
              Digest: {error.digest}
            </span>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight text-bone font-display">
            Runtime Component Fault
          </h2>
          <p className="text-xs text-bone-muted leading-relaxed font-sans">
            The application encountered an unexpected state while rendering this segment.
            The active state has been isolated to prevent corruption of the ledger.
          </p>

          <div className="p-3 my-3 bg-ledger-subpanel border border-ledger-border text-xs font-mono text-debt-light">
            {error?.message || 'Unknown render exception'}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-ledger-border flex items-center justify-between">
          <button
            onClick={() => setShowTrace(!showTrace)}
            type="button"
            className="text-[11px] font-mono text-bone-dark hover:text-bone-muted transition-colors underline underline-offset-4"
          >
            {showTrace ? 'Hide stack trace' : 'View stack trace'}
          </button>

          <button
            onClick={() => reset()}
            type="button"
            className="px-4 py-2 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors"
          >
            Re-render View
          </button>
        </div>

        {showTrace && error?.stack && (
          <pre className="mt-4 p-3 bg-ledger-canvas border border-ledger-border text-[10px] font-mono text-bone-dark overflow-x-auto max-h-48 whitespace-pre">
            {error.stack}
          </pre>
        )}
      </div>
    </div>
  );
}
