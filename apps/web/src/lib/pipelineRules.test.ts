import { describe, it, expect } from 'vitest';
// The publish worker's pure rules live with the worker; they are tested here because apps/web owns the test runner.
import {
  classifyFailure,
  decideFailureAction,
  derivePostStatus,
  failureMessage,
  formatDelay,
  latestJobsPerPlatform as workerLatest,
  MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  retryDelayMs,
} from '../../../../services/worker/src/failureRules';
import { latestJobsPerPlatform as postServiceLatest } from '../../../../services/post-service/src/editability';
import { getLatestJobs as webLatest } from './calendarStatus';

const job = (platform: string, status: string, minute = 1) => ({ platform, status, created_at: `2026-09-22T10:${String(minute).padStart(2, '0')}:00Z` });

describe('classifyFailure — permanent (retrying cannot help)', () => {
  it.each([404, 400, 401, 403, 422])('HTTP %d from publishing-service is permanent', (status) => {
    expect(classifyFailure(status, 'anything at all')).toBe('permanent');
  });

  // real messages thrown by the adapters, media-service and the platform APIs
  it.each([
    'linkedin account not connected',
    'No Facebook pages found for this user.',
    'No Facebook pages found.',
    'No Instagram Business account linked to any of your Facebook pages.',
    'Instagram requires an image or video to publish.',
    'Facebook Reels requires a video to publish.',
    'YouTube requires a video to publish.',
    'YouTube only accepts video files. You provided an image.',
    'Threads text exceeds 500 UTF-8 bytes limit.',
    'Video is too long for YouTube Shorts. Maximum allowed duration is 180 seconds.',
    'Video duration must be between 3 and 90 seconds for Facebook Reels.',
    'Instagram media container processing failed.',
    'YouTube processing failed: rejected',
    'Pinterest Publish Error: No board ID specified and no default board found.',
    'No image URL provided for Pinterest Pin',
    'TikTok publishing is not implemented yet.',
    'Invalid OAuth access token - Cannot parse access token',
    'Error validating access token: Session has expired on Tuesday, 15-Sep-26 10:00:00 PDT.',
    '(#200) Requires pages_manage_posts permission to manage the object',
    'Request failed with code 403: Forbidden',
  ])('"%s"', (message) => {
    expect(classifyFailure(500, message)).toBe('permanent');
  });
});

describe('classifyFailure — retryable (looks transient)', () => {
  it.each([
    'fetch failed',
    'read ECONNRESET',
    'connect ETIMEDOUT 157.240.1.35:443',
    'Media ID is not available (timed out waiting for video processing)',
    'Threads media container timed out waiting for processing.',
    'Failed to upload to YouTube: Service Unavailable',
    'Invalid initialization vector',
    'Publishing failed',
    '',
  ])('"%s"', (message) => {
    expect(classifyFailure(500, message)).toBe('retryable');
  });

  it('treats a missing HTTP status (publishing-service unreachable) as retryable', () => {
    expect(classifyFailure(null, 'fetch failed')).toBe('retryable');
    expect(classifyFailure(undefined, 'ECONNREFUSED 127.0.0.1:3003')).toBe('retryable');
  });

  it('502 / 503 / 500 by status alone are retryable', () => {
    for (const status of [500, 502, 503, 504]) expect(classifyFailure(status, 'Bad gateway')).toBe('retryable');
  });
});

describe('decideFailureAction', () => {
  it('retries a transient failure while attempts are left', () => {
    expect(decideFailureAction({ httpStatus: 500, message: 'fetch failed', attempt: 1, maxAttempts: 3 })).toEqual({ action: 'retry', kind: 'retryable' });
    expect(decideFailureAction({ httpStatus: 500, message: 'fetch failed', attempt: 2, maxAttempts: 3 })).toEqual({ action: 'retry', kind: 'retryable' });
  });

  it('fails for good when the last attempt is used up', () => {
    expect(decideFailureAction({ httpStatus: 500, message: 'fetch failed', attempt: 3, maxAttempts: 3 })).toEqual({ action: 'fail', kind: 'retryable' });
  });

  it('never retries a permanent failure, even on the first attempt', () => {
    expect(decideFailureAction({ httpStatus: 404, message: 'x account not connected', attempt: 1, maxAttempts: 3 })).toEqual({ action: 'fail', kind: 'permanent' });
    expect(decideFailureAction({ httpStatus: 500, message: 'Threads text exceeds 500 bytes', attempt: 1, maxAttempts: 3 })).toEqual({ action: 'fail', kind: 'permanent' });
  });

  it('a job queued without the attempts option (single attempt) fails on its first error', () => {
    expect(decideFailureAction({ httpStatus: 500, message: 'fetch failed', attempt: 1, maxAttempts: 1 })).toEqual({ action: 'fail', kind: 'retryable' });
  });
});

describe('derivePostStatus', () => {
  it('is published when every platform completed', () => {
    expect(derivePostStatus([job('facebook', 'completed'), job('threads', 'completed')])).toBe('published');
  });

  it('is failed when everything finished and at least one platform failed (also mixed with completed)', () => {
    expect(derivePostStatus([job('facebook', 'failed')])).toBe('failed');
    expect(derivePostStatus([job('facebook', 'completed'), job('threads', 'failed')])).toBe('failed');
  });

  it('leaves the post alone while any platform is still waiting or publishing', () => {
    expect(derivePostStatus([job('facebook', 'failed'), job('threads', 'scheduled')])).toBeNull();
    expect(derivePostStatus([job('facebook', 'completed'), job('threads', 'processing')])).toBeNull();
  });

  it('uses the latest job per platform after a retry', () => {
    expect(derivePostStatus([job('facebook', 'failed', 1), job('facebook', 'scheduled', 2)])).toBeNull(); // retry in flight
    expect(derivePostStatus([job('facebook', 'failed', 1), job('facebook', 'completed', 2)])).toBe('published'); // retry worked
    expect(derivePostStatus([job('facebook', 'failed', 1), job('facebook', 'failed', 2)])).toBe('failed'); // retry failed again
  });

  it('does nothing for a post without jobs', () => {
    expect(derivePostStatus([])).toBeNull();
  });
});

describe('retry backoff', () => {
  it('defaults to 3 attempts, first retry after 1 minute', () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(RETRY_BASE_DELAY_MS).toBe(60_000);
  });

  it('doubles the delay with every failure (1 min, 2 min, 4 min)', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(1, 5_000)).toBe(5_000);
    expect(retryDelayMs(0)).toBe(60_000);
  });

  it('formats delays for the user note', () => {
    expect(formatDelay(500)).toBe('1 s');
    expect(formatDelay(45_000)).toBe('45 s');
    expect(formatDelay(60_000)).toBe('1 min');
    expect(formatDelay(120_000)).toBe('2 min');
    expect(formatDelay(3_600_000)).toBe('1 h');
  });
});

describe('failureMessage', () => {
  it('names the platform and the reason; mentions attempts only when there were several', () => {
    expect(failureMessage('"Hello…"', 'facebook', 'account not connected', 1)).toBe('Failed to publish "Hello…" to facebook: account not connected');
    expect(failureMessage('"Hello…"', 'threads', 'fetch failed', 3)).toBe('Failed to publish "Hello…" to threads after 3 attempts: fetch failed');
  });
});

describe('the three copies of "latest job per platform" agree (worker / post-service / web)', () => {
  const statuses = ['scheduled', 'processing', 'completed', 'failed'];
  const sets: Array<ReturnType<typeof job>[]> = [[]];
  for (const a of statuses) for (const b of statuses) {
    sets.push([job('facebook', a, 1), job('facebook', b, 2)]);
    for (const c of statuses) sets.push([job('facebook', a, 3), job('instagram', b, 1), job('facebook', c, 1)]);
  }

  it(`return the same job per platform for all ${sets.length} combinations`, () => {
    const ids = (list: Array<{ platform?: string | null; status: string }>) => list.map((j) => `${j.platform}:${j.status}`).sort();
    for (const jobs of sets) {
      const w = ids(workerLatest(jobs));
      expect(ids(postServiceLatest(jobs)), JSON.stringify(jobs)).toEqual(w);
      expect(ids(webLatest(jobs)), JSON.stringify(jobs)).toEqual(w);
    }
  });
});
