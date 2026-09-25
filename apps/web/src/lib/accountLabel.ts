// What to show under a connected account's platform name so the user can tell WHICH account it is.
// The account-service saves the platform-side name/username in `handle` (YouTube may also have `channel_title`).

type AccountLike = { platform?: string; handle?: unknown; channel_title?: unknown };

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// Instagram and Threads identify people by @username; the other platforms show a display name as-is.
const AT_USERNAME_PLATFORMS = new Set(['instagram', 'threads']);

/** The account's display name / username, or null when we have not stored one yet. */
export function getAccountLabel(acc: AccountLike): string | null {
  const name = clean(acc.handle) || clean(acc.channel_title);
  if (!name) return null;
  if (AT_USERNAME_PLATFORMS.has(acc.platform || '') && !name.startsWith('@') && !/\s/.test(name)) return `@${name}`;
  return name;
}
