import { describe, expect, it } from 'vitest';
import { bestRow, buildReportRows, buildSeries, filterRows, niceScale, normalizeStats, sortRows, summarize } from './analyticsReport';

const posts = [
  { id: 'p1', content: 'First post', created_at: '2026-09-20T10:00:00Z' },
  { id: 'p2', content: 'Second post', created_at: '2026-09-24T10:00:00Z' },
];

describe('normalizeStats', () => {
  it('moves YouTube comments (stored in shares) into the comments column', () => {
    expect(normalizeStats({ post_id: 'p1', platform: 'youtube', views: 5, likes: 2, shares: 3 })).toEqual({ views: 5, likes: 2, comments: 3, shares: null });
  });

  it('keeps Pinterest clicks as a note, not as shares', () => {
    expect(normalizeStats({ post_id: 'p1', platform: 'pinterest', views: 10, likes: 4, shares: 7 })).toEqual({ views: 10, likes: 4, comments: null, shares: null, note: '7 clicks' });
  });

  it('marks numbers a platform does not provide as null, but keeps real zeros', () => {
    expect(normalizeStats({ post_id: 'p1', platform: 'facebook', views: 0, likes: 0, shares: 0, comments: 0 })).toEqual({ views: null, likes: 0, comments: 0, shares: 0 });
    expect(normalizeStats({ post_id: 'p1', platform: 'instagram', views: 0, likes: 3, comments: 1 })).toEqual({ views: null, likes: 3, comments: 1, shares: null });
    expect(normalizeStats({ post_id: 'p1', platform: 'linkedin', views: 0 })).toMatchObject({ views: 0, likes: 0, comments: 0, shares: 0 });
  });
});

describe('normalizeStats for Threads', () => {
  it('reports replies as comments and reposts + quotes as shares', () => {
    expect(normalizeStats({ post_id: 'p1', platform: 'threads', views: 8, likes: 2, comments: 1, shares: 3 })).toEqual({ views: 8, likes: 2, comments: 1, shares: 3 });
  });
});

describe('report rows', () => {
  const stats = [
    { post_id: 'p1', platform: 'youtube', views: 10, likes: 1, shares: 0 },
    { post_id: 'p2', platform: 'youtube', views: 30, likes: 5, shares: 2 },
    { post_id: 'p2', platform: 'facebook', views: 0, likes: 8, shares: 1, comments: 4 },
    { post_id: 'gone', platform: 'youtube', views: 99 },
  ];
  const rows = buildReportRows(stats, posts);

  it('joins stats to their post and drops stats of unknown posts', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ postId: 'p1', platform: 'youtube', caption: 'First post', postedAt: '2026-09-20T10:00:00Z' });
  });

  it('filters by platform and by post date', () => {
    expect(filterRows(rows, { platform: 'facebook' })).toHaveLength(1);
    expect(filterRows(rows, { platform: 'all' })).toHaveLength(3);
    expect(filterRows(rows, { sinceMs: new Date('2026-09-22T00:00:00Z').getTime() }).map((r) => r.postId)).toEqual(['p2', 'p2']);
  });

  it('sorts numerically with unavailable (null) numbers last in both directions', () => {
    expect(sortRows(rows, 'views', 'desc').map((r) => r.key)).toEqual(['p2:youtube', 'p1:youtube', 'p2:facebook']);
    expect(sortRows(rows, 'views', 'asc').map((r) => r.key)).toEqual(['p1:youtube', 'p2:youtube', 'p2:facebook']);
  });

  it('totals only the numbers that exist and counts distinct posts / platforms', () => {
    expect(summarize(rows)).toEqual({ views: 40, likes: 14, comments: 6, shares: 1, posts: 2, platforms: 2 });
  });

  it('picks the best row by views, or by likes when nothing has views', () => {
    expect(bestRow(rows)?.key).toBe('p2:youtube');
    expect(bestRow(filterRows(rows, { platform: 'facebook' }))?.key).toBe('p2:facebook');
    expect(bestRow([])).toBeNull();
  });
});

describe('buildSeries', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const history = [
    { post_id: 'p1', platform: 'youtube', views: 1, likes: 0, shares: 0, recorded_at: '2026-09-23T08:00:00Z' },
    { post_id: 'p1', platform: 'youtube', views: 4, likes: 0, shares: 0, recorded_at: '2026-09-24T09:00:00Z' },
    { post_id: 'p2', platform: 'youtube', views: 10, likes: 0, shares: 0, recorded_at: '2026-09-24T10:00:00Z' },
    { post_id: 'p2', platform: 'facebook', views: 0, likes: 3, shares: 0, comments: 1, recorded_at: '2026-09-25T01:00:00Z' },
  ];

  it('builds one line per platform with the last known value carried forward and summed over posts', () => {
    const data = buildSeries(history, 'views', { days: 3, now });
    expect(data.days).toEqual(['2026-09-23', '2026-09-24', '2026-09-25']);
    expect(data.series).toEqual([{ platform: 'youtube', values: [1, 14, 14] }]); // facebook has no views, so no line
  });

  it('plots likes for platforms that provide them', () => {
    const data = buildSeries(history, 'likes', { days: 3, now });
    expect(data.series).toEqual([
      { platform: 'youtube', values: [0, 0, 0] },
      { platform: 'facebook', values: [null, null, 3] }, // no history before 09-25 is a gap, not a 0
    ]);
  });

  it('can start at the first recorded point and can be limited to one platform', () => {
    const data = buildSeries(history, 'views', { days: null, platform: 'youtube', now });
    expect(data.days[0]).toBe('2026-09-23');
    expect(buildSeries(history, 'views', { days: 3, platform: 'facebook', now }).series).toEqual([]);
  });

  it('starts the range at the first day with data instead of drawing zeros before tracking began', () => {
    const old = [{ post_id: 'p1', platform: 'youtube', views: 3, likes: 0, shares: 0, recorded_at: '2026-09-20T08:00:00Z' }];
    const data = buildSeries(old, 'views', { days: 30, now });
    expect(data.granularity).toBe('day');
    expect(data.days).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']); // begins at the first day with data, not 30 days back
    expect(data.series).toEqual([{ platform: 'youtube', values: [3, 3, 3, 3, 3, 3] }]);
  });

  it('charts per hour while the history is under two days, so a young history still draws a real line', () => {
    const today = [
      { post_id: 'p1', platform: 'youtube', views: 1, likes: 0, shares: 0, recorded_at: '2026-09-25T08:10:00Z' },
      { post_id: 'p1', platform: 'youtube', views: 4, likes: 0, shares: 0, recorded_at: '2026-09-25T10:40:00Z' },
      { post_id: 'p2', platform: 'facebook', views: 9, likes: 2, shares: 0, comments: 1, recorded_at: '2026-09-25T10:15:00Z' },
    ];
    const data = buildSeries(today, 'likes', { days: 30, now }); // now = 2026-09-25 12:00Z
    expect(data.granularity).toBe('hour');
    expect(data.days).toEqual(['2026-09-25T08', '2026-09-25T09', '2026-09-25T10', '2026-09-25T11', '2026-09-25T12']);
    expect(data.series).toEqual([
      { platform: 'youtube', values: [0, 0, 0, 0, 0] },
      { platform: 'facebook', values: [null, null, 2, 2, 2] }, // starts when facebook was first recorded, then carries forward
    ]);
    const views = buildSeries(today, 'views', { days: 30, now });
    expect(views.series).toEqual([
      { platform: 'youtube', values: [1, 1, 4, 4, 4] }, // 08:10 -> 1, 10:40 -> 4, carried forward
      { platform: 'facebook', values: [null, null, 9, 9, 9] },
    ]);
  });

  it('still returns two buckets when everything was recorded in the current hour', () => {
    const justNow = [{ post_id: 'p1', platform: 'youtube', views: 2, likes: 0, shares: 0, recorded_at: '2026-09-25T12:05:00Z' }];
    const data = buildSeries(justNow, 'views', { days: 30, now: new Date('2026-09-25T12:30:00Z') });
    expect(data.days).toEqual(['2026-09-25T11', '2026-09-25T12']);
    expect(data.series).toEqual([{ platform: 'youtube', values: [null, 2] }]);
  });

  it('gain mode starts every line at 0 and counts only what posts earned after their first saved value', () => {
    const data = buildSeries(history, 'views', { days: 3, now, mode: 'gain' });
    // p1: 1 -> 4 (+3 from 09-24); p2 first seen 09-24 with 10 (baseline, +0)
    expect(data.series).toEqual([{ platform: 'youtube', values: [0, 3, 3] }]);
  });

  it('returns nothing when there is no history yet', () => {
    expect(buildSeries([], 'views', { days: 7, now })).toEqual({ days: [], series: [] });
  });
});

describe('niceScale', () => {
  it('gives whole-number ticks with an even step', () => {
    expect(niceScale(0)).toEqual([0, 1]);
    expect(niceScale(1)).toEqual([0, 1]);
    expect(niceScale(5)).toEqual([0, 2, 4, 6]);
    expect(niceScale(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale(9)).toEqual([0, 5, 10]);
    expect(niceScale(100)).toEqual([0, 50, 100]);
  });

  it('always reaches at least the biggest value', () => {
    for (const v of [1, 3, 12, 37, 480, 1234]) expect(niceScale(v).at(-1)!).toBeGreaterThanOrEqual(v);
  });
});
