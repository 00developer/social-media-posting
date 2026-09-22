import { describe, it, expect } from 'vitest';
import { countUnread, formatBadge, formatRelativeTime, splitNotifications, type NotificationLike } from './notifications';

const now = new Date('2026-09-22T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it.each([
    [0, 'just now'],
    [30_000, 'just now'],
    [59_999, 'just now'],
    [MIN, '1 min ago'],
    [5 * MIN, '5 min ago'],
    [59 * MIN, '59 min ago'],
    [HOUR, '1 h ago'],
    [3 * HOUR + 20 * MIN, '3 h ago'],
    [23 * HOUR, '23 h ago'],
    [24 * HOUR, 'yesterday'],
    [47 * HOUR, 'yesterday'],
    [2 * DAY, '2 days ago'],
    [6 * DAY + 23 * HOUR, '6 days ago'],
  ])('%d ms ago reads "%s"', (ms, text) => {
    expect(formatRelativeTime(ago(ms), now)).toBe(text);
  });

  it('switches to a short date from seven days on', () => {
    // 2026-09-15 12:00 is exactly 7 days before `now`
    expect(formatRelativeTime('2026-09-15T12:00:00Z', now, 'en-GB')).toMatch(/^15 Sep/);
    expect(formatRelativeTime('2026-09-20T10:06:00Z', now, 'en-GB')).toBe('2 days ago');
    expect(formatRelativeTime('2026-09-01T10:06:00Z', now, 'en-GB')).toMatch(/^1 Sep/);
  });

  it('treats a timestamp in the future as just now (clock skew)', () => {
    expect(formatRelativeTime(new Date(now.getTime() + 5 * MIN).toISOString(), now)).toBe('just now');
  });

  it('returns an empty string for missing or invalid input', () => {
    expect(formatRelativeTime(undefined, now)).toBe('');
    expect(formatRelativeTime(null, now)).toBe('');
    expect(formatRelativeTime('', now)).toBe('');
    expect(formatRelativeTime('not a date', now)).toBe('');
  });
});

describe('countUnread / formatBadge', () => {
  const list: NotificationLike[] = [{ id: '1', read: false }, { id: '2', read: true }, { id: '3' }, { id: '4', read: false }];

  it('counts everything that is not read (a missing flag counts as unread)', () => {
    expect(countUnread(list)).toBe(3);
    expect(countUnread([])).toBe(0);
    expect(countUnread([{ id: 'x', read: true }])).toBe(0);
  });

  it('formats the badge', () => {
    expect(formatBadge(0)).toBe('');
    expect(formatBadge(-1)).toBe('');
    expect(formatBadge(1)).toBe('1');
    expect(formatBadge(9)).toBe('9');
    expect(formatBadge(10)).toBe('9+');
    expect(formatBadge(31)).toBe('9+');
  });
});

describe('splitNotifications', () => {
  const items: NotificationLike[] = [
    { id: 'new', created_at: ago(2 * HOUR) },
    { id: 'edge-in', created_at: ago(7 * DAY - MIN) },
    { id: 'edge', created_at: ago(7 * DAY) },
    { id: 'old', created_at: ago(9 * DAY) },
    { id: 'ancient', created_at: ago(40 * DAY) },
    { id: 'no-date' },
    { id: 'bad-date', created_at: 'garbage' },
  ];

  it('keeps the last 7 days as recent (boundary included) and the rest as older, preserving order', () => {
    const { recent, older } = splitNotifications(items, now);
    expect(recent.map((n) => n.id)).toEqual(['new', 'edge-in', 'edge', 'no-date', 'bad-date']);
    expect(older.map((n) => n.id)).toEqual(['old', 'ancient']);
  });

  it('honours a custom window and handles an empty list', () => {
    expect(splitNotifications(items, now, 1).recent.map((n) => n.id)).toEqual(['new', 'no-date', 'bad-date']);
    expect(splitNotifications([], now)).toEqual({ recent: [], older: [] });
  });
});
