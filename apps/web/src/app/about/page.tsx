import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, BRAND, CONTACT_EMAIL } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: `${BRAND} - Write once, publish everywhere`,
  description: `${BRAND} is a social media scheduling and publishing tool for Facebook, Instagram, Threads, YouTube, LinkedIn and Pinterest.`,
};

export default function AboutPage() {
  return (
    <LegalPage title={`${BRAND}: write once, publish everywhere`} updated={false}>
      <p>
        {BRAND} is a social media management tool. Connect your social accounts, write a post once, add an image or video,
        pick the platforms you want, and publish it right away or schedule it for later.
      </p>
      <h2>What you can do</h2>
      <ul>
        <li>Publish to Facebook Pages, Instagram business accounts, Threads, YouTube (including Shorts), LinkedIn and Pinterest from one place.</li>
        <li>Preview how a post looks on each platform, with media automatically resized for each one.</li>
        <li>Schedule posts on a calendar, and automatically retry any that fail.</li>
        <li>Work as a team with owner, admin, editor and viewer roles.</li>
      </ul>
      <h2>Your accounts stay yours</h2>
      <p>
        You connect each account through that platform&apos;s own official login screen. We never see or store your social
        network passwords, and you can disconnect an account at any time from the Accounts page. See our{' '}
        <Link href="/privacy">Privacy Policy</Link> for details.
      </p>
      <p>
        <Link href="/login" className="font-semibold">Log in or create an account</Link>
        {' · '}Questions? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
