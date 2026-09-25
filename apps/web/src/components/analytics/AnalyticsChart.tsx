import React from 'react';
import { niceScale, type ChartData } from '@/lib/analyticsReport';

export const PLATFORM_COLORS: Record<string, string> = {
  youtube: '#dc2626',
  facebook: '#2563eb',
  instagram: '#db2777',
  threads: '#111827',
  pinterest: '#e11d48',
  linkedin: '#0369a1',
  twitter: '#0ea5e9',
};
const FALLBACK_COLOR = '#6b7280';
export const colorFor = (platform: string) => PLATFORM_COLORS[platform] ?? FALLBACK_COLOR;

const W = 640;
const H = 260;
const M = { top: 16, right: 16, bottom: 32, left: 44 };

// Consecutive days that have a value: [[dayIndex, value], ...] per run.
function runs(values: (number | null)[]): [number, number][][] {
  const out: [number, number][][] = [];
  let current: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) { if (current.length) out.push(current); current = []; } else current.push([i, v]);
  });
  if (current.length) out.push(current);
  return out;
}

const shortDay = (day: string) => day.slice(5).replace('-', '/'); // 2026-09-25 -> 09/25
const two = (n: number) => String(n).padStart(2, '0');

// Label for one bucket key: a day ("2026-09-25" -> "09/25") or a UTC hour ("2026-09-25T10" -> local "15:30"-style time,
// with the date in front when asked).
function bucketLabel(key: string, granularity: ChartData['granularity'], withDate = false): string {
  if (granularity !== 'hour') return shortDay(key);
  const d = new Date(`${key}:00:00Z`);
  const time = `${two(d.getHours())}:00`;
  return withDate ? `${two(d.getMonth() + 1)}/${two(d.getDate())} ${time}` : time;
}

/** Line chart with one line per platform, drawn as plain SVG (no chart library). */
export function AnalyticsChart({ data, metricLabel, mode = 'total' }: { data: ChartData; metricLabel: string; mode?: 'total' | 'gain' }) {
  if (data.series.length === 0 || data.days.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-500">No {metricLabel.toLowerCase()} history for this selection. Either no numbers are saved yet, or this platform does not provide {metricLabel.toLowerCase()} (for example Facebook and Instagram views). Try another metric.</p>;
  }
  if (data.days.length < 2) {
    return <p className="py-10 text-center text-sm text-gray-500">The chart needs at least two days of history. It fills in automatically as stats are collected each day.</p>;
  }

  const ticks = niceScale(Math.max(...data.series.flatMap((s) => s.values.filter((v): v is number => v !== null)), 1));
  const max = ticks[ticks.length - 1];
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (plotW * i) / (data.days.length - 1);
  const y = (v: number) => M.top + plotH - (plotH * v) / max;
  // First, middle and last day. With only two days the middle one is the same as the first, so drop repeats.
  const labelIdx = [...new Set([0, Math.floor((data.days.length - 1) / 2), data.days.length - 1])];
  // Hourly labels only need a date when the range crosses local midnight.
  const crossesMidnight = data.granularity === 'hour' && new Date(`${data.days[0]}:00:00Z`).getDate() !== new Date(`${data.days[data.days.length - 1]}:00:00Z`).getDate();

  const single = data.series.filter((s) => s.values.filter((v) => v !== null).length === 1).map((s) => s.platform);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${metricLabel} over time by platform`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#6b7280">{t}</text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : i === data.days.length - 1 ? 'end' : 'middle'} fontSize={11} fill="#6b7280">{bucketLabel(data.days[i], data.granularity, crossesMidnight)}</text>
        ))}
        {data.series.map((s) => (
          <g key={s.platform}>
            {runs(s.values).map((run, k) => (
              <polyline key={k} fill="none" stroke={colorFor(s.platform)} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" points={run.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')} />
            ))}
            {s.values.map((v, i) => v === null ? null : (
              <circle key={i} cx={x(i)} cy={y(v)} r={data.days.length > 20 ? 0 : 3} fill={colorFor(s.platform)}>
                <title>{`${s.platform}, ${bucketLabel(data.days[i], data.granularity, true)}: ${v}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
        {data.series.map((s) => (
          <span key={s.platform} className="inline-flex items-center gap-1.5 capitalize">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(s.platform) }} />
            {s.platform}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {mode === 'gain'
          ? <>Each line shows the new {metricLabel.toLowerCase()} gained since tracking began, added up over all posts on that platform. Every line starts at 0; {metricLabel.toLowerCase()} a post had before tracking are not counted.</>
          : <>Each line is the running total of {metricLabel.toLowerCase()} across all posts on that platform, saved about every hour. A line starts when tracking began for that platform, because earlier numbers are not known.</>}
        {single.length > 0 && <> {single.map((p) => p[0].toUpperCase() + p.slice(1)).join(', ')} {single.length === 1 ? 'has' : 'have'} only one saved point so far (shown as a dot); the line appears after the next update.</>}
      </p>
    </div>
  );
}
