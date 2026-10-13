import { describe, expect, it } from 'vitest';
import { buildDailySeries, getSystemStatus, sparklinePath } from './overviewStats';
import type { ReportRow } from './analyticsReport';

const NOW = Date.UTC(2026, 9, 13, 12);
const DAY = 86_400_000;

function row(daysAgo: number, views: number | null, platform = 'youtube'): ReportRow {
  return {
    key: `${daysAgo}:${platform}`,
    postId: String(daysAgo),
    platform,
    caption: '',
    postedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    views,
    likes: 1,
    comments: null,
    shares: null,
  };
}

describe('getSystemStatus', () => {
  it('is normal with no failures', () => {
    expect(getSystemStatus(0)).toEqual({ tone: 'ok', label: 'All systems normal' });
  });
  it('uses singular / plural wording and escalates tone', () => {
    expect(getSystemStatus(1)).toEqual({ tone: 'warn', label: '1 post needs attention' });
    expect(getSystemStatus(3)).toEqual({ tone: 'warn', label: '3 posts need attention' });
    expect(getSystemStatus(7).tone).toBe('error');
  });
});

describe('buildDailySeries', () => {
  it('returns null when there is no data or only one day of data', () => {
    expect(buildDailySeries([], 'views', NOW)).toBeNull();
    expect(buildDailySeries([row(1, 10)], 'views', NOW)).toBeNull();
  });

  it('sums values per day, oldest first, ignoring nulls and rows outside the range', () => {
    const series = buildDailySeries([row(0.5, 10), row(0.4, 5), row(2.5, 7), row(3, null), row(40, 99)], 'views', NOW, 5);
    expect(series).toHaveLength(5);
    expect(series![4]).toBe(15);
    expect(series![2]).toBe(7);
    expect(series!.reduce((a, b) => a + b, 0)).toBe(22);
  });

  it('returns null for a metric the platform never reports', () => {
    expect(buildDailySeries([row(1, 1), row(2, 2)], 'comments', NOW)).toBeNull();
  });
});

describe('sparklinePath', () => {
  it('draws one point per value across the full width', () => {
    const d = sparklinePath([0, 5, 10], 100, 24, 2);
    expect(d.startsWith('M0.00,22.00')).toBe(true);
    expect(d).toContain('L50.00,12.00');
    expect(d.endsWith('L100.00,2.00')).toBe(true);
  });
  it('returns empty for fewer than two values', () => {
    expect(sparklinePath([3])).toBe('');
  });
});
