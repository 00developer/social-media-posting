// Pure helpers for the header notification bell (relative time, unread count, "recent vs older" split).
// No React and no network so they are unit tested.

export type NotificationLike = { id: string; type?: string; message?: string; read?: boolean; created_at?: string };

/** How many of the newest notifications the dashboard keeps in memory. */
export const NOTIFICATION_LIMIT = 30;
/** Notifications older than this are tucked away behind "Show older". */
export const RECENT_DAYS = 7;
/** How often the bell re-checks for new notifications while the tab is visible (Realtime may be off). */
export const NOTIFICATION_POLL_MS = 30_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "just now", "5 min ago", "3 h ago", "yesterday", "3 days ago", then a short date ("20 Sep") from a week on.
 * Empty string for a missing / invalid timestamp. Times slightly in the future (clock skew) read "just now".
 */
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date(), locale?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const diff = now.getTime() - t;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < RECENT_DAYS * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function countUnread(list: NotificationLike[]): number {
  return list.filter((n) => !n.read).length;
}

/** Badge text: nothing for 0, the number up to 9, then "9+". */
export function formatBadge(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

/** Splits (newest first) notifications into the last `days` days and the rest. A missing timestamp counts as recent. */
export function splitNotifications<T extends NotificationLike>(list: T[], now: Date = new Date(), days: number = RECENT_DAYS): { recent: T[]; older: T[] } {
  const cutoff = now.getTime() - days * DAY;
  const recent: T[] = [];
  const older: T[] = [];
  for (const n of list) {
    const t = n.created_at ? Date.parse(n.created_at) : NaN;
    (Number.isNaN(t) || t >= cutoff ? recent : older).push(n);
  }
  return { recent, older };
}
