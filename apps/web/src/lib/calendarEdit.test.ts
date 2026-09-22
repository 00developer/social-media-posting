import { describe, it, expect } from 'vitest';
import {
  canSaveCaption,
  getCaptionProblem,
  getEditability,
  getPlatformStatuses,
  isVideoUrl,
  MAX_CONTENT_LENGTH,
  parseMediaMap,
  THREADS_MAX_BYTES,
  type EditablePost,
  type PlatformJob,
} from './calendarEdit';
// The server is the real gate; these rules must agree with it (see the parity tests at the bottom).
import { getContentProblem, getEditBlockReason, MAX_CONTENT_LENGTH as SERVER_MAX, THREADS_MAX_BYTES as SERVER_THREADS_MAX } from '../../../../services/post-service/src/editability';

const job = (platform: string, status: string, minute = 1, error_message?: string | null): PlatformJob => ({
  platform,
  status,
  created_at: `2026-09-21T10:${String(minute).padStart(2, '0')}:00Z`,
  ...(error_message !== undefined ? { error_message } : {}),
});
const sched = (platform: string, at: string, minute = 1) => ({ platform, scheduled_at: at, created_at: `2026-09-21T09:${String(minute).padStart(2, '0')}:00Z` });

describe('getPlatformStatuses', () => {
  it('lists one row per platform with the calendar vocabulary (completed → Published)', () => {
    const post: EditablePost = {
      publish_jobs: [job('facebook', 'scheduled'), job('instagram', 'completed'), job('youtube', 'failed', 1, 'quota exceeded'), job('threads', 'processing')],
      schedules: [sched('facebook', '2026-09-23T04:30:00Z'), sched('instagram', '2026-09-23T04:30:00Z'), sched('youtube', '2026-09-23T04:30:00Z'), sched('threads', '2026-09-23T04:30:00Z')],
    };
    const rows = getPlatformStatuses(post);
    expect(rows.map((r) => [r.platform, r.statusKey, r.label])).toEqual([
      ['facebook', 'scheduled', 'Scheduled'],
      ['instagram', 'published', 'Published'],
      ['youtube', 'failed', 'Failed'],
      ['threads', 'processing', 'Processing'],
    ]);
  });

  it('exposes the error message only for failed jobs', () => {
    const rows = getPlatformStatuses({ publish_jobs: [job('facebook', 'failed', 1, 'Token expired'), job('instagram', 'scheduled', 1, 'stale text'), job('youtube', 'failed')] });
    expect(rows.find((r) => r.platform === 'facebook')?.error).toBe('Token expired');
    expect(rows.find((r) => r.platform === 'instagram')?.error).toBeNull();
    expect(rows.find((r) => r.platform === 'youtube')?.error).toBeNull();
  });

  it('uses the latest job per platform after a retry, and its own error', () => {
    const rows = getPlatformStatuses({
      publish_jobs: [job('facebook', 'failed', 1, 'first failure'), job('facebook', 'scheduled', 5), job('instagram', 'failed', 2, 'old'), job('instagram', 'failed', 6, 'newest')],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ platform: 'facebook', statusKey: 'scheduled', error: null });
    expect(rows[1]).toMatchObject({ platform: 'instagram', statusKey: 'failed', error: 'newest' });
  });

  it('gives each platform its own newest schedule time, falling back to the post start', () => {
    const rows = getPlatformStatuses({
      publish_jobs: [job('facebook', 'scheduled'), job('instagram', 'scheduled'), job('youtube', 'scheduled')],
      schedules: [
        sched('facebook', '2026-09-23T04:30:00Z', 1),
        sched('facebook', '2026-09-24T04:30:00Z', 2), // newer row wins (retry / reschedule)
        sched('instagram', '2026-09-25T04:30:00Z', 1),
      ],
    });
    expect(rows.find((r) => r.platform === 'facebook')?.scheduledAt).toBe('2026-09-24T04:30:00Z');
    expect(rows.find((r) => r.platform === 'instagram')?.scheduledAt).toBe('2026-09-25T04:30:00Z');
    // youtube has no schedule row of its own → the post's start time (newest schedule overall)
    expect(rows.find((r) => r.platform === 'youtube')?.scheduledAt).toBe('2026-09-24T04:30:00Z');
  });

  it('lists a platform that only has a schedule (no job yet) as scheduled', () => {
    const rows = getPlatformStatuses({ schedules: [sched('threads', '2026-09-23T04:30:00Z')] });
    expect(rows).toEqual([expect.objectContaining({ platform: 'threads', statusKey: 'scheduled', label: 'Scheduled', error: null, scheduledAt: '2026-09-23T04:30:00Z' })]);
  });

  it('treats an unknown job status as scheduled instead of crashing', () => {
    expect(getPlatformStatuses({ publish_jobs: [job('facebook', 'weird')] })[0].statusKey).toBe('scheduled');
  });

  it('returns nothing for a draft, and null times when nothing is known', () => {
    expect(getPlatformStatuses({})).toEqual([]);
    expect(getPlatformStatuses({ publish_jobs: [job('facebook', 'scheduled')] })[0].scheduledAt).toBeNull();
  });

  it('carries the colour from the shared status table', () => {
    expect(getPlatformStatuses({ publish_jobs: [job('facebook', 'completed')] })[0].color).toBe('#22c55e');
    expect(getPlatformStatuses({ publish_jobs: [job('facebook', 'failed')] })[0].color).toBe('#ef4444');
  });
});

describe('parseMediaMap / isVideoUrl', () => {
  it('parses the per-platform media map', () => {
    expect(parseMediaMap('{"facebook":"https://x/a.jpg","youtube":"https://x/b.mp4"}')).toEqual({ facebook: 'https://x/a.jpg', youtube: 'https://x/b.mp4' });
    expect(parseMediaMap('{}')).toEqual({});
  });

  it('never throws and drops anything that is not a non-empty string url', () => {
    expect(parseMediaMap(undefined)).toEqual({});
    expect(parseMediaMap(null)).toEqual({});
    expect(parseMediaMap('')).toEqual({});
    expect(parseMediaMap('not json')).toEqual({});
    expect(parseMediaMap('[1,2]')).toEqual({});
    expect(parseMediaMap('"str"')).toEqual({});
    expect(parseMediaMap('null')).toEqual({});
    expect(parseMediaMap('{"facebook":"https://x/a.jpg","bad":5,"empty":"","nul":null}')).toEqual({ facebook: 'https://x/a.jpg' });
  });

  it('detects video urls like the timeline does', () => {
    for (const url of ['https://x/a.mp4', 'https://x/a.MOV', 'https://x/a.webm?token=1', 'blob:http://x/1#video']) expect(isVideoUrl(url), url).toBe(true);
    for (const url of ['https://x/a.jpg', 'https://x/a.png?x=1', 'blob:http://x/1#image', '']) expect(isVideoUrl(url), url).toBe(false);
    expect(isVideoUrl(undefined)).toBe(false);
    expect(isVideoUrl(null)).toBe(false);
  });
});

describe('getEditability', () => {
  const editable = (jobs: PlatformJob[], isViewer = false) => getEditability({ publish_jobs: jobs }, { isViewer });

  it.each([
    ['a draft (no jobs)', []],
    ['all scheduled', [job('facebook', 'scheduled'), job('instagram', 'scheduled')]],
    ['failed', [job('facebook', 'failed')]],
    ['a scheduled / failed mix (nothing published)', [job('facebook', 'scheduled'), job('instagram', 'failed')]],
    ['failed first, then retried and scheduled again', [job('facebook', 'failed', 1), job('facebook', 'scheduled', 2)]],
    ['completed first, then a later failed job (latest failed)', [job('facebook', 'completed', 1), job('facebook', 'failed', 2)]],
  ])('is editable for %s', (_name, jobs) => {
    expect(editable(jobs)).toEqual({ editable: true });
  });

  it.each([
    ['everything published', [job('facebook', 'completed'), job('instagram', 'completed')], 'published'],
    ['a single published platform', [job('facebook', 'completed')], 'published'],
    ['published on some platforms only', [job('facebook', 'completed'), job('instagram', 'scheduled')], 'partial'],
    ['published on one, failed on the other', [job('facebook', 'completed'), job('instagram', 'failed')], 'partial'],
    ['publishing right now', [job('facebook', 'processing')], 'publishing'],
    ['processing beats completed', [job('facebook', 'processing'), job('instagram', 'completed')], 'publishing'],
    ['failed first, then retried and published', [job('facebook', 'failed', 1), job('facebook', 'completed', 2)], 'published'],
  ])('is read-only for %s (%s)', (_name, jobs, code) => {
    const result = editable(jobs as PlatformJob[]);
    expect(result).toMatchObject({ editable: false, code });
    if (!result.editable) expect(result.reason.length).toBeGreaterThan(10);
  });

  it('blocks viewers on an otherwise editable post', () => {
    expect(editable([job('facebook', 'scheduled')], true)).toMatchObject({ editable: false, code: 'viewer' });
    expect(editable([], true)).toMatchObject({ editable: false, code: 'viewer' });
  });

  it("reports the post's own state before the viewer role", () => {
    expect(editable([job('facebook', 'completed')], true)).toMatchObject({ editable: false, code: 'published' });
  });

  it('handles a post without publish_jobs', () => {
    expect(getEditability({})).toEqual({ editable: true });
  });
});

describe('getCaptionProblem / canSaveCaption', () => {
  it('rejects empty and whitespace-only captions', () => {
    expect(getCaptionProblem('', ['facebook'])).toMatch(/empty/i);
    expect(getCaptionProblem('  \n\t ', ['facebook'])).toMatch(/empty/i);
  });

  it('enforces the maximum length', () => {
    expect(getCaptionProblem('a'.repeat(MAX_CONTENT_LENGTH), ['facebook'])).toBeNull();
    expect(getCaptionProblem('a'.repeat(MAX_CONTENT_LENGTH + 1), ['facebook'])).toMatch(/longer than/);
  });

  it('applies the Threads 500-byte limit only when Threads is a target', () => {
    expect(getCaptionProblem('a'.repeat(THREADS_MAX_BYTES), ['threads'])).toBeNull();
    expect(getCaptionProblem('a'.repeat(THREADS_MAX_BYTES + 1), ['threads'])).toMatch(/Threads/);
    expect(getCaptionProblem('a'.repeat(600), ['facebook', 'instagram'])).toBeNull();
    expect(getCaptionProblem('a'.repeat(600), [])).toBeNull();
  });

  it('counts UTF-8 bytes, not characters (same rule as the Threads adapter)', () => {
    const hindi170 = 'न'.repeat(170); // 170 characters, 510 bytes
    expect(getCaptionProblem(hindi170, ['threads'])).toMatch(/Threads/);
    expect(getCaptionProblem(hindi170, ['facebook'])).toBeNull();
    expect(getCaptionProblem('🚀'.repeat(125), ['threads'])).toBeNull(); // 4 bytes each = 500
    expect(getCaptionProblem('🚀'.repeat(126), ['threads'])).toMatch(/Threads/);
  });

  it('enables Save only for a real, valid change', () => {
    expect(canSaveCaption('hello', 'hello', ['facebook'])).toBe(false); // unchanged
    expect(canSaveCaption('hello', 'hello world', ['facebook'])).toBe(true);
    expect(canSaveCaption('hello', '   ', ['facebook'])).toBe(false); // blank
    expect(canSaveCaption('hello', '', ['facebook'])).toBe(false);
    expect(canSaveCaption('hello', 'a'.repeat(501), ['threads'])).toBe(false); // too long for Threads
    expect(canSaveCaption('hello', 'hello ', ['facebook'])).toBe(true); // trailing space is a change
  });
});

describe('parity with the server rules (services/post-service/src/editability.ts)', () => {
  it('uses the same limits', () => {
    expect(MAX_CONTENT_LENGTH).toBe(SERVER_MAX);
    expect(THREADS_MAX_BYTES).toBe(SERVER_THREADS_MAX);
  });

  const statuses = ['scheduled', 'processing', 'completed', 'failed'];

  // Every combination of two platforms, and of a platform that was retried (old job then new job)
  const jobSets: PlatformJob[][] = [[]];
  for (const a of statuses) {
    jobSets.push([job('facebook', a)]);
    for (const b of statuses) {
      jobSets.push([job('facebook', a), job('instagram', b)]);
      jobSets.push([job('facebook', a, 1), job('facebook', b, 2)]);
      for (const c of statuses) jobSets.push([job('facebook', a, 1), job('facebook', b, 2), job('instagram', c, 1)]);
    }
  }

  it(`agrees on editable / not editable and on the reason for all ${jobSets.length} job combinations`, () => {
    for (const jobs of jobSets) {
      const web = getEditability({ publish_jobs: jobs });
      const server = getEditBlockReason(jobs);
      expect(web.editable, JSON.stringify(jobs)).toBe(server === null);
      if (!web.editable) expect(web.reason, JSON.stringify(jobs)).toBe(server);
    }
  });

  it('agrees on which captions are acceptable', () => {
    const captions = ['', ' ', 'hi', 'a'.repeat(499), 'a'.repeat(500), 'a'.repeat(501), 'न'.repeat(166), 'न'.repeat(167), 'न'.repeat(170), '🚀'.repeat(125), '🚀'.repeat(126), 'a'.repeat(10000), 'a'.repeat(10001)];
    const targets: string[][] = [[], ['facebook'], ['threads'], ['facebook', 'threads']];
    for (const caption of captions) {
      for (const platforms of targets) {
        const web = getCaptionProblem(caption, platforms);
        const server = getContentProblem(caption, platforms.map((p) => job(p, 'scheduled')));
        expect(web === null, `${caption.length} chars on [${platforms}]`).toBe(server === null);
      }
    }
  });
});
