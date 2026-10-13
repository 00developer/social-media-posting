'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '@/components/DashboardProvider';
import { supabase } from '@/lib/supabase';
import { AnalyticsChart, colorFor } from '@/components/analytics/AnalyticsChart';
import { formatCount } from '@/lib/analyticsMetrics';
import {
  bestRow, buildReportRows, buildSeries, filterRows, sortRows, summarize,
  type HistoryPoint, type MetricKey, type SortKey, type StatRow,
} from '@/lib/analyticsReport';

const RANGES = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: 'all', label: 'All time', days: null },
] as const;

const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
];

// Why a connected platform may have no numbers yet (shown only for platforms that are connected but have no stats).
const PLATFORM_NOTES: Record<string, string> = {
  facebook: 'Facebook stats are collected for posts published after tracking was added. Older posts have no saved post id, so they cannot be looked up.',
  instagram: 'Instagram stats are collected for posts published after tracking was added. Views and reach need an extra Meta permission (insights).',
  linkedin: 'LinkedIn only shares post analytics with apps approved for its Community Management API, which this app does not have yet.',
  pinterest: 'Pinterest does not provide analytics in sandbox / trial mode. Real stats need Standard access.',
  threads: 'Threads stats need the insights permission: connect Threads again if you connected it before that permission was added.',
  youtube: 'Stats appear a few minutes after a video is published.',
};

const AUTO_REFRESH_MS = 60_000;

const fmt = (v: number | null) => (v === null ? '-' : formatCount(v));

export default function AnalyticsPage() {
  const { activeTeam, posts, analytics, accounts, fetchTeamData } = useDashboard();
  const [platform, setPlatform] = useState('all');
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]['id']>('30');
  const [chartMetric, setChartMetric] = useState<MetricKey>('views');
  const [chartMode, setChartMode] = useState<'total' | 'gain'>('gain');
  const [sortKey, setSortKey] = useState<SortKey>('postedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  // "Now" for the date-range filter, kept in state (render must not read the clock); bumped on every refresh.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const range = RANGES.find((r) => r.id === rangeId)!;

  // The analytics-service saves new numbers every few minutes, and nothing else tells this page about them, so
  // re-read the team data every minute while the tab is visible (and as soon as it becomes visible again).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      setNowMs(Date.now());
      fetchTeamData();
    };
    const timer = setInterval(refresh, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [fetchTeamData]);

  // History behind the chart. Re-read when the team changes, when the stats change, or on Refresh.
  useEffect(() => {
    if (!activeTeam) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('analytics_history')
        .select('post_id, platform, views, likes, shares, comments, recorded_at')
        .eq('team_id', activeTeam.id)
        .order('recorded_at', { ascending: true })
        .limit(5000);
      if (cancelled) return;
      // The table is created by a migration; until then just show no chart history.
      if (!error) setHistory((data || []) as HistoryPoint[]);
      setHistoryReady(true);
    })();
    return () => { cancelled = true; };
  }, [activeTeam, analytics, refreshTick]);

  const allRows = useMemo(() => buildReportRows(analytics as unknown as StatRow[], posts), [analytics, posts]);
  const platformsWithStats = useMemo(() => [...new Set(allRows.map((r) => r.platform))], [allRows]);
  const rangeStart = range.days === null ? null : nowMs - range.days * 86400000;

  const rows = useMemo(() => filterRows(allRows, { platform, sinceMs: rangeStart }), [allRows, platform, rangeStart]);
  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);
  const summary = useMemo(() => summarize(rows), [rows]);
  const best = useMemo(() => bestRow(rows), [rows]);
  const chart = useMemo(() => buildSeries(history, chartMetric, { platform, days: range.days, mode: chartMode }), [history, chartMetric, platform, range.days, chartMode]);

  // Metrics this platform selection actually reports (a null number means the platform does not provide it).
  const availableMetrics = useMemo(() => METRICS.filter((m) => filterRows(allRows, { platform }).some((r) => r[m.key] !== null)).map((m) => m.key), [allRows, platform]);
  // When the platform changes and the chosen metric does not exist there (e.g. Instagram views), move to one that does.
  useEffect(() => {
    if (availableMetrics.length > 0 && !availableMetrics.includes(chartMetric)) setChartMetric(availableMetrics[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  const lastUpdated = useMemo(() => {
    const times = analytics.map((a) => (typeof a.recorded_at === 'string' ? new Date(a.recorded_at).getTime() : 0)).filter(Boolean);
    return times.length ? new Date(Math.max(...times)) : null;
  }, [analytics]);

  const connected = useMemo(() => [...new Set(accounts.map((a) => a.platform).filter((p): p is string => !!p))], [accounts]);
  const missingNotes = connected.filter((p) => !platformsWithStats.includes(p) && PLATFORM_NOTES[p]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };
  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');
  const th = (key: SortKey, label: string, align = 'text-right') => (
    <th className={`px-4 py-3 ${align} font-semibold`}>
      <button type="button" onClick={() => toggleSort(key)} className="uppercase tracking-wider hover:text-fg text-fg-secondary transition-colors">{label}{arrow(key)}</button>
    </th>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-fg tracking-tight">Analytics</h2>
          <p className="text-sm text-fg-muted mt-1">
            How your posts are performing on each platform.
            {lastUpdated && <> Last updated <strong className="text-fg-secondary">{lastUpdated.toLocaleString()}</strong>.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={rangeId} onChange={(e) => { setNowMs(Date.now()); setRangeId(e.target.value as typeof rangeId); }} className="rounded-xl border border-line bg-surface-muted/90 px-3.5 py-2 text-sm font-medium text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50" aria-label="Date range">
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button type="button" onClick={() => { setNowMs(Date.now()); fetchTeamData(); setRefreshTick((t) => t + 1); }} className="rounded-xl border border-line bg-surface-muted/90 px-3.5 py-2 text-sm font-medium text-fg hover:bg-surface-hover hover:text-fg transition-all shadow-sm">Refresh</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Platform">
        {['all', ...platformsWithStats].map((p) => (
          <button key={p} type="button" onClick={() => setPlatform(p)} aria-pressed={platform === p}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${platform === p ? 'border-line-strong bg-surface-hover text-fg' : 'border-line bg-surface-muted/60 text-fg-muted hover:bg-surface-hover hover:text-fg'}`}>
            {p === 'all' ? 'All platforms' : p}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">Total {m.label}</div>
            <div className="mt-1 text-xl sm:text-2xl font-bold text-fg tracking-tight">{formatCount(summary[m.key])}</div>
          </div>
        ))}
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">Posts tracked</div>
          <div className="mt-1 text-xl sm:text-2xl font-bold text-fg tracking-tight">{summary.posts}</div>
          <div className="mt-0.5 text-xs text-fg-muted">{summary.platforms} platform{summary.platforms === 1 ? '' : 's'}</div>
        </div>
      </div>

      {best && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs font-semibold text-accent flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
            Top Performing Post
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-fg truncate max-w-md">{best.caption || '(no caption)'}</span>
            <span className="text-xs capitalize text-fg-muted">on <strong className="text-fg font-medium">{best.platform}</strong></span>
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {best.views ? `${formatCount(best.views)} views` : `${formatCount(best.likes ?? 0)} likes`}
            </span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface p-4 sm:p-6 shadow-card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-fg text-sm">Growth over time</h3>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chart mode">
            {([['gain', 'New since tracking'], ['total', 'Running total']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setChartMode(id)} aria-pressed={chartMode === id}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${chartMode === id ? 'bg-primary text-white' : 'bg-surface-muted border border-line text-fg-muted hover:bg-surface-hover hover:text-fg'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Metric">
            {METRICS.map((m) => {
              // With no stats at all there is nothing to disable against; otherwise grey out what this selection lacks.
              const unavailable = availableMetrics.length > 0 && !availableMetrics.includes(m.key);
              return (
                <button key={m.key} type="button" onClick={() => setChartMetric(m.key)}
                  disabled={unavailable}
                  aria-pressed={chartMetric === m.key}
                  title={unavailable ? 'This platform does not provide this number' : undefined}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${chartMetric === m.key ? 'bg-primary text-white' : 'bg-surface-muted border border-line text-fg-muted enabled:hover:bg-surface-hover enabled:hover:text-fg'}`}>
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
        {historyReady ? (
          <AnalyticsChart data={chart} metricLabel={METRICS.find((m) => m.key === chartMetric)!.label} mode={chartMode} />
        ) : (
          <p role="status" className="py-10 text-center text-sm text-fg-muted">Loading history...</p>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted/90 border-b border-line text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-3.5 text-left font-semibold">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => toggleSort('postedAt')} className="uppercase tracking-wider hover:text-fg text-fg-secondary transition-colors">Post{arrow('postedAt')}</button>
                    <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Filter posts by platform"
                      className="rounded-md border border-line-strong bg-surface-hover px-2.5 py-1 text-xs font-medium tracking-normal text-fg capitalize focus:outline-none">
                      <option value="all">All platforms</option>
                      {platformsWithStats.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                    </select>
                  </div>
                </th>
                {th('platform', 'Platform', 'text-left')}
                {th('views', 'Views')}
                {th('likes', 'Likes')}
                {th('comments', 'Comments')}
                {th('shares', 'Shares')}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-fg-muted">No analytics for this selection yet. Stats appear a few minutes after a post is published.</td></tr>
              )}
              {sorted.map((r) => (
                <tr key={r.key} className="hover:bg-surface-hover/40 transition-colors">
                  <td className="max-w-xs px-4 py-3.5">
                    <div className="truncate font-medium text-fg" title={r.caption}>{r.caption || '(no caption)'}</div>
                    <div className="text-xs text-fg-muted mt-0.5">{r.postedAt ? new Date(r.postedAt).toLocaleDateString() : ''}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-2 capitalize text-fg font-medium">
                      <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-line" style={{ backgroundColor: colorFor(r.platform) }} />
                      {r.platform}
                    </span>
                    {r.note && <div className="text-xs text-fg-muted mt-0.5" title={r.note}>{r.note}</div>}
                  </td>
                  <td className="px-4 py-3.5 text-right font-medium text-fg tabular-nums">{fmt(r.views)}</td>
                  <td className="px-4 py-3.5 text-right font-medium text-fg tabular-nums">{fmt(r.likes)}</td>
                  <td className="px-4 py-3.5 text-right font-medium text-fg tabular-nums">{fmt(r.comments)}</td>
                  <td className="px-4 py-3.5 text-right font-medium text-fg tabular-nums">{fmt(r.shares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-fg-muted font-medium">A dash (-) means the platform does not provide that number, which is different from 0.</p>
      </div>

      {missingNotes.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 p-5 backdrop-blur-xl">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Connected, but no stats yet</div>
          <ul className="space-y-2 text-sm text-amber-800 dark:text-amber-200/90">
            {missingNotes.map((p) => (
              <li key={p}><span className="font-semibold capitalize text-amber-800 dark:text-amber-100">{p}:</span> {PLATFORM_NOTES[p]}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
