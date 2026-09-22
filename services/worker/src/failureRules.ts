// Pure rules the publish worker uses when a job fails. No I/O, so they are unit tested (see
// apps/web/src/lib/pipelineRules.test.ts, which imports this file).
//
// A failed publish is either
//  - permanent: retrying cannot help (account not connected, invalid / expired token, media or text the platform
//    will never accept, a platform that is not implemented) -> fail at once and tell the user;
//  - retryable: everything else that looks transient (network errors, 5xx from a platform, processing timeouts)
//    -> BullMQ retries it with exponential backoff until the attempts are used up, then it fails for good.

export type FailureKind = 'permanent' | 'retryable';
export type FailureAction = { action: 'retry' | 'fail'; kind: FailureKind };

/** HTTP statuses from publishing-service that a retry can never fix (job / post / account missing, no adapter). */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 422]);

/** Error texts (from the adapters and the platform APIs) that a retry cannot fix. */
const PERMANENT_MESSAGE =
  /not connected|not implemented|requires an? (image|video)|only accepts|exceeds|too long|too large|unsupported|duration must|maximum allowed duration|no (facebook pages|instagram business|default board|adapter|video url|image url)|invalid (oauth|access token|token|parameter)|access token|token (has )?expired|session (has )?expired|unauthori[sz]ed|not authori[sz]ed|forbidden|permission|processing failed/i;

export function classifyFailure(httpStatus: number | null | undefined, message: string): FailureKind {
  if (httpStatus != null && PERMANENT_STATUSES.has(httpStatus)) return 'permanent';
  return PERMANENT_MESSAGE.test(message || '') ? 'permanent' : 'retryable';
}

/**
 * What to do after attempt number `attempt` (1-based) of at most `maxAttempts` failed.
 * A job queued without an `attempts` option has maxAttempts 1: its first failure is final.
 */
export function decideFailureAction(input: { httpStatus?: number | null; message: string; attempt: number; maxAttempts: number }): FailureAction {
  const kind = classifyFailure(input.httpStatus, input.message);
  if (kind === 'retryable' && input.attempt < input.maxAttempts) return { action: 'retry', kind };
  return { action: 'fail', kind };
}

export type JobLike = { platform?: string | null; status: string; created_at?: string | null };

const timeOf = (iso?: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Retries add new publish_jobs rows and leave the old ones behind: only the newest job per platform counts. */
export function latestJobsPerPlatform<T extends JobLike>(jobs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const job of jobs) {
    const key = job.platform ?? '__unknown__';
    const current = latest.get(key);
    if (!current || timeOf(job.created_at) >= timeOf(current.created_at)) latest.set(key, job);
  }
  return [...latest.values()];
}

/**
 * The posts.status a post should have once a job finished, or null to leave it alone:
 *  - a platform is still waiting / publishing -> null (not finished yet);
 *  - every platform completed -> 'published';
 *  - everything finished and at least one platform failed -> 'failed'.
 */
export function derivePostStatus(jobs: JobLike[]): 'published' | 'failed' | null {
  const latest = latestJobsPerPlatform(jobs);
  if (latest.length === 0) return null;
  if (latest.some((j) => j.status === 'scheduled' || j.status === 'processing')) return null;
  if (latest.every((j) => j.status === 'completed')) return 'published';
  if (latest.some((j) => j.status === 'failed')) return 'failed';
  return null;
}

export const RATE_LIMIT_DELAY_MS = 60 * 60 * 1000;

// Retries are managed by the worker itself (a `failures` counter in the BullMQ job data + moveToDelayed), not by
// BullMQ's `attempts`: in BullMQ 4.x `attemptsMade` grows on EVERY run, also after a rate-limit delay, so rate
// limits would eat the attempts, and a job BullMQ refuses to retry could be left "retrying" in the database.
/** Total attempts per platform before a transient failure becomes final (1 first try + 2 retries). */
export const MAX_ATTEMPTS = 3;
/** Wait before the first retry; doubles every time (1 min, 2 min, ...). */
export const RETRY_BASE_DELAY_MS = 60_000;

/** Delay before the retry that follows the `failures`-th failed attempt (1-based). */
export function retryDelayMs(failures: number, baseMs: number = RETRY_BASE_DELAY_MS): number {
  return baseMs * 2 ** Math.max(0, failures - 1);
}

/** "45 s", "1 min", "2 min", "1 h" - for the note shown to the user. */
export function formatDelay(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 3_600_000)} h`;
}

/** The notification text for a job that failed for good. */
export function failureMessage(excerpt: string, platform: string, message: string, attempts: number): string {
  const after = attempts > 1 ? ` after ${attempts} attempts` : '';
  return `Failed to publish ${excerpt} to ${platform}${after}: ${message}`;
}
