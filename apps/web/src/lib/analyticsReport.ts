// Pure logic behind the Analytics page: turns the raw `analytics` / `analytics_history` rows into comparable
// numbers, tables, totals and chart series.
//
// The raw columns (views / likes / shares / comments) mean different things per platform, so everything goes
// through normalizeStats() first. A `null` number means "this platform does not give us that number"
// (shown as "-"), which is different from a real 0.

export type StatRow = { id?: string; post_id: string; platform?: string; views?: number; likes?: number; shares?: number; comments?: number };
export type PostLite = { id: string; content?: string; created_at?: string };
export type HistoryPoint = StatRow & { recorded_at: string };

export type MetricKey = 'views' | 'likes' | 'comments' | 'shares';
export const METRIC_KEYS: MetricKey[] = ['views', 'likes', 'comments', 'shares'];
export type NormalizedStats = { views: number | null; likes: number | null; comments: number | null; shares: number | null; note?: string };

const n = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Maps a raw analytics row onto Views / Likes / Comments / Shares; null where the platform has no such number. */
export function normalizeStats(stat: StatRow): NormalizedStats {
  const views = n(stat.views);
  const likes = n(stat.likes);
  const shares = n(stat.shares);
  const comments = n(stat.comments);

  switch (stat.platform) {
    case 'youtube': // comments are stored in `shares` by the YouTube sync
      return { views, likes, comments: shares, shares: null };
    case 'pinterest': // impressions / saves / outbound clicks (clicks are stored in `shares`)
      return { views, likes, comments: null, shares: null, note: `${shares} clicks` };
    case 'threads': // comments = replies, shares = reposts + quotes
      return { views, likes, comments, shares };
    case 'facebook':
      return { views: views > 0 ? views : null, likes, comments, shares };
    case 'instagram':
      return { views: views > 0 ? views : null, likes, comments, shares: null };
    case 'linkedin':
      return { views, likes, comments, shares };
    default:
      return { views, likes, comments: null, shares };
  }
}

export type ReportRow = NormalizedStats & { key: string; postId: string; platform: string; caption: string; postedAt: string | null };

/** One row per post + platform that has stats. Stats whose post is unknown (e.g. deleted) are dropped. */
export function buildReportRows(stats: StatRow[], posts: PostLite[]): ReportRow[] {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const rows: ReportRow[] = [];
  for (const stat of stats) {
    const post = byId.get(stat.post_id);
    if (!post) continue;
    rows.push({
      key: `${stat.post_id}:${stat.platform}`,
      postId: stat.post_id,
      platform: stat.platform || 'unknown',
      caption: (post.content || '').trim(),
      postedAt: post.created_at ?? null,
      ...normalizeStats(stat),
    });
  }
  return rows;
}

export function filterRows(rows: ReportRow[], opts: { platform?: string; sinceMs?: number | null }): ReportRow[] {
  return rows.filter((r) => {
    if (opts.platform && opts.platform !== 'all' && r.platform !== opts.platform) return false;
    if (opts.sinceMs != null) {
      if (!r.postedAt) return false;
      if (new Date(r.postedAt).getTime() < opts.sinceMs) return false;
    }
    return true;
  });
}

export type SortKey = MetricKey | 'postedAt' | 'platform';

/** Sorts a copy; numbers the platform does not provide (null) always go last. */
export function sortRows(rows: ReportRow[], key: SortKey, dir: 'asc' | 'desc'): ReportRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'platform') return sign * a.platform.localeCompare(b.platform);
    if (key === 'postedAt') return sign * ((a.postedAt ? new Date(a.postedAt).getTime() : 0) - (b.postedAt ? new Date(b.postedAt).getTime() : 0));
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sign * (av - bv);
  });
}

export type Summary = { views: number; likes: number; comments: number; shares: number; posts: number; platforms: number };

export function summarize(rows: ReportRow[]): Summary {
  const total: Summary = { views: 0, likes: 0, comments: 0, shares: 0, posts: new Set(rows.map((r) => r.postId)).size, platforms: new Set(rows.map((r) => r.platform)).size };
  for (const r of rows) for (const k of METRIC_KEYS) total[k] += r[k] ?? 0;
  return total;
}

/** The row with the most views (or, when nothing has views, the most likes). */
export function bestRow(rows: ReportRow[]): ReportRow | null {
  const score = (r: ReportRow, key: 'views' | 'likes') => r[key] ?? 0;
  const key: 'views' | 'likes' = rows.some((r) => score(r, 'views') > 0) ? 'views' : 'likes';
  let best: ReportRow | null = null;
  for (const r of rows) {
    if (score(r, key) <= 0) continue;
    if (!best || score(r, key) > score(best, key)) best = r;
  }
  return best;
}

/** `null` = no history yet for that day (before the platform was tracked), which is not the same as 0. */
export type Series = { platform: string; values: (number | null)[] };
/** `days` holds one key per bucket: '2026-09-25' (day) or '2026-09-25T10' (UTC hour). */
export type ChartData = { days: string[]; series: Series[]; granularity?: 'day' | 'hour' };

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
// While there is less than this much history, chart per hour so a young history still draws real lines.
const HOURLY_BELOW_MS = 2 * DAY_MS;

/**
 * Totals of one metric over time, one line per platform. A post's value in a bucket is its last recorded value up to
 * the end of that bucket (so it carries forward while nothing changes); the platform line is the sum over its posts.
 *
 * Buckets are hours while the history is under two days long, otherwise days (UTC). `days` = how many days back from
 * today for daily buckets (null = from the first recorded point). Buckets before the first recorded point are left
 * empty (null) rather than drawn as 0. The time range is shared by all platforms (it starts at the first recorded point of any platform).
 */
export function buildSeries(history: HistoryPoint[], metric: MetricKey, opts: { platform?: string; days: number | null; now?: Date; mode?: 'total' | 'gain' }): ChartData {
  const now = opts.now ?? new Date();
  if (history.length === 0) return { days: [], series: [] };
  const points = history.filter((h) => !opts.platform || opts.platform === 'all' || h.platform === opts.platform);

  // The time axis comes from ALL history, not the selected platform, so every platform (and "All platforms") is
  // drawn on the same time range and lines can be compared.
  const firstMs = Math.min(...history.map((p) => new Date(p.recorded_at).getTime()));
  const hourly = now.getTime() - firstMs <= HOURLY_BELOW_MS;
  const size = hourly ? HOUR_MS : DAY_MS;
  const floor = (ms: number) => Math.floor(ms / size) * size; // UTC hour / UTC day boundary
  const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, hourly ? 13 : 10); // 2026-09-25T10 / 2026-09-25

  const end = floor(now.getTime());
  let start: number;
  if (hourly || opts.days == null) start = floor(firstMs);
  else start = Math.max(end - (opts.days - 1) * DAY_MS, floor(firstMs)); // never earlier than the first recorded point
  if (hourly && start === end) start = end - HOUR_MS; // always at least two buckets

  const starts: number[] = [];
  for (let t = start; t <= end; t += size) starts.push(t);
  const days = starts.map(keyOf);

  // group by platform -> post, each sorted by time
  const groups = new Map<string, Map<string, HistoryPoint[]>>();
  for (const p of points) {
    const platform = p.platform || 'unknown';
    if (!groups.has(platform)) groups.set(platform, new Map());
    const perPost = groups.get(platform)!;
    perPost.set(p.post_id, [...(perPost.get(p.post_id) || []), p]);
  }

  const series: Series[] = [];
  for (const [platform, perPost] of groups) {
    const values: (number | null)[] = starts.map(() => null);
    let hasData = false;
    for (const list of perPost.values()) {
      list.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
      const baseline = list.map((p) => normalizeStats(p)[metric]).find((v) => v !== null) ?? null;
      starts.forEach((bucketStart, i) => {
        const bucketEnd = bucketStart + size - 1;
        let last: HistoryPoint | null = null;
        for (const p of list) { if (new Date(p.recorded_at).getTime() <= bucketEnd) last = p; else break; }
        if (!last) return;
        const current = normalizeStats(last)[metric];
        if (current === null) return;
        // 'gain' = what the post earned since tracking began for it (its first saved value is the baseline).
        const value = opts.mode === 'gain' ? Math.max(0, current - (baseline ?? 0)) : current;
        hasData = true;
        values[i] = (values[i] ?? 0) + value;
      });
    }
    if (hasData) series.push({ platform, values });
  }

  const granularity = hourly ? 'hour' : 'day';
  return { days, series, granularity };
}

/** Round y-axis ticks: whole numbers with an even step (1, 2, 5, 10, ...), from 0 up to just above the max. */
export function niceScale(maxValue: number): number[] {
  const max = Math.max(1, Math.ceil(maxValue));
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return ticks;
}
