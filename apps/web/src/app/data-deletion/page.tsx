import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, BRAND, CONTACT_EMAIL } from '@/components/LegalPage';

export const metadata: Metadata = { title: `Data Deletion - ${BRAND}` };

export default function DataDeletionPage() {
  const subject = encodeURIComponent(`${BRAND} data deletion request`);
  return (
    <LegalPage title="Data Deletion Instructions">
      <p>You can remove your data from {BRAND} in either of these ways.</p>

      <h2>Option 1: Disconnect a social account yourself</h2>
      <ol className="list-decimal space-y-1 pl-6">
        <li>Log in and open <strong>Accounts</strong>.</li>
        <li>Click the remove (bin) icon on the connected account and confirm.</li>
      </ol>
      <p>
        This deletes the stored access tokens for that account. You can also revoke access from the platform itself: Facebook and
        Instagram (Settings, Apps and websites), Google/YouTube (<a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>),
        LinkedIn (Settings, Data privacy, Permitted services), and Pinterest (Settings, Apps).
      </p>

      <h2>Option 2: Delete your account and all data</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}?subject=${subject}`}>{CONTACT_EMAIL}</a> from the address you signed up with,
        with the subject &quot;{BRAND} data deletion request&quot;. We will delete your account, connected-account tokens, posts, media
        and related records within 30 days and confirm by email.
      </p>

      <p>See also our <Link href="/privacy">Privacy Policy</Link>.</p>
    </LegalPage>
  );
}
