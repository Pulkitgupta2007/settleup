'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import ErrorCallout from '@/src/components/ErrorCallout';

export default function JoinGroupPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const inviteCode = params?.inviteCode;

  const [state, setState] = useState({
    joining: false,
    success: false,
    group: null,
    message: '',
    error: null,
    countdown: 3,
  });

  // Handle unauthenticated: redirect to login with callbackUrl
  useEffect(() => {
    if (status === 'unauthenticated' && inviteCode) {
      const callback = `/join/${inviteCode}`;
      router.push(`/login?callbackUrl=${encodeURIComponent(callback)}`);
    }
  }, [status, inviteCode, router]);

  // When authenticated, execute join
  useEffect(() => {
    if (status === 'authenticated' && inviteCode && !state.joining && !state.success && !state.error) {
      let isMounted = true;

      const performJoin = async () => {
        setState(prev => ({ ...prev, joining: true, error: null }));
        try {
          const res = await fetch('/api/groups/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteCode }),
          });

          const data = await res.json();

          if (!res.ok || !data.success) {
            if (isMounted) {
              setState(prev => ({
                ...prev,
                joining: false,
                error: data.error || {
                  code: 'JOIN_FAILED',
                  message: data.message || 'Unable to join group with this invite link.',
                },
              }));
            }
            return;
          }

          if (isMounted) {
            setState(prev => ({
              ...prev,
              joining: false,
              success: true,
              group: data.data,
              message: data.message,
            }));
          }
        } catch (err) {
          if (isMounted) {
            setState(prev => ({
              ...prev,
              joining: false,
              error: {
                code: 'NETWORK_ERROR',
                message: err.message || 'Failed to connect to the server.',
              },
            }));
          }
        }
      };

      performJoin();

      return () => {
        isMounted = false;
      };
    }
  }, [status, inviteCode]);

  // Countdown timer for automatic redirection to group page upon success
  useEffect(() => {
    if (state.success && state.group?.groupId) {
      if (state.countdown <= 0) {
        router.push(`/groups/${state.group.groupId}`);
        return;
      }
      const timer = setTimeout(() => {
        setState(prev => ({ ...prev, countdown: prev.countdown - 1 }));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [state.success, state.countdown, state.group, router]);

  return (
    <main className="min-h-screen bg-ledger-canvas text-bone flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-ledger-border bg-ledger-panel p-8 shadow-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ledger-border pb-4 mb-6">
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-display text-xl font-medium tracking-tight text-bone">
              SettleUp
            </h1>
          </div>
          <span className="text-xs font-sans text-bone-muted">
            Group Invitation
          </span>
        </div>

        {/* 1. Loading / Authenticating State */}
        {status === 'loading' && (
          <div className="py-8 text-center space-y-3">
            <div className="text-xs font-mono text-bone-muted">
              Verifying authentication...
            </div>
          </div>
        )}

        {/* 2. Unauthenticated Redirecting State */}
        {status === 'unauthenticated' && (
          <div className="py-8 text-center space-y-4">
            <div className="text-sm font-medium text-bone">Authentication Required</div>
            <p className="text-xs font-mono text-bone-muted">
              Redirecting you to sign in or register... You will join this group automatically right after.
            </p>
            <div className="pt-2">
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(`/join/${inviteCode}`)}`}
                className="inline-block py-2 px-4 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone text-bone transition-colors"
              >
                Sign in
              </Link>
            </div>
          </div>
        )}

        {/* 3. Joining In-Progress State */}
        {status === 'authenticated' && state.joining && (
          <div className="py-8 text-center space-y-3">
            <div className="inline-block w-4 h-4 border-2 border-bone border-t-transparent animate-spin mb-2" />
            <div className="text-xs font-mono text-bone">Validating invite token and joining group...</div>
            <div className="text-[11px] font-mono text-bone-dark">Token: {inviteCode}</div>
          </div>
        )}

        {/* 4. Success State */}
        {status === 'authenticated' && state.success && state.group && (
          <div className="space-y-6">
            <div className="p-4 border border-ledger-border bg-ledger-subpanel space-y-2">
              <div className="text-xs font-sans text-credit">
                {state.group.alreadyMember ? 'Membership Active' : 'Invitation Accepted'}
              </div>
              <h2 className="text-base font-semibold text-bone">
                {state.group.groupName}
              </h2>
              <p className="text-xs font-mono text-bone-muted">
                {state.message}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs font-mono text-bone-dark">
                Redirecting in {state.countdown}s...
              </span>
              <Link
                href={`/groups/${state.group.groupId}`}
                className="py-2 px-4 text-xs font-mono font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                Open group
              </Link>
            </div>
          </div>
        )}

        {/* 5. Error State (Invalid / Expired / Rate Limited) */}
        {status === 'authenticated' && state.error && (
          <div className="space-y-6">
            <ErrorCallout error={state.error} />

            <div className="p-4 border border-ledger-border bg-ledger-subpanel text-xs font-mono text-bone-muted space-y-2">
              <p className="text-bone">Why did this happen?</p>
              <ul className="list-disc list-inside space-y-1 text-bone-dark">
                <li>The group owner may have regenerated a new invite link.</li>
                <li>The 7-day invite window may have expired.</li>
                <li>The invite link could be mistyped or malformed.</li>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link
                href="/dashboard"
                className="text-xs font-mono text-bone-muted hover:text-bone underline underline-offset-4"
              >
                Back to dashboard
              </Link>
              <button
                type="button"
                onClick={() => {
                  setState(prev => ({ ...prev, error: null, joining: false }));
                }}
                className="py-2 px-4 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone text-bone transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
