import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalyticsChart } from './AnalyticsChart';
import type { ChartData } from '@/lib/analyticsReport';

// Server-side render of the chart for a few shapes of data. React logs a console error when two children share a
// key (that happened when only two days had data), so the test fails on any console error.

function render(data: ChartData) {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const html = renderToStaticMarkup(<AnalyticsChart data={data} metricLabel="Views" />);
  const logged = errors.mock.calls.map((c) => String(c[0]));
  errors.mockRestore();
  return { html, logged };
}

describe('AnalyticsChart', () => {
  it('draws two days of data without duplicate keys and labels both days once', { timeout: 15000 }, () => {
    const { html, logged } = render({ days: ['2026-09-24', '2026-09-25'], series: [{ platform: 'youtube', values: [null, 3] }] });
    expect(logged).toEqual([]);
    expect(html.match(/09\/24/g)).toHaveLength(1);
    expect(html.match(/09\/25/g)).toHaveLength(2); // the axis label + the bar's title
    expect(html).toContain('animate-chart-bar');
  });

  it('omits bars where a platform has no data yet instead of drawing zeros', () => {
    const { html, logged } = render({ days: ['2026-09-23', '2026-09-24', '2026-09-25'], series: [{ platform: 'facebook', values: [null, null, 3] }] });
    expect(logged).toEqual([]);
    expect(html).toContain('facebook, 09/25: 3');
    expect(html).not.toContain('facebook, 09/23');
  });

  it('draws bars for hourly data with proper time axis labels', () => {
    const days = ['2026-09-25T08', '2026-09-25T09', '2026-09-25T10', '2026-09-25T11'];
    const { html, logged } = render({ days, granularity: 'hour', series: [{ platform: 'youtube', values: [1, 1, 4, 4] }] });
    expect(logged).toEqual([]);
    expect(html.match(/youtube, \d\d:00/g)).toHaveLength(4); // 4 bars rendered for the 4 hours
    expect(html.match(/:\d\d<\/text>/g)!.length).toBeGreaterThanOrEqual(2); // HH:00 axis labels
  });

  it('shows a helpful message instead of an empty chart', () => {
    expect(render({ days: [], series: [] }).html).toContain('No views history');
    expect(render({ days: ['2026-09-25'], series: [{ platform: 'youtube', values: [1] }] }).html).toContain('at least two days');
  });
});
