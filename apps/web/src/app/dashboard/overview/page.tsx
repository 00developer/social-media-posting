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
import { buildDailySeries, getSystemStatus, sparklinePath } from '@/lib/overviewStats';
import { isVideoUrl, parseMediaMap } from '@/lib/calendarEdit';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { VideoPlayer } from '@/components/post/PlatformPreviewCard';
import {
  Eye,
  Heart,
  MessageCircle,
  Share2,
  AlertTriangle,
  Calendar,
  Sparkles,
  ArrowUpRight,
  CheckCircle2,
  PlusCircle,
  PenSquare,
  ShieldAlert,
  Clock,
  ChevronRight,
  Award,
} from 'lucide-react';

/* Platform brand config (badge classes are tuned for both light and dark themes) */
const ALL_PLATFORMS = [
  {
    id: 'youtube',
    name: 'YouTube',
    color: '#EF4444',
    bg: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    icon: (
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    id: 'instagram',
    name: 'Instagram',
    color: '#EC4899',
    bg: 'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/20',
    icon: (
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
    ),
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: '#3B82F6',
    bg: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    icon: (
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M9 8H6v4h3v12h5V12h3.642L18 8h-4V6.333C14 5.374 14.5 5 15.75 5H18V0h-3.808C10.597 0 9 1.583 9 4.615V8z"/>
      </svg>
    ),
  },
  {
    id: 'threads',
    name: 'Threads',
    color: 'var(--fg)',
    bg: 'bg-slate-500/10 text-fg-secondary border-line',
    icon: (
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.26 18.3 1.5 15.26 1.5 11.758 1.5 5.32 6.166 0 12.44 0c3.486 0 6.354 1.34 8.292 3.876 1.83 2.394 2.68 5.727 2.457 9.638a1.328 1.328 0 0 1-1.328 1.246 1.329 1.329 0 0 1-1.325-1.401c.4-6.994-3.48-10.7-8.096-10.7-5.023 0-8.232 4.298-8.232 9.1 0 5.626 3.738 9.584 8.48 9.584 3.037 0 5.253-1.455 6.406-4.21a5.614 5.614 0 0 0-4.088-1.745c-3.18 0-5.187 2.02-5.187 4.717 0 2.508 1.944 4.39 4.726 4.39 2.518 0 4.265-1.527 4.908-3.791.24.164.485.318.736.463-1.365 3.197-3.957 4.832-7.397 4.832zm.12-6.347c-1.433 0-2.434-.95-2.434-2.31 0-1.488 1.144-2.5 2.683-2.5.86 0 1.62.298 2.197.863-.33 2.44-1.312 3.947-2.446 3.947z"/>
      </svg>
    ),
  },
  {
    id: 'twitter',
    name: 'Twitter (X)',
    color: '#38BDF8',
    bg: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
    icon: (
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    color: '#60A5FA',
    bg: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    icon: (
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
      </svg>
    ),
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    color: 'var(--fg)',
    bg: 'bg-slate-500/10 text-fg-secondary border-line',
    icon: (
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
      </svg>
    ),
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    color: '#F87171',
    bg: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    icon: (
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.627 0 11.983-5.367 11.983-11.987 0-6.62-5.356-11.987-11.983-11.987z"/>
      </svg>
    ),
  },
];

const RANGE_DAYS = 30;

/* Minimal sparkline drawn from real per-day totals (see buildDailySeries); nothing is drawn without data. */
function MetricSparkline({ color, id, values }: { color: string; id: string; values: number[] | null }) {
  if (!values) return <div className="h-6 mt-2.5" aria-hidden="true" />;
  const line = sparklinePath(values, 100, 24);
  return (
    <div className="relative h-6 w-full mt-2.5 overflow-hidden pointer-events-none" aria-hidden="true">
      <svg className="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none" fill="none">
        <defs>
          <linearGradient id={`spark-grad-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={`${line} L100,24 L0,24 Z`} fill={`url(#spark-grad-${id})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export default function OverviewPage() {
  const { user, activeTeam, posts, analytics, accounts } = useDashboard();
  const [commentRows, setCommentRows] = useState<CommentRow[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  // null = loading, 'error' = could not be read (table missing / RLS) - shown as a dash, never as an error.
  const [aiUsage, setAiUsage] = useState<number | 'error' | null>(null);

  // Pure stable timestamp initialized once per mount to comply with React 19 render purity rules
  const [mountTimestamp] = useState(() => Date.now());

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
      if (!cancelled) {
        if (!error) setCommentRows((data || []) as CommentRow[]);
        setCommentsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTeam]);

  useEffect(() => {
    if (!activeTeam) return;
    let cancelled = false;
    (async () => {
      // One ai_usage row per AI generation (caption / classify / reply); count this calendar month's.
      const now = new Date(mountTimestamp);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      try {
        const { count, error } = await supabase
          .from('ai_usage')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', activeTeam.id)
          .gte('created_at', monthStart);
        if (!cancelled) setAiUsage(error ? 'error' : count ?? 0);
      } catch {
        if (!cancelled) setAiUsage('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTeam, mountTimestamp]);

  const allRows = useMemo(() => buildReportRows(analytics as unknown as StatRow[], posts), [analytics, posts]);
  const recentRows = useMemo(() => filterRows(allRows, { sinceMs: mountTimestamp - RANGE_DAYS * 86400000 }), [allRows, mountTimestamp]);
  const summary = useMemo(() => summarize(recentRows), [recentRows]);
  const best = useMemo(() => bestRow(recentRows), [recentRows]);
  const sparks = useMemo(() => ({
    views: buildDailySeries(recentRows, 'views', mountTimestamp, RANGE_DAYS),
    likes: buildDailySeries(recentRows, 'likes', mountTimestamp, RANGE_DAYS),
    comments: buildDailySeries(recentRows, 'comments', mountTimestamp, RANGE_DAYS),
    shares: buildDailySeries(recentRows, 'shares', mountTimestamp, RANGE_DAYS),
  }), [recentRows, mountTimestamp]);
  const bestMedia = useMemo(() => {
    if (!best) return null;
    const post = posts.find((p) => p.id === best.postId);
    const map = parseMediaMap(post?.media_url);
    const raw = map[best.platform] ?? Object.values(map)[0];
    if (!raw) return null;
    const url = resolveMediaUrl(raw);
    return { url, isVideo: isVideoUrl(url) };
  }, [best, posts]);

  const failedPosts = useMemo(() => posts.filter((p) => isPostFailed(p)), [posts]);
  const systemStatus = getSystemStatus(failedPosts.length);
  const statusStyles = {
    ok: { badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400' },
    warn: { badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25', dot: 'bg-amber-400' },
    error: { badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30', dot: 'bg-rose-400' },
  }[systemStatus.tone];

  const upcoming = useMemo(() => {
    return posts
      .filter((p) => deriveCalendarStatus(p) === 'scheduled')
      .map((p) => ({ post: p, start: getPostStart(p) }))
      .filter((x): x is { post: typeof posts[number]; start: string } => !!x.start && new Date(x.start).getTime() > mountTimestamp)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 4);
  }, [posts, mountTimestamp]);

  const threads = useMemo(() => buildThreads(commentRows), [commentRows]);
  const unanswered = useMemo(() => filterThreads(threads, { status: 'unanswered' }), [threads]);
  const flagged = useMemo(() => unanswered.filter((t) => t.root.ai_status === 'flagged_negative'), [unanswered]);

  const connectedPlatformIds = useMemo(
    () => [...new Set(accounts.map((a) => a.platform).filter((p): p is string => !!p))],
    [accounts]
  );
  const notConnected = ALL_PLATFORMS.filter((p) => !connectedPlatformIds.includes(p.id));

  const needsAttentionCount = failedPosts.length + unanswered.length;

  const greetingData = useMemo(() => {
    const currentHour = new Date().getHours();
    const greeting = currentHour < 12 ? 'Good morning' : currentHour < 18 ? 'Good afternoon' : 'Good evening';
    const userName = (user?.user_metadata?.name as string) || (user?.email ? user.email.split('@')[0] : 'Creator');
    const dateFormatted = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    return { greeting, userName, dateFormatted };
  }, [user]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-fg">
      {/* 1. Executive Clean Header */}
      <div className="rounded-xl border border-line bg-surface p-6 sm:p-7 shadow-card">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <h1 className="text-2xl font-bold text-fg tracking-tight">
              {greetingData.greeting}, {greetingData.userName}
            </h1>

            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-fg-muted">
              <span className="text-fg-secondary flex items-center gap-1.5 font-medium">
                <Calendar className="w-3.5 h-3.5 text-fg-muted" />
                {greetingData.dateFormatted}
              </span>
              <span className="text-fg-subtle">•</span>
              {systemStatus.tone === 'ok' ? (
                <span role="status" className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${statusStyles.badge}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusStyles.dot}`} />
                  {systemStatus.label}
                </span>
              ) : (
                <Link
                  href="/dashboard/posts"
                  role="status"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border hover:brightness-95 dark:hover:brightness-125 transition ${statusStyles.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${statusStyles.dot}`} />
                  {systemStatus.label}
                </Link>
              )}
              <span className="text-fg-subtle">•</span>
              <span className="text-fg-muted">
                Workspace: <span className="text-fg font-medium">{activeTeam?.name || 'Default Workspace'}</span>
              </span>
            </div>
          </div>

          {/* Quick Action CTAs */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Link
              href="/dashboard/accounts"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-fg-secondary bg-surface-hover/60 hover:bg-surface-hover border border-line-strong transition-colors shadow-xs"
            >
              <Share2 className="w-3.5 h-3.5 text-fg-muted" />
              <span>Accounts ({connectedPlatformIds.length}/8)</span>
            </Link>

            <Link
              href="/dashboard/posts"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary-hover shadow-xs transition-colors"
            >
              <PenSquare className="w-3.5 h-3.5" />
              <span>Compose Post</span>
            </Link>
          </div>
        </div>
      </div>

      {/* 2. Four Precision KPI Cards (Linear / Stripe Style) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Views */}
        <div className="rounded-xl border border-line bg-surface shadow-card p-5 hover:border-line-strong transition-colors">
          <div className="flex items-center justify-between text-xs font-medium text-fg-muted">
            <span>Total Views</span>
            <Eye className="w-4 h-4 text-fg-subtle" />
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold text-fg tracking-tight">
            {formatCount(summary.views)}
          </div>
          <MetricSparkline color="var(--primary)" id="views" values={sparks.views} />
          <div className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
            <span>Last 30 days</span>
            <span className="text-accent font-medium">Recorded</span>
          </div>
        </div>

        {/* Total Likes */}
        <div className="rounded-xl border border-line bg-surface shadow-card p-5 hover:border-line-strong transition-colors">
          <div className="flex items-center justify-between text-xs font-medium text-fg-muted">
            <span>Total Likes</span>
            <Heart className="w-4 h-4 text-fg-subtle" />
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold text-fg tracking-tight">
            {formatCount(summary.likes)}
          </div>
          <MetricSparkline color="#f43f5e" id="likes" values={sparks.likes} />
          <div className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
            <span>Reactions</span>
            <span className="text-rose-700 dark:text-rose-400 font-medium">Audience</span>
          </div>
        </div>

        {/* Comments */}
        <div className="rounded-xl border border-line bg-surface shadow-card p-5 hover:border-line-strong transition-colors">
          <div className="flex items-center justify-between text-xs font-medium text-fg-muted">
            <span>Comments</span>
            <MessageCircle className="w-4 h-4 text-fg-subtle" />
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold text-fg tracking-tight">
            {formatCount(summary.comments)}
          </div>
          <MetricSparkline color="#f59e0b" id="comments" values={sparks.comments} />
          <div className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
            <span>Conversations</span>
            <span className="text-amber-700 dark:text-amber-400 font-medium">Activity</span>
          </div>
        </div>

        {/* Shares & Reposts */}
        <div className="rounded-xl border border-line bg-surface shadow-card p-5 hover:border-line-strong transition-colors">
          <div className="flex items-center justify-between text-xs font-medium text-fg-muted">
            <span>Shares & Reposts</span>
            <Share2 className="w-4 h-4 text-fg-subtle" />
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-bold text-fg tracking-tight">
            {formatCount(summary.shares)}
          </div>
          <MetricSparkline color="#10b981" id="shares" values={sparks.shares} />
          <div className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
            <span>Amplification</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">Network</span>
          </div>
        </div>
      </div>

      {/* 3. Action Required & Activity Center */}
      <div className="rounded-xl border border-line bg-surface p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center justify-center border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="font-semibold text-fg text-sm flex items-center gap-2">
                <span>Action Required</span>
                {needsAttentionCount > 0 && (
                  <span className="rounded-full bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 px-2 py-0.5 text-[10px] font-medium">
                    {needsAttentionCount} items
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-fg-muted">Platform delivery health and comment moderation</p>
            </div>
          </div>

          <span className="text-[11px] font-medium text-fg-subtle">
            Realtime sync
          </span>
        </div>

        {!commentsLoaded ? (
          <div className="py-6 text-center text-xs text-fg-muted flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span>Checking channel status...</span>
          </div>
        ) : needsAttentionCount === 0 && notConnected.length === 0 ? (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <div>
              <p className="font-medium text-fg">All channels operational</p>
              <p className="text-fg-muted text-[11px] mt-0.5">No failed posts, no pending comments, and all accounts connected.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 text-xs">
            {/* Failed Posts Alert */}
            {failedPosts.length > 0 && (
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-800 dark:text-rose-200">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      {failedPosts.length} post{failedPosts.length === 1 ? '' : 's'} failed delivery
                    </p>
                    <p className="text-fg-muted text-[11px] truncate">
                      Channel rejected upload. Check account authorization or API tokens.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/posts"
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-colors shrink-0 flex items-center gap-1 ml-3"
                >
                  <span>Review & Retry</span>
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            )}

            {/* AI Flagged Comments */}
            {flagged.length > 0 && (
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-800 dark:text-purple-200">
                <div className="flex items-center gap-3 min-w-0">
                  <ShieldAlert className="w-4 h-4 text-purple-700 dark:text-purple-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      {flagged.length} flagged comment{flagged.length === 1 ? '' : 's'}
                    </p>
                    <p className="text-fg-muted text-[11px] truncate">
                      AI sentiment flagged negative replies requiring review.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/comments"
                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition-colors shrink-0 flex items-center gap-1 ml-3"
                >
                  <span>Moderate</span>
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            )}

            {/* Unanswered Comments */}
            {unanswered.length - flagged.length > 0 && (
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200">
                <div className="flex items-center gap-3 min-w-0">
                  <MessageCircle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      {unanswered.length - flagged.length} unanswered comment{unanswered.length - flagged.length === 1 ? '' : 's'}
                    </p>
                    <p className="text-fg-muted text-[11px] truncate">
                      Audience responses waiting for your reply.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/comments"
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs transition-colors shrink-0 flex items-center gap-1 ml-3"
                >
                  <span>Reply</span>
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            )}

            {/* Incomplete Channel Integrations */}
            {notConnected.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-surface-muted border border-line text-fg-secondary gap-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <PlusCircle className="w-4 h-4 text-fg-muted shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      {notConnected.length} account{notConnected.length === 1 ? '' : 's'} not connected
                    </p>
                    <p className="text-fg-muted text-[11px] truncate">
                      Connect {notConnected.map((p) => p.name).slice(0, 4).join(', ')}{notConnected.length > 4 ? '...' : ''} to enable multi-posting.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/accounts"
                  className="px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-surface-strong text-fg border border-line-strong font-medium text-xs transition-colors shrink-0 flex items-center gap-1 self-start sm:self-auto"
                >
                  <span>Connect Accounts</span>
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Balanced 2x2 Grid (Clean Linear Style) */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Card 1: Scheduled Queue */}
        <div className="rounded-xl border border-line bg-surface shadow-card p-6 flex flex-col justify-between">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-accent flex items-center justify-center border border-indigo-500/20">
                  <Calendar className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="font-semibold text-fg text-sm">Scheduled Posts</h3>
                  <p className="text-[11px] text-fg-muted">Queue of upcoming publications</p>
                </div>
              </div>
              <Link
                href="/dashboard/calendar"
                className="text-xs font-medium text-accent hover:text-accent-hover flex items-center gap-0.5"
              >
                <span>Calendar</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {upcoming.length === 0 ? (
              <div className="py-8 text-center bg-surface-muted/40 rounded-xl border border-dashed border-line p-6">
                <Clock className="w-6 h-6 mx-auto text-fg-subtle mb-2" />
                <p className="text-xs font-semibold text-fg mb-1">Queue is empty</p>
                <p className="text-[11px] text-fg-muted mb-4 max-w-xs mx-auto">
                  No upcoming posts scheduled. Plan ahead to maintain consistent audience engagement.
                </p>
                <Link
                  href="/dashboard/posts"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-colors shadow-xs"
                >
                  <PenSquare className="w-3.5 h-3.5" />
                  <span>Schedule a Post</span>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {upcoming.map(({ post, start }) => (
                  <div
                    key={post.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted/60 hover:bg-surface-hover border border-line p-3 text-xs transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-fg">
                        {(post.content || '(Media post without caption)').trim()}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium text-[11px] text-fg-muted bg-surface-hover px-2 py-0.5 rounded-md flex items-center gap-1">
                      <Clock className="w-3 h-3 text-fg-muted" />
                      {new Date(start).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Connected Channels */}
        <div className="rounded-xl border border-line bg-surface shadow-card p-6 flex flex-col justify-between">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                  <Share2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="font-semibold text-fg text-sm">Connected Channels</h3>
                  <p className="text-[11px] text-fg-muted">Integrated social media accounts</p>
                </div>
              </div>
              <Link
                href="/dashboard/accounts"
                className="text-xs font-medium text-accent hover:text-accent-hover flex items-center gap-0.5"
              >
                <span>Manage</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* Progress Bar */}
            <div className="mb-3.5 p-3 rounded-xl bg-surface-muted/60 border border-line">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-fg-secondary font-medium">Channel Coverage</span>
                <span className="text-accent font-semibold">
                  {connectedPlatformIds.length} of {ALL_PLATFORMS.length} Active ({Math.round((connectedPlatformIds.length / ALL_PLATFORMS.length) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-surface-hover h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${(connectedPlatformIds.length / ALL_PLATFORMS.length) * 100}%` }}
                />
              </div>
            </div>

            {/* 8 Channel Badges */}
            <div className="grid grid-cols-2 gap-2">
              {ALL_PLATFORMS.map((p) => {
                const isConnected = connectedPlatformIds.includes(p.id);
                return (
                  <div
                    key={p.id}
                    className={`flex min-w-0 items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-colors ${
                      isConnected
                        ? 'bg-surface-muted border-line-strong'
                        : 'bg-surface-muted/30 border-line opacity-60'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${p.bg}`}>
                      {p.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-fg leading-none whitespace-nowrap">{p.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? 'bg-emerald-400' : 'bg-slate-300 dark:bg-slate-600'}`}
                        />
                        <span className="text-[10px] font-medium text-fg-muted">
                          {isConnected ? 'Active' : 'Not connected'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card 3: Top Performing Post */}
        <div className="rounded-xl border border-line bg-surface shadow-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-700 dark:text-purple-400 flex items-center justify-center border border-purple-500/20">
                <Award className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="font-semibold text-fg text-sm">Top Performing Post</h3>
                <p className="text-[11px] text-fg-muted">Highest reach in the last 30 days</p>
              </div>
            </div>
            <Link
              href="/dashboard/analytics"
              className="text-xs font-medium text-accent hover:text-accent-hover flex items-center gap-0.5"
            >
              <span>Analytics</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {best ? (
            <div className="p-4 rounded-xl bg-surface-muted/60 border border-line">
              <div className="flex items-center justify-between text-[11px] font-medium text-fg-secondary mb-2">
                <span className="capitalize px-2 py-0.5 rounded-md bg-surface-hover text-fg">
                  {best.platform}
                </span>
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                  Top Reach
                </span>
              </div>
              <div className="flex items-start gap-3">
                {bestMedia && (
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-muted">
                    {bestMedia.isVideo ? (
                      <VideoPlayer src={bestMedia.url} className="h-full w-full object-cover" />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={bestMedia.url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                )}
                <p className="min-w-0 line-clamp-2 text-xs text-fg leading-relaxed italic">
                  &ldquo;{best.caption || '(Post visual content)'}&rdquo;
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] pt-2 border-t border-line">
                <span className="text-fg-muted">Engagement:</span>
                <span className="text-fg font-semibold">
                  {best.views ? `${formatCount(best.views)} Views` : `${formatCount(best.likes ?? 0)} Likes`}
                </span>
              </div>
            </div>
          ) : (
            <div className="py-7 text-center text-xs text-fg-muted bg-surface-muted/40 rounded-xl border border-dashed border-line">
              <Award className="w-5 h-5 mx-auto text-fg-subtle mb-1" />
              <span>No posts published in the last 30 days yet.</span>
            </div>
          )}
        </div>

        {/* Card 4: AI Assistant Intelligence */}
        <div className="rounded-xl border border-line bg-surface shadow-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-accent flex items-center justify-center border border-indigo-500/20">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="font-semibold text-fg text-sm">AI Assistant</h3>
                <p className="text-[11px] text-fg-muted">Caption drafting and optimizations</p>
              </div>
            </div>
            <Link
              href="/dashboard/ai-assistant"
              className="text-xs font-medium text-accent hover:text-accent-hover flex items-center gap-0.5"
            >
              <span>Assistant</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="p-4 rounded-xl bg-surface-muted/60 border border-line">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-2xl font-bold text-fg tracking-tight">
                {aiUsage === null ? (
                  <span className="inline-block h-6 w-10 rounded bg-surface-hover animate-pulse align-middle" aria-label="Loading" />
                ) : aiUsage === 'error' ? '—' : formatCount(aiUsage)}
              </span>
              <span className="text-[10px] font-medium text-accent bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                Generations
              </span>
            </div>
            <p className="text-[11px] text-fg-muted mb-3">
              Captions, comment classifications and reply suggestions generated this month.
            </p>

            <div className="flex items-center gap-2 pt-2 border-t border-line">
              <Link
                href="/dashboard/posts"
                className="text-xs font-medium text-accent hover:text-accent-hover transition-colors"
              >
                Compose with AI Assistant &rarr;
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
