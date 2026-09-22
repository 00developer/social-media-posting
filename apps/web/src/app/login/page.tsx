'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next);
    setError(null);
    setPassword('');
  };

  // Requires a dot in the domain part - catches typos like "xyz@gmailcom" that both the
  // browser's native type="email" check and Supabase's own signup accept as-is (Supabase
  // doesn't verify the domain has a real mailbox unless email confirmation is turned on).
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const handleAuth = async () => {
    setError(null);
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
          alert('Your SocialPush account has been created. Please login.');
          setMode('login');
          setPassword('');
          setTeamName('');
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-2xl font-bold mb-6 text-center text-black">SocialPush</h1>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4 text-black">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              className="w-full border rounded p-2 text-black border-gray-300"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              className="w-full border rounded p-2 text-black border-gray-300"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {mode === 'signup' && (
            <div>
              <label className="block text-sm font-medium mb-1">Team name</label>
              <input
                type="text"
                className="w-full border rounded p-2 text-black border-gray-300"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Acme Marketing"
              />
            </div>
          )}

          <button
            onClick={handleAuth}
            disabled={loading}
            className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '...' : mode === 'signup' ? 'Create Account' : 'Login'}
          </button>

          <p className="text-center text-sm text-gray-500 pt-1">
            {mode === 'signup' ? (
              <>Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="text-blue-600 font-medium hover:underline">
                  Login
                </button>
              </>
            ) : (
              <>Don&apos;t have an account?{' '}
                <button type="button" onClick={() => switchMode('signup')} className="text-blue-600 font-medium hover:underline">
                  Create one
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
