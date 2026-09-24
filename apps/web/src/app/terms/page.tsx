import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, BRAND, CONTACT_EMAIL } from '@/components/LegalPage';

export const metadata: Metadata = { title: `Terms of Service - ${BRAND}` };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>By creating an account or using {BRAND} (the &quot;Service&quot;), you agree to these terms.</p>

      <h2>1. The Service</h2>
      <p>{BRAND} lets you connect social media accounts and create, schedule and publish content to them. Features may change over time.</p>

      <h2>2. Your account</h2>
      <p>You are responsible for your login credentials and for activity in your account and team. You must provide accurate information and be old enough to enter a binding agreement.</p>

      <h2>3. Connected accounts and third-party platforms</h2>
      <p>
        You may connect only accounts you own or are authorized to manage. Publishing happens through third-party platforms
        (Meta, Google/YouTube, LinkedIn, Pinterest and others). You must follow each platform&apos;s own terms and policies, and
        we are not responsible for their availability, limits, changes or decisions (including restricting or removing content or accounts).
      </p>

      <h2>4. Your content</h2>
      <p>
        You keep ownership of the content you upload. You give us permission to store, process (for example resize or convert media)
        and transmit it as needed to publish it where you direct. You are responsible for your content and for having the rights to
        publish it. You may not use the Service for anything unlawful, infringing, deceptive, harmful or that violates a platform&apos;s rules.
      </p>

      <h2>5. Availability</h2>
      <p>We work to keep the Service running, but scheduled posts can fail or be delayed because of platform errors, expired permissions or outages. We do not guarantee uninterrupted or error-free operation.</p>

      <h2>6. Termination</h2>
      <p>You can stop using the Service and delete your data at any time (see <Link href="/data-deletion">Data Deletion</Link>). We may suspend or end access for violations of these terms.</p>

      <h2>7. Disclaimer and limitation of liability</h2>
      <p>The Service is provided &quot;as is&quot; without warranties. To the extent permitted by law, we are not liable for indirect or consequential losses, or for any loss arising from posts that are published, delayed or not published.</p>

      <h2>8. Changes</h2>
      <p>We may update these terms. Continued use after an update means you accept it.</p>

      <h2>9. Contact</h2>
      <p>{BRAND} · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> · <Link href="/privacy">Privacy Policy</Link></p>
    </LegalPage>
  );
}
