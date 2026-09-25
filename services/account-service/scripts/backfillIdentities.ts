// One-off: fill in the display name / @username for accounts that were connected before we stored it.
// Uses each account's stored token (nothing is re-connected). Only touches rows whose `handle` is empty,
// unless --force is given (re-check and overwrite every row).
//   npx ts-node --transpile-only scripts/backfillIdentities.ts            # apply
//   npx ts-node --transpile-only scripts/backfillIdentities.ts --dry-run  # just print what it would set
//   npx ts-node --transpile-only scripts/backfillIdentities.ts --force    # also overwrite names that are already set
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fetchAccountIdentity } from '../src/identity';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';

function decrypt(text: string) {
  const [ivHex, encHex] = text.split(':');
  const d = crypto.createDecipheriv('aes-256-cbc', Buffer.from(KEY), Buffer.from(ivHex, 'hex'));
  return d.update(encHex, 'hex', 'utf8') + d.final('utf8');
}

// YouTube access tokens only live an hour, so exchange the stored refresh token for a fresh one.
async function youtubeAccessToken(refreshEncrypted: string | null): Promise<string | null> {
  if (!refreshEncrypted) return null;
  const refreshToken = decrypt(refreshEncrypted);
  if (refreshToken === 'none') return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body: any = await res.json();
  return body.access_token || null;
}

(async () => {
  const { data: rows, error } = await supabase
    .from('social_accounts')
    .select('id, platform, handle, provider_account_id, access_token_encrypted, refresh_token_encrypted')
    .in('platform', ['facebook', 'instagram', 'threads', 'youtube']);
  if (error) throw error;

  for (const row of rows || []) {
    if (row.handle && !force) { console.log(`${row.platform} ${row.id.slice(0, 8)}: already has "${row.handle}", skipped`); continue; }
    try {
      const token = row.platform === 'youtube' ? await youtubeAccessToken(row.refresh_token_encrypted) : decrypt(row.access_token_encrypted);
      if (!token) { console.log(`${row.platform} ${row.id.slice(0, 8)}: no usable token, skipped`); continue; }
      const identity = await fetchAccountIdentity(row.platform, token);
      if (!identity) { console.log(`${row.platform} ${row.id.slice(0, 8)}: name lookup failed (token expired or missing permission)`); continue; }

      const update: Record<string, string> = { handle: identity.handle };
      if (!row.provider_account_id && identity.providerAccountId) update.provider_account_id = identity.providerAccountId;
      if (identity.channelTitle) update.channel_title = identity.channelTitle;
      if (identity.channelId) update.channel_id = identity.channelId;

      console.log(`${row.platform} ${row.id.slice(0, 8)}: ${dryRun ? 'would set' : 'set'} handle = "${identity.handle}"`);
      if (!dryRun) {
        const { error: upErr } = await supabase.from('social_accounts').update(update).eq('id', row.id);
        if (upErr) console.log(`  update failed: ${upErr.message}`);
      }
    } catch (e) {
      console.log(`${row.platform} ${row.id.slice(0, 8)}: error - ${e instanceof Error ? e.message : e}`);
    }
  }
})();
