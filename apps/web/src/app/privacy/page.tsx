import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, BRAND, CONTACT_EMAIL } from '@/components/LegalPage';

export const metadata: Metadata = { title: `Privacy Policy - ${BRAND}` };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what information {BRAND} (&quot;we&quot;, &quot;us&quot;) collects when you use our social media
        scheduling and publishing service, how we use it, and the choices you have.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li><strong>Account information:</strong> your email address and a password (stored by our authentication provider in hashed form), and the team name you choose.</li>
        <li><strong>Connected social accounts:</strong> when you connect Facebook, Instagram, Threads, YouTube, LinkedIn or Pinterest, we receive an access token from that platform plus basic profile details needed to publish for you (for example your account or channel name and ID, the Facebook Page or Pinterest boards you publish to). Tokens are encrypted before they are stored.</li>
        <li><strong>Content you create:</strong> post text, images and videos you upload, schedules, and the publishing status of each post.</li>
        <li><strong>Performance metrics:</strong> for some platforms, aggregate numbers for the posts we publish for you (such as views, likes, saves or clicks).</li>
        <li><strong>Technical data:</strong> basic logs needed to run and secure the service.</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To publish and schedule the posts you create, on the accounts you connect, at the times you choose.</li>
        <li>To show you post previews, publishing results, notifications and analytics.</li>
        <li>To run team features such as roles and invitations.</li>
        <li>To keep the service secure and to fix problems.</li>
      </ul>
      <p>We only use data from your connected accounts to provide these features. We do not sell your data, and we do not use it for advertising.</p>

      <h2>3. Google / YouTube user data</h2>
      <p>
        {BRAND} accesses YouTube through the YouTube API Services, only to upload videos you choose to publish and to read basic
        channel information. Our use and transfer of information received from Google APIs to any other app will adhere to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements. By connecting YouTube you also agree to be bound by the{' '}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>, and Google&apos;s{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> applies to data held by Google.
        You can revoke our access at any time at{' '}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.
      </p>

      <h2>4. Data from Meta (Facebook, Instagram, Threads), LinkedIn and Pinterest</h2>
      <p>
        We request only the permissions needed to publish content and read basic profile information for the accounts you connect
        (for example, managing posts on a Facebook Page, publishing to Instagram, Threads or LinkedIn, and creating Pins on your
        Pinterest boards). We use this data only to provide the publishing features you request. You can revoke access at any time
        from each platform&apos;s own app-and-permissions settings, or by disconnecting the account in {BRAND}.
      </p>

      <h2>5. Who we share data with</h2>
      <p>We share data only with service providers that help us run the product, and with the social platforms you choose to publish to:</p>
      <ul>
        <li>Database, authentication and file storage provider (Supabase).</li>
        <li>Job queue provider used to schedule and retry posts (Upstash Redis).</li>
        <li>Hosting and infrastructure providers that run the application.</li>
        <li>The social platforms you connect (Meta, Google/YouTube, LinkedIn, Pinterest), which receive the content you publish.</li>
      </ul>
      <p>Media files you upload are stored at web-accessible addresses so that the social platforms can fetch them when publishing.</p>

      <h2>6. Security</h2>
      <p>
        Access tokens are encrypted at rest, data is transmitted over HTTPS, and access to team data is restricted by role.
        No method of storage or transmission is completely secure, but we work to protect your information.
      </p>

      <h2>7. Retention and deletion</h2>
      <p>
        We keep your data while your account is active. You can disconnect a social account at any time from the Accounts page,
        which deletes the stored access tokens for that account. You can also ask us to delete your account and associated data
        (see <Link href="/data-deletion">Data Deletion</Link>). We delete it within 30 days of a verified request, except where the
        law requires us to keep something.
      </p>

      <h2>8. Your choices and rights</h2>
      <p>
        You can access, correct or delete your information, and withdraw permissions granted to us, at any time. Contact us at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>9. Children</h2>
      <p>The service is not directed to children under 13 (or the minimum age in your country), and we do not knowingly collect their data.</p>

      <h2>10. Changes to this policy</h2>
      <p>We may update this policy. The effective date at the top shows when it last changed.</p>

      <h2>11. Contact</h2>
      <p>{BRAND} · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
    </LegalPage>
  );
}
