'use client';

import React from 'react';

/**
 * Global Root Error Boundary for Next.js 14 App Router.
 * 
 * Must render its own <html> and <body> tags because it replaces
 * the root layout in the event of an unhandled top-level failure.
 */
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body className="m-0 p-0 bg-[#09090b] text-zinc-100 font-sans antialiased min-h-screen flex items-center justify-center">
        <main className="w-full max-w-lg p-8 border border-zinc-800 bg-[#121214] mx-4 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 mb-4">
            <span className="w-3 h-3 rounded-full bg-rose-600 animate-ping" />
            <span className="font-mono text-xs uppercase tracking-widest text-zinc-400">
              Critical Engine Exception
            </span>
          </div>

          <h1 className="text-xl font-medium tracking-tight text-white mb-2">
            Application Failure Intercepted
          </h1>

          <p className="text-xs text-zinc-400 leading-relaxed mb-4">
            An unrecoverable exception occurred in the root application tree.
            No persistent ledger data was modified during this failure.
          </p>

          <div className="p-3 bg-[#0d0d0f] border border-zinc-800 text-xs font-mono text-rose-300 mb-6 break-all">
            {error?.message || 'Critical system failure'}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={() => reset()}
              type="button"
              className="px-4 py-2 text-xs font-mono tracking-tight bg-zinc-100 hover:bg-white text-zinc-950 font-semibold transition-colors"
            >
              Restart Application Core
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
