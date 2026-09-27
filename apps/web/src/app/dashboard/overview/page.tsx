'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useDashboard } from '@/components/DashboardProvider';
import { supabase } from '@/lib/supabase';
import { buildReportRows, filterRows, summarize, bestRow, type StatRow } from '@/lib/analyticsReport';
import { formatCount } from '@/lib/analyticsMetrics';
import { isPostFailed } from '@/lib/postRetry';
import { deriveCalendarStatus, getPostStart } from '@/lib/calendarStatus';
import { buildThreads, filterThreads, type CommentRow } from '@/lib/commentThreads';
import { colorFor } from '@/components/analytics/AnalyticsChart';

// Every platform the composer lets you pick, so "not connected" has something to compare against.
// (Kept in sync by hand with the same list in PostComposer.tsx / accounts/page.tsx - there is no shared
// constant for it yet in this codebase.)
const ALL_PLATFORMS = ['twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'pinterest', 'threads'];
const RANGE_DAYS = 30;

export default function OverviewPage() {
  const { activeTeam, posts, analytics, accounts } = useDashboard();
  const [commentRows, setCommentRows] = useState<CommentRow[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [aiUsage, setAiUsage] = useState<number | null>(null);

  useEffect(() => {
    if (!activeTeam) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('post_comments')
        .select('id, post_id, platform, external_comment_id, parent_external_id, author_name, text, commented_at, is_own, ai_status, ai_suggested_reply')
        .eq('team_id', activeTeam.id)
        .order('commented_at', { ascending: false })
        .limit(2000);
      if (!cancelled) { if (!error) setCommentRows((data || []) as CommentRow[]); setCommentsLoaded(true); }

      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const { count } = await supabase.from('ai_usage').select('*', { count: 'exact', head: true }).eq('team_id', activeTeam.id).gte('created_at', monthStart.toISOString());
      if (!cancelled) setAiUsage(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [activeTeam]);

  const rangeStart = Date.now() - RANGE_DAYS * 86400000;
  const reportRows = useMemo(() => buildReportRows(analytics as unknown as StatRow[], posts), [analytics, posts]);
  const recentRows = useMemo(() => filterRows(reportRows, { sinceMs: rangeStart }), [reportRows, rangeStart]);
  const summary = useMemo(() => summarize(recentRows), [recentRows]);
  const best = useMemo(() => bestRow(recentRows), [recentRows]);

  const failedPosts = useMemo(() => posts.filter((p) => isPostFailed(p)), [posts]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return posts
      .filter((p) => deriveCalendarStatus(p) === 'scheduled')
      .map((p) => ({ post: p, start: getPostStart(p) }))
      .filter((x): x is { post: typeof posts[number]; start: string } => !!x.start && new Date(x.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 3);
  }, [posts]);

  const threads = useMemo(() => buildThreads(commentRows), [commentRows]);
  const unanswered = useMemo(() => filterThreads(threads, { status: 'unanswered' }), [threads]);
  const flagged = useMemo(() => unanswered.filter((t) => t.root.ai_status === 'flagged_negative'), [unanswered]);

  const connectedPlatforms = useMemo(() => [...new Set(accounts.map((a) => a.platform).filter((p): p is string => !!p))], [accounts]);
  const notConnected = ALL_PLATFORMS.filter((p) => !connectedPlatforms.includes(p));

  const needsAttentionCount = failedPosts.length + unanswered.length;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
        <p className="mt-1 text-sm text-gray-500">Everything about {activeTeam?.name || 'your team'}, at a glance.</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(['views', 'likes', 'comments', 'shares'] as const).map((k) => (
          <div key={k} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">{k} (last {RANGE_DAYS}d)</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{formatCount(summary[k])}</div>
          </div>
        ))}
      </div>

      {/* Needs your attention */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-gray-900">
          Needs your attention {needsAttentionCount > 0 && <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{needsAttentionCount}</span>}
        </h3>
        {!commentsLoaded ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : needsAttentionCount === 0 && notConnected.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing waiting on you right now.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {failedPosts.length > 0 && (
              <li className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2">
                <span className="text-red-800">{failedPosts.length} post{failedPosts.length === 1 ? '' : 's'} failed to publish</span>
                <Link href="/dashboard/posts" className="font-medium text-red-700 hover:underline">Review</Link>
              </li>
            )}
            {flagged.length > 0 && (
              <li className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2">
                <span className="text-red-800">⚠ {flagged.length} comment{flagged.length === 1 ? '' : 's'} flagged as needing your judgement</span>
                <Link href="/dashboard/comments" className="font-medium text-red-700 hover:underline">Review</Link>
              </li>
            )}
            {unanswered.length - flagged.length > 0 && (
              <li className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2">
                <span className="text-amber-800">{unanswered.length - flagged.length} comment{unanswered.length - flagged.length === 1 ? '' : 's'} waiting for a reply</span>
                <Link href="/dashboard/comments" className="font-medium text-amber-700 hover:underline">Reply</Link>
              </li>
            )}
            {notConnected.length > 0 && (
              <li className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span className="capitalize text-gray-600">Not connected yet: {notConnected.join(', ')}</span>
                <Link href="/dashboard/accounts" className="font-medium text-indigo-600 hover:underline">Connect</Link>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Upcoming posts */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Upcoming posts</h3>
            <Link href="/dashboard/calendar" className="text-sm font-medium text-indigo-600 hover:underline">View calendar</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing scheduled. <Link href="/dashboard/posts" className="text-indigo-600 hover:underline">Create a post</Link>.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map(({ post, start }) => (
                <li key={post.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <span className="truncate text-gray-800">{(post.content || '(no caption)').trim().slice(0, 60)}</span>
                  <span className="shrink-0 text-xs text-gray-500">{new Date(start).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Connected accounts */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Connected accounts</h3>
            <Link href="/dashboard/accounts" className="text-sm font-medium text-indigo-600 hover:underline">Manage</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_PLATFORMS.map((p) => (
              <span key={p} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium capitalize ${connectedPlatforms.includes(p) ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-400'}`}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: connectedPlatforms.includes(p) ? colorFor(p) : '#d1d5db' }} />
                {p}
              </span>
            ))}
          </div>
        </div>

        {/* Best performing post */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Best performing post ({RANGE_DAYS}d)</h3>
          {best ? (
            <div>
              <p className="truncate text-sm font-medium text-gray-900">{best.caption || '(no caption)'}</p>
              <p className="mt-1 text-sm capitalize text-gray-500">
                on {best.platform} · {best.views ? `${formatCount(best.views)} views` : `${formatCount(best.likes ?? 0)} likes`}
              </p>
              <Link href="/dashboard/analytics" className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:underline">See all analytics</Link>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No stats yet in the last {RANGE_DAYS} days.</p>
          )}
        </div>

        {/* AI Assistant usage */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">AI Assistant</h3>
            <Link href="/dashboard/ai-assistant" className="text-sm font-medium text-indigo-600 hover:underline">Open</Link>
          </div>
          <p className="text-2xl font-bold text-gray-900">{aiUsage === null ? '...' : formatCount(aiUsage)}</p>
          <p className="text-sm text-gray-500">generations this month (captions, comment replies)</p>
        </div>
      </div>
    </div>
  );
}
