'use client';

import React, { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import ErrorCallout from '../../src/components/ErrorCallout';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const initialRegister = searchParams.get('mode') === 'register';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isRegistering, setIsRegistering] = useState(initialRegister);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await signIn('credentials', {
        redirect: false,
        email,
        password,
        name: isRegistering ? name : undefined,
      });

      if (res?.error) {
        setError(res.error);
        setLoading(false);
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleQuickLogin = (demoEmail, demoName) => {
    setEmail(demoEmail);
    setPassword('demo-password-123');
    setName(demoName);
  };

  return (
    <div className="w-full max-w-md border border-ledger-border bg-ledger-panel p-5 sm:p-8 shadow-none">
      <div className="flex items-center justify-between border-b border-ledger-border pb-4 mb-6">
        <h1 className="font-display text-2xl font-medium tracking-tight text-bone">
          SettleUp
        </h1>
        <span className="text-xs font-sans text-bone-muted">
          Ledger Access
        </span>
      </div>

      <div className="mb-6 space-y-1">
        <h2 className="text-base font-semibold tracking-tight text-bone">
          {isRegistering ? 'Create Ledger Account' : 'Authenticate to Ledger'}
        </h2>
        <p className="text-xs text-bone-muted font-sans">
          Immutable group accounting and debt simplification engine.
        </p>
      </div>

      {error && (
        <ErrorCallout
          error={{ code: 'AUTH_FAILED', message: error }}
          onDismiss={() => setError(null)}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {isRegistering && (
          <div>
            <label className="block text-xs font-sans text-bone-muted mb-1">
              Full name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Rehan"
              className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none transition-colors"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-sans text-bone-muted mb-1">
            Email address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="rehan@example.com"
            className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-sans text-bone-muted mb-1">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="w-full px-3 py-2 text-xs font-mono bg-ledger-subpanel border border-ledger-border text-bone focus:border-bone focus:outline-none transition-colors"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 text-xs font-mono bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? 'Authenticating...' : isRegistering ? 'Register account' : 'Sign in'}
        </button>
      </form>

      <div className="relative my-6 text-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-ledger-border" />
        </div>
        <span className="relative px-3 bg-ledger-panel text-xs font-sans text-bone-dark">
          or
        </span>
      </div>

      {/* Google OAuth Button */}
      <button
        onClick={() => signIn('google', { callbackUrl })}
        type="button"
        className="w-full py-2 px-4 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:bg-ledger-highlight text-bone flex items-center justify-center gap-2 transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.761H12.545z"
          />
        </svg>
        Continue with Google
      </button>

      {/* Quick Demo Logins for Pair Programming */}
      <div className="mt-6 pt-5 border-t border-ledger-border">
        <span className="text-xs font-sans text-bone-dark block mb-2">
          Demo accounts:
        </span>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => handleQuickLogin('rehan@example.com', 'Rehan')}
            type="button"
            className="py-1 px-2 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone-muted"
          >
            Rehan
          </button>
          <button
            onClick={() => handleQuickLogin('pulkit@example.com', 'Pulkit')}
            type="button"
            className="py-1 px-2 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone-muted"
          >
            Pulkit
          </button>
          <button
            onClick={() => handleQuickLogin('arnav@example.com', 'Arnav')}
            type="button"
            className="py-1 px-2 text-xs font-mono border border-ledger-border bg-ledger-subpanel hover:border-bone-dark text-bone-muted"
          >
            Arnav
          </button>
        </div>
      </div>

      <div className="mt-5 text-center">
        <button
          onClick={() => setIsRegistering(!isRegistering)}
          type="button"
          className="text-xs font-mono text-bone-muted hover:text-bone underline underline-offset-4 transition-colors"
        >
          {isRegistering
            ? 'Already have an account? Sign in'
            : "Don't have an account? Register"}
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-ledger-canvas text-bone flex items-center justify-center p-4 sm:p-6">
      <Suspense fallback={<div className="font-mono text-xs text-bone-dark">Loading...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
