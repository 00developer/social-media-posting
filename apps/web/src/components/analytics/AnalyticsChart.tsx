import React, { useState } from 'react';
import { niceScale, type ChartData } from '@/lib/analyticsReport';

export const PLATFORM_COLORS: Record<string, string> = {
  youtube: '#ef4444',
  facebook: '#3b82f6',
  instagram: '#ec4899',
  threads: '#e2e8f0',
  pinterest: '#f43f5e',
  linkedin: '#0284c7',
  twitter: '#38bdf8',
};
const FALLBACK_COLOR = '#94a3b8';
export const colorFor = (platform: string) => PLATFORM_COLORS[platform] ?? FALLBACK_COLOR;

const W = 660;
const H = 260;
const M = { top: 28, right: 24, bottom: 38, left: 48 };

const shortDay = (day: string) => day.slice(5).replace('-', '/'); // 2026-09-25 -> 09/25
const two = (n: number) => String(n).padStart(2, '0');

function bucketLabel(key: string, granularity: ChartData['granularity'], withDate = false): string {
  if (granularity !== 'hour') return shortDay(key);
  const d = new Date(`${key}:00:00Z`);
  const time = `${two(d.getHours())}:00`;
  return withDate ? `${two(d.getMonth() + 1)}/${two(d.getDate())} ${time}` : time;
}

/** Generates SVG path for a bar with rounded top corners and a flat baseline */
function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const radius = Math.min(r, w / 2, h);
  return `M ${x.toFixed(1)} ${(y + h).toFixed(1)} L ${x.toFixed(1)} ${(y + radius).toFixed(1)} Q ${x.toFixed(1)} ${y.toFixed(1)} ${(x + radius).toFixed(1)} ${y.toFixed(1)} L ${(x + w - radius).toFixed(1)} ${y.toFixed(1)} Q ${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + radius).toFixed(1)} L ${(x + w).toFixed(1)} ${(y + h).toFixed(1)} Z`;
}

/** Luxury Animated Bar Chart with glowing gradients, floating tooltip, and side-by-side platform metrics */
export function AnalyticsChart({ data, metricLabel, mode = 'total' }: { data: ChartData; metricLabel: string; mode?: 'total' | 'gain' }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // Hover previews a platform; a click pins it (stays highlighted after the pointer leaves), click again to unpin.
  const [hoverPlatform, setHoverPlatform] = useState<string | null>(null);
  const [pinnedPlatform, setPinnedPlatform] = useState<string | null>(null);
  const activePlatform = hoverPlatform ?? pinnedPlatform;

  if (data.series.length === 0 || data.days.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">No {metricLabel.toLowerCase()} history for this selection. Either no numbers are saved yet, or this platform does not provide {metricLabel.toLowerCase()} (for example Facebook and Instagram views). Try another metric.</p>;
  }
  if (data.days.length < 2) {
    return <p className="py-10 text-center text-sm text-slate-400">The chart needs at least two days of history. It fills in automatically as stats are collected each day.</p>;
  }

  const ticks = niceScale(Math.max(...data.series.flatMap((s) => s.values.filter((v): v is number => v !== null)), 1));
  const max = ticks[ticks.length - 1];
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const baselineY = M.top + plotH;
  const N = data.days.length;

  // Discrete categorical slot calculation (prevents bars from overflowing left or right margins)
  const slotW = plotW / N;
  const slotCenterX = (dayIdx: number) => M.left + slotW * dayIdx + slotW / 2;
  const y = (v: number) => M.top + plotH - (plotH * v) / max;

  const numPlatforms = data.series.length;
  const maxGroupW = Math.min(slotW * 0.76, 110);
  const barGap = Math.max(3, Math.min(6, slotW * 0.035));
  const barW = Math.max(8, Math.min(22, (maxGroupW - (numPlatforms - 1) * barGap) / numPlatforms));
  const actualGroupW = numPlatforms * barW + (numPlatforms - 1) * barGap;

  const crossesMidnight = data.granularity === 'hour' && new Date(`${data.days[0]}:00:00Z`).getDate() !== new Date(`${data.days[data.days.length - 1]}:00:00Z`).getDate();

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const scale = W / rect.width;
    const svgX = mouseX * scale;

    if (svgX < M.left || svgX > W - M.right) {
      setHoveredIdx(null);
      return;
    }

    const slotIdx = Math.floor((svgX - M.left) / slotW);
    if (slotIdx >= 0 && slotIdx < N) {
      setHoveredIdx(slotIdx);
    } else {
      setHoveredIdx(null);
    }
  };

  const animKey = `bar-${metricLabel}-${mode}-${N}-${data.days[0]}`;

  return (
    <div>
      {/* Scrolls sideways on narrow screens instead of shrinking the text to an unreadable size. */}
      <div className="overflow-x-auto custom-scrollbar -mx-1 px-1">
      <div className="relative min-w-[540px]">
      {/* Floating Glassmorphic Tooltip (inside the chart box so the scroll container never clips it) */}
      {hoveredIdx !== null && (
        <div
          className="pointer-events-none absolute top-0 z-30 flex flex-col gap-1.5 rounded-2xl border border-slate-700/80 bg-slate-900/95 p-3 text-xs shadow-2xl backdrop-blur-2xl transition-all duration-75"
          style={{
            left: `${Math.min(84, Math.max(16, (slotCenterX(hoveredIdx) / W) * 100))}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-1.5 text-[11px] font-bold text-slate-300">
            <span>{bucketLabel(data.days[hoveredIdx], data.granularity, true)}</span>
            <span className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">{mode === 'gain' ? 'New gained' : 'Total'}</span>
          </div>
          <div className="space-y-1.5 pt-0.5">
            {data.series.map((s) => {
              const val = s.values[hoveredIdx];
              if (val === null) return null;
              return (
                <div key={s.platform} className="flex items-center justify-between gap-4 text-[11px]">
                  <span className="flex items-center gap-1.5 capitalize font-medium text-slate-300">
                    <span className="h-2 w-2 rounded-full ring-1 ring-slate-700" style={{ backgroundColor: colorFor(s.platform) }} />
                    {s.platform}
                  </span>
                  <span className="font-bold text-white tabular-nums">
                    {val.toLocaleString()} <span className="font-normal text-slate-400 text-[10px]">{metricLabel.toLowerCase()}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SVG Canvas */}
      <svg
        key={animKey}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto cursor-crosshair overflow-visible select-none"
        role="img"
        aria-label={`${metricLabel} over time by platform`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          {data.series.map((s) => (
            <linearGradient key={s.platform} id={`bar-grad-${s.platform}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorFor(s.platform)} stopOpacity="0.95" />
              <stop offset="40%" stopColor={colorFor(s.platform)} stopOpacity="0.75" />
              <stop offset="100%" stopColor={colorFor(s.platform)} stopOpacity="0.25" />
            </linearGradient>
          ))}
        </defs>

        {/* Horizontal Grid Ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke="#1e293b"
              strokeWidth={1}
              strokeDasharray={t === 0 ? undefined : '3 3'}
            />
            <text
              x={M.left - 12}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="#94a3b8"
              className="font-medium select-none"
            >
              {t}
            </text>
          </g>
        ))}

        {/* X Axis Labels */}
        {data.days.map((day, i) => {
          const showLabel = N <= 10 || i === 0 || i === N - 1 || i % Math.ceil(N / 7) === 0;
          if (!showLabel) return null;
          return (
            <text
              key={day}
              x={slotCenterX(i)}
              y={H - 12}
              textAnchor="middle"
              fontSize={11}
              fill={hoveredIdx === i ? '#ffffff' : '#94a3b8'}
              className="font-medium select-none transition-colors"
            >
              {bucketLabel(day, data.granularity, crossesMidnight)}
            </text>
          );
        })}

        {/* Bar Groups Per Day */}
        {data.days.map((day, dayIdx) => {
          const isDayHovered = hoveredIdx === dayIdx;
          const groupStartX = slotCenterX(dayIdx) - actualGroupW / 2;

          return (
            <g
              key={day}
              opacity={hoveredIdx !== null && !isDayHovered ? 0.4 : 1}
              className="transition-opacity duration-200"
            >
              {/* Pillar Column Hover Highlight */}
              {isDayHovered && (
                <rect
                  x={groupStartX - 6}
                  y={M.top - 6}
                  width={actualGroupW + 12}
                  height={plotH + 10}
                  fill="#6366f1"
                  opacity={0.08}
                  rx={10}
                  className="pointer-events-none"
                />
              )}

              {data.series.map((s, seriesIdx) => {
                const val = s.values[dayIdx];
                if (val === null) return null;

                const barH = val > 0 ? Math.max(5, (plotH * val) / max) : 0;
                const barX = groupStartX + seriesIdx * (barW + barGap);
                const barY = baselineY - barH;
                const isDimmed = activePlatform !== null && activePlatform !== s.platform;
                const isHighlighted = activePlatform === s.platform;

                return (
                  <g
                    key={s.platform}
                    opacity={isDimmed ? 0.2 : 1}
                    className="animate-chart-bar transition-all duration-200"
                    style={{ animationDelay: `${seriesIdx * 80 + dayIdx * 45}ms` }}
                  >
                    <title>{`${s.platform}, ${bucketLabel(data.days[dayIdx], data.granularity)}: ${val}`}</title>

                    {/* Subtle Dark Track Gauge */}
                    <rect
                      x={barX}
                      y={M.top}
                      width={barW}
                      height={plotH}
                      rx={Math.min(4, barW / 2)}
                      fill="#131b2e"
                      opacity={0.35}
                      className="pointer-events-none"
                    />

                    {/* Glowing Bar Body */}
                    {barH > 0 && (
                      <>
                        <path
                          d={roundedTopBar(barX, barY, barW, barH, 4)}
                          fill={`url(#bar-grad-${s.platform})`}
                          stroke={isHighlighted || isDayHovered ? colorFor(s.platform) : 'rgba(255,255,255,0.08)'}
                          strokeWidth={isHighlighted || isDayHovered ? 1.5 : 0.75}
                          className="transition-all duration-200"
                        />
                        {/* Elegant Glowing Top Stroke */}
                        <line
                          x1={barX + 2}
                          x2={barX + barW - 2}
                          y1={barY}
                          y2={barY}
                          stroke={colorFor(s.platform)}
                          strokeWidth={2}
                          strokeLinecap="round"
                          opacity={0.9}
                          className="pointer-events-none"
                        />
                      </>
                    )}

                    {/* Value Badge Directly Above Bar */}
                    {val > 0 && (
                      <text
                        x={barX + barW / 2}
                        y={barY - 6}
                        textAnchor="middle"
                        fontSize={10}
                        fill={isDayHovered || isHighlighted ? '#ffffff' : '#94a3b8'}
                        className={`font-bold select-none tabular-nums transition-colors pointer-events-none ${isDayHovered || isHighlighted ? '' : 'max-sm:hidden'}`}
                      >
                        {val.toLocaleString()}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      </div>
      </div>

      {/* Interactive Platform Legend Pills */}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-300 font-medium">
        {data.series.map((s) => (
          <button
            key={s.platform}
            type="button"
            aria-pressed={pinnedPlatform === s.platform}
            onMouseEnter={() => setHoverPlatform(s.platform)}
            onMouseLeave={() => setHoverPlatform(null)}
            onClick={() => {
              setPinnedPlatform((prev) => (prev === s.platform ? null : s.platform));
              // Drop the hover preview so the new pinned state shows immediately (also after unpinning).
              setHoverPlatform(null);
            }}
            className={`inline-flex items-center gap-1.5 capitalize rounded-full px-2.5 py-1 transition-all ${
              activePlatform === s.platform
                ? 'bg-slate-800 text-white shadow-md ring-1 ring-slate-700'
                : activePlatform !== null
                ? 'opacity-40'
                : 'hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-slate-800 shadow-sm transition-transform"
              style={{
                backgroundColor: colorFor(s.platform),
                transform: activePlatform === s.platform ? 'scale(1.25)' : 'scale(1)',
              }}
            />
            {s.platform}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        {mode === 'gain'
          ? <>Each bar shows the new {metricLabel.toLowerCase()} gained since tracking began, added up over all posts on that platform. Every bar starts at 0; {metricLabel.toLowerCase()} a post had before tracking are not counted.</>
          : <>Each bar shows the running total of {metricLabel.toLowerCase()} across all posts on that platform for each recorded interval.</>}
      </p>
    </div>
  );
}
