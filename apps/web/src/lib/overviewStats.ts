// Pure helpers behind the Overview page: the header health badge and the stat-card sparklines.
import type { MetricKey, ReportRow } from '@/lib/analyticsReport';

export type SystemStatus = { tone: 'ok' | 'warn' | 'error'; label: string };

/**
 * Header badge: "All systems normal" only when nothing failed. A few failures are amber, 5+ are red.
 */
export function getSystemStatus(failedPostCount: number): SystemStatus {
  if (!Number.isFinite(failedPostCount) || failedPostCount <= 0) return { tone: 'ok', label: 'All systems normal' };
  const label = `${failedPostCount} post${failedPostCount === 1 ? '' : 's'} need${failedPostCount === 1 ? 's' : ''} attention`;
  return { tone: failedPostCount >= 5 ? 'error' : 'warn', label };
}

/**
 * Per-day totals of one metric over the last `days` days (oldest first), bucketed by the day the post was created.
 * Rows where the platform does not report the metric (null) are skipped. Returns null when there is nothing worth
 * drawing (no data, or fewer than two days with a non-zero value) so the card can omit the sparkline.
 */
export function buildDailySeries(rows: ReportRow[], metric: MetricKey, nowMs: number, days = 30): number[] | null {
  if (days < 2) return null;
  const dayMs = 86_400_000;
  const end = nowMs;
  const start = end - days * dayMs;
  const buckets = new Array<number>(days).fill(0);
  for (const r of rows) {
    const v = r[metric];
    if (v === null || !r.postedAt) continue;
    const t = new Date(r.postedAt).getTime();
    if (!Number.isFinite(t) || t < start || t > end) continue;
    const idx = Math.min(days - 1, Math.floor((t - start) / dayMs));
    buckets[idx] += v;
  }
  const nonZeroDays = buckets.filter((b) => b > 0).length;
  return nonZeroDays >= 2 ? buckets : null;
}

/** SVG path ("M x,y L ...") for a series in a width x height box with a little vertical padding. */
export function sparklinePath(values: number[], width = 100, height = 24, pad = 2): string {
  if (values.length < 2) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}
