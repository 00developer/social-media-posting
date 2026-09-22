// Retry of failed platforms: which platforms failed, what to show about failures / automatic retries, and the
// call to the scheduling-service. The pure functions are unit tested.
//
// A retry adds NEW publish_jobs rows and keeps the old failed ones as history, so everything here looks at the
// latest job per platform only: an old failed row must never make a post look failed while its retry is running
// or after it worked.

import { getLatestJobs, type CalendarJob } from './calendarStatus';

type JobRecord = Record<string, unknown>;
export type PostWithJobs = { publish_jobs?: JobRecord[] };

type LatestJob = CalendarJob & { error_message?: string; retry_count?: number };

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function latestJobs(post: PostWithJobs): LatestJob[] {
  const jobs: LatestJob[] = (post.publish_jobs ?? []).map((j) => ({
    platform: str(j.platform),
    status: str(j.status) ?? '',
    created_at: str(j.created_at),
    error_message: str(j.error_message),
    retry_count: typeof j.retry_count === 'number' ? j.retry_count : undefined,
  }));
  return getLatestJobs(jobs);
}

/** Platforms whose latest job failed (these are the ones a retry would re-run). */
export function getFailedPlatforms(post: PostWithJobs): string[] {
  return latestJobs(post).filter((j) => j.status === 'failed' && j.platform).map((j) => j.platform as string);
}

/** One line per platform that failed for good: what to show under the post. */
export function getFailureLines(post: PostWithJobs): Array<{ platform: string; error: string }> {
  return latestJobs(post)
    .filter((j) => j.status === 'failed' && j.platform)
    .map((j) => ({ platform: j.platform as string, error: j.error_message || 'Publishing failed' }));
}

/** Platforms that failed an attempt and are being retried automatically ("Attempt 1/3 failed … Retrying automatically."). */
export function getRetryNotes(post: PostWithJobs): Array<{ platform: string; note: string }> {
  return latestJobs(post)
    .filter((j) => j.status === 'scheduled' && (j.retry_count ?? 0) > 0 && j.error_message && j.platform)
    .map((j) => ({ platform: j.platform as string, note: j.error_message as string }));
}

/** True when the post should look "failed": something failed for good and nothing is still being retried on that platform. */
export function isPostFailed(post: PostWithJobs & { status?: string }): boolean {
  return getFailedPlatforms(post).length > 0 || post.status === 'failed';
}

export function retryButtonLabel(failedCount: number, busy: boolean): string {
  if (busy) return 'Retrying...';
  return failedCount > 1 ? `Retry failed (${failedCount})` : 'Retry failed';
}

export type RetryResult = { ok: true; retried: string[] } | { ok: false; error: string; nothingToRetry?: boolean };

/** Asks the scheduling-service to re-queue the failed platforms of a post (optionally only some of them). */
export async function retryFailedPost(userId: string, postId: string, platforms?: string[]): Promise<RetryResult> {
  try {
    const res = await fetch(`http://localhost:3004/api/v1/posts/${postId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...(platforms && platforms.length > 0 ? { platforms } : {}) }),
    });
    let body: { success?: boolean; error?: string; code?: string; retried?: string[] } | null = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON response: generic message below
    }
    if (res.ok && body?.success) return { ok: true, retried: body.retried ?? [] };
    return { ok: false, error: body?.error || `Could not retry (${res.status}).`, nothingToRetry: body?.code === 'NOTHING_TO_RETRY' };
  } catch {
    return { ok: false, error: 'Could not reach the scheduling service. Check that it is running and try again.' };
  }
}
