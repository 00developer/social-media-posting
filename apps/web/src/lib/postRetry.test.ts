import { describe, it, expect, vi, afterEach } from 'vitest';
import { getFailedPlatforms, getFailureLines, getRetryNotes, isPostFailed, retryButtonLabel, retryFailedPost } from './postRetry';

const job = (platform: string, status: string, minute = 1, extra: Record<string, unknown> = {}) => ({ platform, status, created_at: `2026-09-22T10:${String(minute).padStart(2, '0')}:00Z`, ...extra });

describe('getFailedPlatforms — only the LATEST job per platform counts', () => {
  it('lists platforms whose latest job failed', () => {
    expect(getFailedPlatforms({ publish_jobs: [job('facebook', 'failed'), job('threads', 'completed'), job('youtube', 'failed')] }).sort()).toEqual(['facebook', 'youtube']);
  });

  it('ignores an old failure once the platform was retried', () => {
    expect(getFailedPlatforms({ publish_jobs: [job('facebook', 'failed', 1), job('facebook', 'scheduled', 2)] })).toEqual([]); // retry in flight
    expect(getFailedPlatforms({ publish_jobs: [job('facebook', 'failed', 1), job('facebook', 'completed', 2)] })).toEqual([]); // retry worked
    expect(getFailedPlatforms({ publish_jobs: [job('facebook', 'failed', 1), job('facebook', 'failed', 2)] })).toEqual(['facebook']); // failed again
  });

  it('handles missing data', () => {
    expect(getFailedPlatforms({})).toEqual([]);
    expect(getFailedPlatforms({ publish_jobs: [] })).toEqual([]);
    expect(getFailedPlatforms({ publish_jobs: [{ status: 'failed' }] })).toEqual([]); // no platform, nothing to retry
  });
});

describe('getFailureLines', () => {
  it('gives each failed platform its own error, with a fallback text', () => {
    expect(getFailureLines({ publish_jobs: [job('facebook', 'failed', 1, { error_message: 'account not connected' }), job('youtube', 'failed'), job('threads', 'completed')] })).toEqual([
      { platform: 'facebook', error: 'account not connected' },
      { platform: 'youtube', error: 'Publishing failed' },
    ]);
  });

  it('shows the latest failure, not an older one', () => {
    expect(getFailureLines({ publish_jobs: [job('facebook', 'failed', 1, { error_message: 'old' }), job('facebook', 'failed', 2, { error_message: 'new' })] })).toEqual([{ platform: 'facebook', error: 'new' }]);
  });
});

describe('getRetryNotes', () => {
  it('shows the automatic-retry note for a scheduled job that already failed an attempt', () => {
    const note = 'Attempt 1/3 failed: fetch failed. Retrying automatically in 1 min.';
    expect(getRetryNotes({ publish_jobs: [job('twitter', 'scheduled', 1, { retry_count: 1, error_message: note })] })).toEqual([{ platform: 'twitter', note }]);
  });

  it('shows nothing for a job that never failed, or one that is not waiting to be retried', () => {
    expect(getRetryNotes({ publish_jobs: [job('twitter', 'scheduled', 1, { retry_count: 0 })] })).toEqual([]);
    expect(getRetryNotes({ publish_jobs: [job('twitter', 'failed', 1, { retry_count: 3, error_message: 'x' })] })).toEqual([]);
    expect(getRetryNotes({ publish_jobs: [job('twitter', 'scheduled', 1, { retry_count: 1 })] })).toEqual([]); // no message
  });
});

describe('isPostFailed', () => {
  it('is failed when a platform failed for good, or the post status says failed', () => {
    expect(isPostFailed({ status: 'scheduled', publish_jobs: [job('facebook', 'failed')] })).toBe(true);
    expect(isPostFailed({ status: 'failed', publish_jobs: [] })).toBe(true);
  });

  it('is NOT failed while the failed platform is being retried, or after the retry worked', () => {
    expect(isPostFailed({ status: 'scheduled', publish_jobs: [job('facebook', 'failed', 1), job('facebook', 'scheduled', 2)] })).toBe(false);
    expect(isPostFailed({ status: 'published', publish_jobs: [job('facebook', 'failed', 1), job('facebook', 'completed', 2)] })).toBe(false);
  });
});

describe('retryButtonLabel', () => {
  it('names the count only when several platforms failed, and shows progress while busy', () => {
    expect(retryButtonLabel(1, false)).toBe('Retry failed');
    expect(retryButtonLabel(3, false)).toBe('Retry failed (3)');
    expect(retryButtonLabel(3, true)).toBe('Retrying...');
  });
});

describe('retryFailedPost', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubFetch = (status: number, body: unknown, reject = false) => {
    const fn = vi.fn(async () => {
      if (reject) throw new Error('network down');
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  it('posts to the scheduling-service and returns the retried platforms', async () => {
    const fn = stubFetch(200, { success: true, retried: ['facebook'] });
    expect(await retryFailedPost('u1', 'p1')).toEqual({ ok: true, retried: ['facebook'] });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3004/api/v1/posts/p1/retry');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ userId: 'u1' });
  });

  it('sends a platform filter only when one is given', async () => {
    const fn = stubFetch(200, { success: true, retried: ['youtube'] });
    await retryFailedPost('u1', 'p1', ['youtube']);
    expect(JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ userId: 'u1', platforms: ['youtube'] });
    await retryFailedPost('u1', 'p1', []);
    expect(JSON.parse((fn.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ userId: 'u1' });
  });

  it('turns a server refusal into a readable result, flagging "nothing to retry"', async () => {
    stubFetch(409, { error: 'Nothing to retry: this post has no failed platforms.', code: 'NOTHING_TO_RETRY' });
    expect(await retryFailedPost('u1', 'p1')).toEqual({ ok: false, error: 'Nothing to retry: this post has no failed platforms.', nothingToRetry: true });
    stubFetch(403, { error: 'Unauthorized: Viewers cannot retry posts' });
    expect(await retryFailedPost('u1', 'p1')).toMatchObject({ ok: false, error: 'Unauthorized: Viewers cannot retry posts' });
  });

  it('copes with a non-JSON error and with the service being down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }) as unknown as Response));
    expect(await retryFailedPost('u1', 'p1')).toEqual({ ok: false, error: 'Could not retry (502).', nothingToRetry: false });
    stubFetch(0, null, true);
    expect(await retryFailedPost('u1', 'p1')).toMatchObject({ ok: false, error: expect.stringContaining('scheduling service') });
  });
});
