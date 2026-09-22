import { describe, it, expect } from 'vitest';
import {
  deriveCalendarStatus,
  getLatestJobs,
  getPostPlatforms,
  getPostStart,
  type CalendarPost,
} from './calendarStatus';

const job = (platform: string, status: string, created_at = '2026-09-19T10:00:00Z') => ({ platform, status, created_at });

describe('deriveCalendarStatus', () => {
  it('is scheduled when every job is still scheduled', () => {
    expect(deriveCalendarStatus({ status: 'scheduled', publish_jobs: [job('threads', 'scheduled'), job('facebook', 'scheduled')] })).toBe('scheduled');
  });

  it('is published when every job completed', () => {
    expect(deriveCalendarStatus({ status: 'published', publish_jobs: [job('threads', 'completed'), job('facebook', 'completed')] })).toBe('published');
  });

  it('is partial when some jobs completed and some failed', () => {
    expect(deriveCalendarStatus({ status: 'scheduled', publish_jobs: [job('threads', 'completed'), job('facebook', 'failed')] })).toBe('partial');
  });

  it('is failed when every job failed', () => {
    expect(deriveCalendarStatus({ status: 'scheduled', publish_jobs: [job('threads', 'failed'), job('facebook', 'failed')] })).toBe('failed');
  });

  it('is failed when one job failed and the rest are still waiting', () => {
    expect(deriveCalendarStatus({ publish_jobs: [job('threads', 'failed'), job('facebook', 'scheduled')] })).toBe('failed');
  });

  it('is processing when any job is processing, even if others failed or completed', () => {
    expect(deriveCalendarStatus({ publish_jobs: [job('threads', 'processing'), job('facebook', 'failed')] })).toBe('processing');
    expect(deriveCalendarStatus({ publish_jobs: [job('threads', 'processing'), job('facebook', 'completed')] })).toBe('processing');
  });

  it('is processing when some completed and the rest are still waiting', () => {
    expect(deriveCalendarStatus({ publish_jobs: [job('threads', 'completed'), job('facebook', 'scheduled')] })).toBe('processing');
  });

  it('ignores an old failed job once the platform was retried and completed', () => {
    const post: CalendarPost = {
      publish_jobs: [
        job('threads', 'failed', '2026-09-19T10:00:00Z'),
        job('threads', 'completed', '2026-09-19T11:00:00Z'),
      ],
    };
    expect(deriveCalendarStatus(post)).toBe('published');
  });

  it('treats a retried platform that is scheduled again as scheduled, not failed', () => {
    const post: CalendarPost = {
      publish_jobs: [
        job('threads', 'failed', '2026-09-19T10:00:00Z'),
        job('threads', 'scheduled', '2026-09-19T11:00:00Z'),
      ],
    };
    expect(deriveCalendarStatus(post)).toBe('scheduled');
  });

  describe('without any publish_jobs', () => {
    it('falls back to the post status', () => {
      expect(deriveCalendarStatus({ status: 'published' })).toBe('published');
      expect(deriveCalendarStatus({ status: 'failed' })).toBe('failed');
      expect(deriveCalendarStatus({ status: 'processing' })).toBe('processing');
    });

    it('defaults to scheduled for anything else', () => {
      expect(deriveCalendarStatus({ status: 'scheduled' })).toBe('scheduled');
      expect(deriveCalendarStatus({})).toBe('scheduled');
    });
  });
});

describe('getLatestJobs', () => {
  it('keeps one job per platform, the newest', () => {
    const latest = getLatestJobs([
      job('threads', 'failed', '2026-09-19T10:00:00Z'),
      job('threads', 'completed', '2026-09-19T12:00:00Z'),
      job('facebook', 'scheduled', '2026-09-19T09:00:00Z'),
    ]);
    expect(latest).toHaveLength(2);
    expect(latest.find((j) => j.platform === 'threads')?.status).toBe('completed');
  });

  it('handles undefined and empty input', () => {
    expect(getLatestJobs(undefined)).toEqual([]);
    expect(getLatestJobs([])).toEqual([]);
  });
});

describe('getPostStart', () => {
  it('uses the newest schedule row', () => {
    const post: CalendarPost = {
      schedules: [
        { scheduled_at: '2026-09-20T10:00:00Z', created_at: '2026-09-19T10:00:00Z' },
        { scheduled_at: '2026-09-21T10:00:00Z', created_at: '2026-09-19T12:00:00Z' },
      ],
    };
    expect(getPostStart(post)).toBe('2026-09-21T10:00:00Z');
  });

  it('falls back to created_at when there are no schedules', () => {
    expect(getPostStart({ created_at: '2026-09-18T08:00:00Z', schedules: [] })).toBe('2026-09-18T08:00:00Z');
    expect(getPostStart({ created_at: '2026-09-18T08:00:00Z' })).toBe('2026-09-18T08:00:00Z');
  });
});

describe('getPostPlatforms', () => {
  it('lists unique platforms from jobs in order of appearance', () => {
    expect(getPostPlatforms({ publish_jobs: [job('threads', 'completed'), job('facebook', 'failed'), job('threads', 'failed')] })).toEqual(['threads', 'facebook']);
  });

  it('falls back to schedules when there are no jobs', () => {
    expect(getPostPlatforms({ schedules: [{ scheduled_at: '2026-09-20T10:00:00Z', platform: 'youtube' }] })).toEqual(['youtube']);
  });

  it('returns an empty list when nothing is known', () => {
    expect(getPostPlatforms({})).toEqual([]);
  });
});
