import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationBell, NotificationList } from './NotificationBell';
import type { NotificationLike } from '@/lib/notifications';

// Server-side render of the bell (closed) and of the list inside the dropdown. Opening / clicking need a
// browser; what is asserted here is what the user sees for a given set of notifications.

const now = new Date('2026-09-22T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const n = (id: string, message: string, extra: Partial<NotificationLike> = {}): NotificationLike => ({ id, type: 'success', message, read: false, created_at: at(HOUR), ...extra });

const noop = () => {};
const list = (notifications: NotificationLike[], opts: { highlight?: string[]; showOlder?: boolean } = {}) =>
  renderToStaticMarkup(<NotificationList notifications={notifications} highlightIds={new Set(opts.highlight ?? [])} showOlder={!!opts.showOlder} onToggleOlder={noop} now={now} />);

describe('NotificationBell (closed)', () => {
  const bell = (notifications: NotificationLike[]) => renderToStaticMarkup(<NotificationBell notifications={notifications} onMarkRead={noop} />);

  it('shows an unread count badge and says so in the accessible name', () => {
    const html = bell([n('1', 'a'), n('2', 'b', { read: true }), n('3', 'c')]);
    expect(html).toContain('aria-label="Notifications, 2 unread"');
    expect(html).toMatch(/>2<\/span>/);
    expect(html).toContain('aria-expanded="false"');
  });

  it('shows no badge when everything is read or there is nothing', () => {
    for (const items of [[], [n('1', 'a', { read: true })]]) {
      const html = bell(items);
      expect(html).toContain('aria-label="Notifications"');
      expect(html).not.toContain('bg-red-500');
    }
  });

  it('caps the badge at 9+', () => {
    const many = Array.from({ length: 12 }, (_, i) => n(String(i), 'x'));
    expect(bell(many)).toContain('>9+<');
  });

  it('does not render the dropdown until it is opened', () => {
    expect(bell([n('1', 'a')])).not.toContain('role="region"');
  });
});

describe('NotificationList', () => {
  it('shows the full message (no truncation classes) with a relative time', () => {
    const long = '"A mountain scene #mountain #scene and a much longer text than two lines" to threads has been successfully published.';
    const html = list([n('1', long, { created_at: at(5 * MIN) })]);
    expect(html).toContain('to threads has been successfully published.');
    expect(html).not.toContain('line-clamp');
    expect(html).toContain('5 min ago');
  });

  it('labels old items with how old they are, so stale updates are not mistaken for fresh ones', () => {
    const html = list([n('1', 'recent one', { created_at: at(2 * DAY) })]);
    expect(html).toContain('2 days ago');
  });

  it('marks unread and highlighted items as New, and read items not', () => {
    const html = list([n('a', 'unread one'), n('b', 'read one', { read: true }), n('c', 'was unread when opened', { read: true })], { highlight: ['c'] });
    expect(html.match(/>New</g)?.length).toBe(2);
    expect(html).toContain('bg-indigo-50/60');
  });

  it('colours the dot by type', () => {
    const html = list([n('1', 'ok', { type: 'success' }), n('2', 'bad', { type: 'failure' }), n('3', 'other', { type: 'info' })]);
    expect(html).toContain('bg-green-500');
    expect(html).toContain('bg-red-500');
    expect(html).toContain('bg-gray-400');
  });

  it('tucks notifications older than 7 days behind "Show older (n)"', () => {
    const items = [n('new', 'fresh', { created_at: at(HOUR) }), n('o1', 'old one', { created_at: at(10 * DAY) }), n('o2', 'older one', { created_at: at(30 * DAY) })];
    const collapsed = list(items);
    expect(collapsed).toContain('fresh');
    expect(collapsed).toContain('Show older (2)');
    expect(collapsed).not.toContain('old one');
    const expanded = list(items, { showOlder: true });
    expect(expanded).toContain('Hide older');
    expect(expanded).toContain('old one');
    expect(expanded).toContain('older one');
  });

  it('says you are all caught up when only old notifications exist', () => {
    const html = list([n('o', 'old one', { created_at: at(20 * DAY) })]);
    expect(html).toContain('all caught up');
    expect(html).toContain('Show older (1)');
  });

  it('shows an empty state when there are no notifications at all', () => {
    expect(list([])).toContain('No notifications yet.');
  });

  it('escapes HTML in a message', () => {
    const html = list([n('x', '<img src=x onerror=alert(1)>')]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('copes with a notification that has no message or timestamp', () => {
    expect(() => list([{ id: 'x' }])).not.toThrow();
  });
});
