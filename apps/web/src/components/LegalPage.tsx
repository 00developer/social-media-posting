import Link from 'next/link';
import React from 'react';
import { Zap } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

// Legal name used in the privacy policy, terms and data-deletion pages (what app reviewers see); the in-app brand is "SocialPush".
export const BRAND = 'CodeLabs-SocialPush';
export const CONTACT_EMAIL = 'askanything46@gmail.com';
export const EFFECTIVE_DATE = '24 September 2026';

// Shared, public (no login) frame for the about / privacy / terms / data-deletion pages.
// Follows the light/dark theme like the login page and the dashboard.
export function LegalPage({ title, updated = true, children }: { title: string; updated?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-fg-secondary selection:bg-indigo-500 selection:text-white">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/about" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white shadow-xs">
              <Zap className="h-3.5 w-3.5 fill-current" />
            </span>
            <span className="text-base font-bold tracking-tight text-fg">{BRAND}</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle size="sm" />
            <Link href="/login" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface">Log in</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-fg sm:text-3xl">{title}</h1>
        {updated && <p className="mb-8 text-sm text-fg-subtle">Effective date: {EFFECTIVE_DATE}</p>}
        <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card leading-relaxed sm:p-8 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg [&_h2:first-child]:mt-0 [&_strong]:text-fg [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_a]:text-accent [&_a]:underline [&_a:hover]:text-accent-hover">
          {children}
        </div>
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-fg-muted sm:px-6 [&_a:hover]:text-fg">
          <Link href="/about">About</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/data-deletion">Data Deletion</Link>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </div>
      </footer>
    </div>
  );
}
