'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  countUnread,
  formatBadge,
  formatRelativeTime,
  RECENT_DAYS,
  splitNotifications,
  type NotificationLike,
} from '@/lib/notifications';

type NotificationListProps = {
  notifications: NotificationLike[];
  /** Ids to show as "new" (unread when the panel was opened), even though they are already marked read. */
  highlightIds: ReadonlySet<string>;
  showOlder: boolean;
  onToggleOlder: () => void;
  /** Injectable clock so the output is deterministic in tests. */
  now?: Date;
};

const dotColor = (type?: string) => (type === 'success' ? 'bg-green-500' : type === 'failure' ? 'bg-red-500' : 'bg-gray-400');

// The list inside the dropdown: last 7 days first, older ones behind a toggle.
export function NotificationList({ notifications, highlightIds, showOlder, onToggleOlder, now = new Date() }: NotificationListProps) {
  const { recent, older } = splitNotifications(notifications, now);

  const renderItem = (n: NotificationLike) => {
    const isNew = highlightIds.has(n.id) || !n.read;
    return (
      <li key={n.id} className={`flex gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0 ${isNew ? 'bg-indigo-50/60' : ''}`}>
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor(n.type)}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13px] leading-relaxed text-gray-700 wrap-break-word">{n.message ?? ''}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {formatRelativeTime(n.created_at, now)}
            {isNew && <span className="ml-2 font-bold uppercase tracking-wider text-indigo-500">New</span>}
          </p>
        </div>
      </li>
    );
  };

  if (notifications.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-gray-400">No notifications yet.</p>;
  }

  return (
    <div>
      {recent.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">You&apos;re all caught up. Nothing in the last {RECENT_DAYS} days.</p>
      ) : (
        <ul>{recent.map(renderItem)}</ul>
      )}

      {older.length > 0 && (
        <div className="border-t border-gray-100">
          <button
            type="button"
            onClick={onToggleOlder}
            aria-expanded={showOlder}
            className="w-full px-4 py-2.5 text-left text-xs font-semibold text-indigo-600 hover:bg-gray-50"
          >
            {showOlder ? 'Hide older' : `Show older (${older.length})`}
          </button>
          {showOlder && <ul className="border-t border-gray-100">{older.map(renderItem)}</ul>}
        </div>
      )}
    </div>
  );
}

type NotificationBellProps = {
  notifications: NotificationLike[];
  onMarkRead: (ids: string[]) => void;
};

// Bell in the header (always visible, unlike the old box at the bottom of the sidebar).
// Opening the panel marks what was unread as read; those items keep a "New" highlight until it is closed.
export function NotificationBell({ notifications, onMarkRead }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const [showOlder, setShowOlder] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const unread = useMemo(() => countUnread(notifications), [notifications]);
  const badge = formatBadge(unread);

  const unreadIds = () => notifications.filter((n) => !n.read).map((n) => n.id);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const ids = unreadIds();
    setHighlight(new Set(ids));
    setShowOlder(false);
    if (ids.length > 0) onMarkRead(ids);
    setOpen(true);
  };

  const markAllRead = () => {
    const ids = unreadIds();
    setHighlight(new Set());
    if (ids.length > 0) onMarkRead(ids);
  };

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
        {badge && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute right-0 top-full z-30 mt-2 max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-xl"
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Updates</h3>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unread === 0 && highlight.size === 0}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:pointer-events-none disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          <NotificationList notifications={notifications} highlightIds={highlight} showOlder={showOlder} onToggleOlder={() => setShowOlder((v) => !v)} />
        </div>
      )}
    </div>
  );
}
