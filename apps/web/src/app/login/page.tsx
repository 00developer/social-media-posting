'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ThemeToggle } from '@/components/ThemeToggle';

const MIN_PASSWORD_LENGTH = 8;

// Requires a dot in the domain part - catches typos like "xyz@gmailcom" that both the
// browser's native type="email" check and Supabase's own signup accept as-is (Supabase
// doesn't verify the domain has a real mailbox unless email confirmation is turned on).
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle shadow-xs outline-none transition-colors hover:border-fg-subtle/50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next);
    setError(null);
    setPasswordError(null);
    setSuccess(null);
    setPassword('');
  };

  const handleAuth = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setPasswordError(null);
    setSuccess(null);
    // Validate locally first - an empty email/password sent to Supabase comes back as the
    // confusing "Anonymous sign-ins are disabled" error instead of "fill this in".
    if (!email.trim() || !password) {
      setError('Please enter both an email and a password.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address (e.g. you@example.com).');
      return;
    }
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        // The chosen team name rides along in user_metadata; DashboardProvider reads it back
        // the first time it auto-creates this user's team, instead of the "My Personal Team" default.
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { team_name: teamName.trim() || undefined } } });
        if (error) {
          setError(error.message);
        } else {
          // signUp() leaves the browser signed in when email confirmation is off. Sign back out
          // so the user has to log in with their new credentials, rather than landing straight
          // in the dashboard - matches the explicit Sign Up -> Login handoff asked for.
          await supabase.auth.signOut();
          setMode('login');
          setPassword('');
          setTeamName('');
          setSuccess('Your SocialPush account has been created. Please log in.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message);
        } else {
          router.push('/dashboard');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-canvas px-4 py-10 text-fg selection:bg-indigo-500 selection:text-white">
      {/* Soft brand glow behind the card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,rgb(99_102_241/0.16),transparent_70%),radial-gradient(40rem_24rem_at_100%_100%,rgb(139_92_246/0.10),transparent_70%)] dark:bg-[radial-gradient(60rem_30rem_at_50%_-10%,rgb(99_102_241/0.18),transparent_70%),radial-gradient(40rem_24rem_at_100%_100%,rgb(139_92_246/0.08),transparent_70%)]"
      />
      <ThemeToggle size="sm" className="absolute right-4 top-4 z-10" />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-indigo-600/30">
            <Zap className="h-4.5 w-4.5 fill-current" />
          </div>
          <div>
            <span className="block text-lg font-bold leading-none tracking-tight text-fg">SocialPush</span>
            <span className="mt-0.5 block text-[11px] leading-tight text-fg-subtle">Social Studio</span>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-pop sm:p-8">
          <h1 className="text-xl font-bold tracking-tight text-fg">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {isSignup ? 'Schedule and publish to every network from one place.' : 'Log in to manage your posts and channels.'}
          </p>

          {success && (
            <div role="status" className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <span>{success}</span>
            </div>
          )}
          {error && (
            <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-3 text-sm text-rose-700 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleAuth} noValidate className="mt-6 space-y-4">
            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-xs font-medium text-fg-secondary">Email</label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="mb-1.5 block text-xs font-medium text-fg-secondary">Password</label>
              <div className="relative">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  className={`${inputClass} pr-11`}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (passwordError) setPasswordError(null); }}
                  placeholder="••••••••"
                  disabled={loading}
                  minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
                  aria-invalid={!!passwordError}
                  aria-describedby={isSignup ? 'auth-password-hint' : undefined}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls="auth-password"
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-fg-muted transition-colors hover:text-fg focus-visible:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/60"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {isSignup && (
                <p id="auth-password-hint" className={`mt-1.5 text-xs ${passwordError ? 'font-medium text-rose-700 dark:text-rose-400' : 'text-fg-subtle'}`}>
                  {passwordError ?? `At least ${MIN_PASSWORD_LENGTH} characters.`}
                </p>
              )}
            </div>

            {isSignup && (
              <div>
                <label htmlFor="auth-team" className="mb-1.5 block text-xs font-medium text-fg-secondary">
                  Team name <span className="font-normal text-fg-subtle">(optional)</span>
                </label>
                <input
                  id="auth-team"
                  name="organization"
                  type="text"
                  autoComplete="organization"
                  className={inputClass}
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g. Acme Marketing"
                  disabled={loading}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              <span>{loading ? (isSignup ? 'Creating account...' : 'Logging in...') : isSignup ? 'Create account' : 'Log in'}</span>
            </button>
          </form>

          <p className="pt-5 text-center text-sm text-fg-muted">
            {isSignup ? (
              <>Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="font-medium text-accent hover:text-accent-hover hover:underline">
                  Log in
                </button>
              </>
            ) : (
              <>Don&apos;t have an account?{' '}
                <button type="button" onClick={() => switchMode('signup')} className="font-medium text-accent hover:text-accent-hover hover:underline">
                  Create one
                </button>
              </>
            )}
          </p>
        </div>

        <nav aria-label="Legal" className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-fg-subtle">
          <Link href="/about" className="hover:text-fg-secondary">About</Link>
          <Link href="/privacy" className="hover:text-fg-secondary">Privacy</Link>
          <Link href="/terms" className="hover:text-fg-secondary">Terms</Link>
        </nav>
      </div>
    </div>
  );
}
