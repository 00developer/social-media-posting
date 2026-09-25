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

  const range = RANGES.find((r) => r.id === rangeId)!;

  // The analytics-service saves new numbers every few minutes, and nothing else tells this page about them, so
  // re-read the team data every minute while the tab is visible (and as soon as it becomes visible again).
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') fetchTeamData(); };
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
  const rangeStart = range.days === null ? null : Date.now() - range.days * 86400000;

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
      <button type="button" onClick={() => toggleSort(key)} className="uppercase tracking-wider hover:text-gray-900">{label}{arrow(key)}</button>
    </th>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
          <p className="text-sm text-gray-500 mt-1">
            How your posts are performing on each platform.
            {lastUpdated && <> Last updated {lastUpdated.toLocaleString()}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={rangeId} onChange={(e) => setRangeId(e.target.value as typeof rangeId)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700" aria-label="Date range">
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button type="button" onClick={() => { fetchTeamData(); setRefreshTick((t) => t + 1); }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Refresh</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {['all', ...platformsWithStats].map((p) => (
          <button key={p} type="button" onClick={() => setPlatform(p)}
            className={`rounded-full border px-4 py-1.5 text-sm capitalize transition-colors ${platform === p ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {p === 'all' ? 'All platforms' : p}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Total {m.label}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{formatCount(summary[m.key])}</div>
          </div>
        ))}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Posts tracked</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{summary.posts}</div>
          <div className="text-xs text-gray-500">{summary.platforms} platform{summary.platforms === 1 ? '' : 's'}</div>
        </div>
      </div>

      {best && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-indigo-500">Best performing post</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-gray-900 truncate max-w-md">{best.caption || '(no caption)'}</span>
            <span className="text-sm capitalize text-gray-600">on {best.platform}</span>
            <span className="text-sm text-gray-700">
              {best.views ? `${formatCount(best.views)} views` : `${formatCount(best.likes ?? 0)} likes`}
            </span>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-900">Growth over time</h3>
          <div className="flex gap-1" role="group" aria-label="Chart mode">
            {([['gain', 'New since tracking'], ['total', 'Running total']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setChartMode(id)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${chartMode === id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {METRICS.map((m) => (
              <button key={m.key} type="button" onClick={() => setChartMetric(m.key)}
                title={availableMetrics.includes(m.key) ? undefined : 'This platform does not provide this number'}
                className={`rounded-md px-3 py-1 text-xs font-medium ${chartMetric === m.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'} ${availableMetrics.includes(m.key) ? '' : 'opacity-40'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {historyReady ? (
          <AnalyticsChart data={chart} metricLabel={METRICS.find((m) => m.key === chartMetric)!.label} mode={chartMode} />
        ) : (
          <p className="py-10 text-center text-sm text-gray-500">Loading history...</p>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => toggleSort('postedAt')} className="uppercase tracking-wider hover:text-gray-900">Post{arrow('postedAt')}</button>
                    <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Filter posts by platform"
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium tracking-normal text-gray-700 capitalize">
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
            <tbody className="divide-y divide-gray-100">
              {sorted.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No analytics for this selection yet. Stats appear a few minutes after a post is published.</td></tr>
              )}
              {sorted.map((r) => (
                <tr key={r.key} className="hover:bg-gray-50/60">
                  <td className="max-w-xs px-4 py-3">
                    <div className="truncate font-medium text-gray-900" title={r.caption}>{r.caption || '(no caption)'}</div>
                    <div className="text-xs text-gray-400">{r.postedAt ? new Date(r.postedAt).toLocaleDateString() : ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 capitalize text-gray-700">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(r.platform) }} />
                      {r.platform}
                    </span>
                    {r.note && <div className="text-xs text-gray-400" title={r.note}>{r.note}</div>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(r.views)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(r.likes)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(r.comments)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(r.shares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">A dash (-) means the platform does not provide that number, which is different from 0.</p>
      </div>

      {missingNotes.length > 0 && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-600">Connected, but no stats yet</div>
          <ul className="space-y-2 text-sm text-amber-900">
            {missingNotes.map((p) => (
              <li key={p}><span className="font-semibold capitalize">{p}:</span> {PLATFORM_NOTES[p]}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
