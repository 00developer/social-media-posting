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
  { id: 'spam', label: 'Spam' },
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState<(typeof STATUSES)[number]['id']>('all');
  const [postId, setPostId] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [isAiDraft, setIsAiDraft] = useState(false); // whether the open draft is the AI's untouched suggestion

  const load = useCallback(async () => {
    if (!activeTeam) return;
    const { data, error: err } = await supabase
      .from('post_comments')
      .select('id, post_id, platform, external_comment_id, parent_external_id, author_name, text, commented_at, is_own, ai_status, ai_suggested_reply')
      .eq('team_id', activeTeam.id)
      .order('commented_at', { ascending: false })
      .limit(2000);
    if (err) {
      setLoadError(err.message || 'Could not load comments.');
    } else {
      setRows((data || []) as CommentRow[]);
      setLoadError(null);
    }
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

  const openReply = (t: Thread) => {
    setOpenId(t.root.id);
    setError(null);
    const suggestion = t.root.ai_status === 'suggested' ? t.root.ai_suggested_reply : null;
    setDraft(suggestion || '');
    setIsAiDraft(!!suggestion);
  };

  const regenerate = async (t: Thread) => {
    if (regenerating || sending) return;
    setRegenerating(true);
    setError(null);
    try {
      const { comment } = await callService(`/api/v1/comments/${t.root.id}/regenerate-suggestion`, {});
      setRows((prev) => prev.map((r) => (r.id === comment.id ? { ...r, ai_status: comment.ai_status, ai_suggested_reply: comment.ai_suggested_reply } : r)));
      if (comment.ai_status === 'suggested' && comment.ai_suggested_reply) { setDraft(comment.ai_suggested_reply); setIsAiDraft(true); }
      else setNotice(comment.ai_status === 'skipped_spam' ? 'The AI now thinks this looks like spam - no reply drafted.' : 'The AI flagged this as needing your own judgement - no reply drafted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not regenerate a suggestion');
    } finally {
      setRegenerating(false);
    }
  };

  const send = async (thread: Thread) => {
    const text = draft.trim();
    if (!text || sending || regenerating) return;
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
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-fg tracking-tight">Comments</h2>
          <p className="text-sm text-fg-muted mt-1">Read and answer comments from all your platforms without leaving SocialPush. {waiting > 0 ? <strong className="text-amber-700 dark:text-amber-400 font-semibold">{waiting} waiting for a reply.</strong> : ''}</p>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing} className="rounded-xl border border-line bg-surface-muted/90 px-3.5 py-2 text-sm font-medium text-fg hover:bg-surface-hover hover:text-fg transition-all shadow-sm disabled:opacity-50">
          {refreshing ? 'Fetching...' : 'Refresh'}
        </button>
      </div>

      {notice && <div className="rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200 backdrop-blur-xl">{notice}</div>}

      <div className="flex flex-wrap items-center gap-2.5">
        <select value={platform} onChange={(e) => { setPlatform(e.target.value); setPostId('all'); }} aria-label="Platform" className="rounded-xl border border-line bg-surface-muted/90 px-3.5 py-2 text-sm font-medium text-fg capitalize focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
          <option value="all">All platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={postId} onChange={(e) => setPostId(e.target.value)} aria-label="Post" className="max-w-xs rounded-xl border border-line bg-surface-muted/90 px-3.5 py-2 text-sm font-medium text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
          <option value="all">All posts</option>
          {postOptions.map((o) => <option key={o.id} value={o.id}>{o.label.slice(0, 50)}</option>)}
        </select>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status filter">
          {STATUSES.map((s) => (
            <button key={s.id} type="button" onClick={() => setStatus(s.id)} aria-pressed={status === s.id}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${status === s.id ? 'border-line-strong bg-surface-hover text-fg' : 'border-line bg-surface-muted/60 text-fg-muted hover:bg-surface-hover hover:text-fg'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loaded && loadError && rows.length > 0 && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
          Could not refresh comments: {loadError}. Showing the last loaded list.
        </div>
      )}

      {!loaded ? (
        <p role="status" className="py-12 text-center text-sm text-fg-muted flex items-center justify-center gap-2">
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          Loading comments...
        </p>
      ) : loadError && rows.length === 0 ? (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-50 dark:bg-rose-950/30 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Could not load comments</p>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-300/80">{loadError}</p>
          <button type="button" onClick={() => { setLoaded(false); void load(); }} className="mt-4 rounded-xl border border-line-strong bg-surface-muted px-4 py-2 text-xs font-semibold text-fg hover:bg-surface-hover hover:text-fg transition-colors">
            Try again
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface px-6 py-12 text-center text-sm text-fg-muted">
          {threads.length === 0
            ? 'No comments yet. Comments on your Facebook, Instagram, Threads and YouTube posts appear here a few minutes after they are written.'
            : 'No comments match these filters.'}
        </div>
      ) : (
        <ul className="space-y-3.5">
          {visible.map((t) => (
            <li key={t.root.id} className="rounded-xl border border-line bg-surface p-4.5 hover:border-line-strong transition-colors">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-fg-muted">
                <span className="inline-flex items-center gap-1.5 capitalize text-fg font-semibold">
                  <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-line" style={{ backgroundColor: colorFor(t.root.platform) }} />
                  {t.root.platform}
                </span>
                <span>on</span>
                <span className="max-w-xs truncate font-medium text-fg-secondary">{(t.root.post_id && postTitle.get(t.root.post_id)) || '(post)'}</span>
                {t.needsReply && t.root.ai_status === 'flagged_negative' ? (
                  <span className="ml-auto rounded-full bg-rose-50 dark:bg-rose-950/60 border border-rose-500/30 px-2.5 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">⚠ Flagged - needs judgement</span>
                ) : t.needsReply && t.root.ai_status === 'suggested' ? (
                  <span className="ml-auto rounded-full bg-violet-50 dark:bg-violet-950/60 border border-violet-500/30 px-2.5 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">✨ AI reply ready</span>
                ) : (
                  <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-xs font-semibold ${t.needsReply ? 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' : 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'}`}>
                    {t.needsReply ? 'Needs reply' : t.root.is_own && t.replies.length === 0 ? 'Your comment' : 'Answered'}
                  </span>
                )}
              </div>

              <div className="mt-3.5">
                <div className="text-sm">
                  <span className={`font-semibold ${t.root.is_own ? 'text-accent' : 'text-fg'}`}>{t.root.is_own ? `${t.root.author_name || 'You'} (you)` : t.root.author_name || 'Someone'}</span>{' '}
                  <span className="text-xs text-fg-muted">{when(t.root.commented_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg leading-relaxed">{t.root.text}</p>
              </div>

              {t.replies.length > 0 && (
                <div className="mt-4 space-y-3 border-l-2 border-line pl-4">
                  {t.replies.map((r) => (
                    <div key={r.id} className="text-sm">
                      <span className={`font-semibold ${r.is_own ? 'text-accent' : 'text-fg'}`}>{r.is_own ? `${r.author_name || 'You'} (you)` : r.author_name || 'Someone'}</span>{' '}
                      <span className="text-xs text-fg-muted">{when(r.commented_at)}</span>
                      <p className="mt-0.5 whitespace-pre-wrap text-fg-secondary leading-relaxed">{r.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {openId === t.root.id ? (
                <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface-muted/60 p-3.5">
                  {isAiDraft && <p className="text-xs font-medium text-violet-700 dark:text-violet-400">✨ AI-drafted reply - review and edit before sending.</p>}
                  <textarea value={draft} onChange={(e) => { setDraft(e.target.value); setIsAiDraft(false); }} rows={3} autoFocus placeholder="Write your reply..." aria-label="Reply" disabled={sending}
                    className="w-full rounded-xl border border-line-strong bg-surface-muted px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => send(t)} disabled={sending || regenerating || !draft.trim()} aria-busy={sending} className="rounded-xl bg-primary hover:bg-primary-hover px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 transition-all">
                      {sending ? 'Sending...' : 'Send reply'}
                    </button>
                    <button type="button" onClick={() => regenerate(t)} disabled={regenerating || sending} aria-busy={regenerating} className="rounded-xl border border-indigo-500/30 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-2 text-xs font-semibold text-accent hover:bg-indigo-50 dark:hover:bg-indigo-900/40 disabled:opacity-50 transition-all">
                      {regenerating ? 'Thinking...' : 'AI Suggest'}
                    </button>
                    <button type="button" onClick={() => { setOpenId(null); setError(null); }} disabled={sending} className="rounded-xl border border-line bg-surface-muted px-4 py-2 text-xs font-semibold text-fg-muted hover:bg-surface-hover hover:text-fg transition-all">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => openReply(t)} className="mt-3.5 text-xs font-semibold text-accent hover:text-accent-hover transition-colors">Reply</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
