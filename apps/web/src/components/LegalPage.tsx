import Link from 'next/link';
import React from 'react';

export const BRAND = 'CodeLabs-SocialPush';
export const CONTACT_EMAIL = 'askanything46@gmail.com';
export const EFFECTIVE_DATE = '24 September 2026';

// Shared, public (no login) frame for the about / privacy / terms / data-deletion pages.
export function LegalPage({ title, updated = true, children }: { title: string; updated?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/about" className="text-lg font-bold text-indigo-700">{BRAND}</Link>
          <Link href="/login" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Log in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">{title}</h1>
        {updated && <p className="mb-8 text-sm text-gray-500">Effective date: {EFFECTIVE_DATE}</p>}
        <div className="space-y-4 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_a]:text-indigo-700 [&_a]:underline">
          {children}
        </div>
      </main>
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-6 py-6 text-sm text-gray-600">
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
