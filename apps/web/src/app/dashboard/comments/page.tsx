'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDashboard } from '@/components/DashboardProvider';
import { supabase } from '@/lib/supabase';
import { ANALYTICS_SERVICE_URL } from '@/lib/apiUrls';
import { colorFor } from '@/components/analytics/AnalyticsChart';
import { buildThreads, filterThreads, type CommentRow, type Thread } from '@/lib/commentThreads';

const AUTO_REFRESH_MS = 60_000;
const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'unanswered', label: 'Needs reply' },
  { id: 'answered', label: 'Answered' },
] as const;

async function callService(path: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${ANALYTICS_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

export default function CommentsPage() {
  const { activeTeam, posts } = useDashboard();
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState<(typeof STATUSES)[number]['id']>('all');
  const [postId, setPostId] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeTeam) return;
    const { data, error: err } = await supabase
      .from('post_comments')
      .select('id, post_id, platform, external_comment_id, parent_external_id, author_name, text, commented_at, is_own')
      .eq('team_id', activeTeam.id)
      .order('commented_at', { ascending: false })
      .limit(2000);
    // The table is created by a migration; until then just show an empty inbox.
    if (!err) setRows((data || []) as CommentRow[]);
    setLoaded(true);
  }, [activeTeam]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    void (async () => { await Promise.resolve(); await load(); })(); // first load
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  const refresh = async () => {
    if (!activeTeam) return;
    setRefreshing(true);
    setNotice(null);
    try {
      await callService('/api/v1/comments/sync', { teamId: activeTeam.id });
      await load();
    } catch (e) {
      setNotice(`Could not fetch new comments: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setRefreshing(false);
    }
  };

  const postTitle = useMemo(() => new Map(posts.map((p) => [p.id, (p.content || '').trim()])), [posts]);
  const threads = useMemo(() => buildThreads(rows), [rows]);
  const visible = useMemo(() => filterThreads(threads, { platform, status, postId }), [threads, platform, status, postId]);
  const platforms = useMemo(() => [...new Set(threads.map((t) => t.root.platform))], [threads]);
  const postOptions = useMemo(() => {
    const ids = [...new Set(threads.filter((t) => platform === 'all' || t.root.platform === platform).map((t) => t.root.post_id).filter((id): id is string => !!id))];
    return ids.map((id) => ({ id, label: postTitle.get(id) || '(no caption)' }));
  }, [threads, platform, postTitle]);
  const waiting = threads.filter((t) => t.needsReply).length;

  const send = async (thread: Thread) => {
    const text = draft.trim();
    if (!text) return;
    // Reply to the latest comment from a reader (a reply to a reply), else to the top-level comment.
    const last = [...thread.replies].reverse().find((r) => !r.is_own);
    const target = last ?? thread.root;
    setSending(true);
    setError(null);
    try {
      await callService('/api/v1/comments/reply', { commentId: target.id, text });
      setDraft('');
      setOpenId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Comments</h2>
          <p className="text-sm text-gray-500 mt-1">Read and answer comments from all your platforms without leaving SocialPush. {waiting > 0 ? `${waiting} waiting for a reply.` : ''}</p>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
          {refreshing ? 'Fetching...' : 'Refresh'}
        </button>
      </div>

      {notice && <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-900">{notice}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <select value={platform} onChange={(e) => { setPlatform(e.target.value); setPostId('all'); }} aria-label="Platform" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 capitalize">
          <option value="all">All platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={postId} onChange={(e) => setPostId(e.target.value)} aria-label="Post" className="max-w-xs rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          <option value="all">All posts</option>
          {postOptions.map((o) => <option key={o.id} value={o.id}>{o.label.slice(0, 50)}</option>)}
        </select>
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button key={s.id} type="button" onClick={() => setStatus(s.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${status === s.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <p className="py-10 text-center text-sm text-gray-500">Loading comments...</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-12 text-center text-sm text-gray-500 shadow-sm">
          {threads.length === 0
            ? 'No comments yet. Comments on your Facebook, Instagram, Threads and YouTube posts appear here a few minutes after they are written. (Comment access must be enabled on each account: reconnect it if it was connected before.)'
            : 'No comments match these filters.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((t) => (
            <li key={t.root.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5 capitalize text-gray-700">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(t.root.platform) }} />
                  {t.root.platform}
                </span>
                <span>on</span>
                <span className="max-w-xs truncate font-medium text-gray-700">{(t.root.post_id && postTitle.get(t.root.post_id)) || '(post)'}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 font-medium ${t.needsReply ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {t.needsReply ? 'Needs reply' : t.root.is_own && t.replies.length === 0 ? 'Your comment' : 'Answered'}
                </span>
              </div>

              <div className="mt-3">
                <div className="text-sm"><span className={`font-semibold ${t.root.is_own ? 'text-indigo-700' : 'text-gray-900'}`}>{t.root.is_own ? `${t.root.author_name || 'You'} (you)` : t.root.author_name || 'Someone'}</span> <span className="text-xs text-gray-400">{when(t.root.commented_at)}</span></div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{t.root.text}</p>
              </div>

              {t.replies.length > 0 && (
                <div className="mt-3 space-y-2 border-l-2 border-gray-100 pl-4">
                  {t.replies.map((r) => (
                    <div key={r.id} className="text-sm">
                      <span className={`font-semibold ${r.is_own ? 'text-indigo-700' : 'text-gray-900'}`}>{r.is_own ? `${r.author_name || 'You'} (you)` : r.author_name || 'Someone'}</span>{' '}
                      <span className="text-xs text-gray-400">{when(r.commented_at)}</span>
                      <p className="whitespace-pre-wrap text-gray-700">{r.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {openId === t.root.id ? (
                <div className="mt-3 space-y-2">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus placeholder="Write your reply..."
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none" />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => send(t)} disabled={sending || !draft.trim()} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                      {sending ? 'Sending...' : 'Send reply'}
                    </button>
                    <button type="button" onClick={() => { setOpenId(null); setError(null); }} className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => { setOpenId(t.root.id); setDraft(''); setError(null); }} className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800">Reply</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
