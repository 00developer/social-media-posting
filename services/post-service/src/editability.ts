// Pure rules for editing a post's caption. No I/O so they can be exercised on their own.
//
// A caption may change while nothing has been published (or is being published) for the post:
// a draft (no jobs), jobs that are all still `scheduled`, jobs that failed, or a mix of those.
// Once any platform's job is `processing` or `completed`, the caption stored in the database would
// no longer match what a platform got, so the post is read-only.

export type JobLike = { platform?: string | null; status: string; created_at?: string | null };

export const MAX_CONTENT_LENGTH = 10_000;
/** Same limit the Threads adapter enforces at publish time (UTF-8 bytes). */
export const THREADS_MAX_BYTES = 500;

const timeOf = (iso?: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * A retry adds new publish_jobs rows and leaves the old ones behind, so only the newest job
 * per platform describes that platform's current state.
 */
export function latestJobsPerPlatform<T extends JobLike>(jobs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const job of jobs) {
    const key = job.platform ?? '__unknown__';
    const current = latest.get(key);
    if (!current || timeOf(job.created_at) >= timeOf(current.created_at)) latest.set(key, job);
  }
  return [...latest.values()];
}

/** null = the caption can be edited; otherwise the reason it can't. */
export function getEditBlockReason(jobs: JobLike[]): string | null {
  const latest = latestJobsPerPlatform(jobs);
  const processing = latest.filter((j) => j.status === 'processing').length;
  const completed = latest.filter((j) => j.status === 'completed').length;

  if (processing > 0) return 'This post is being published right now, so its caption can no longer be edited.';
  if (completed > 0 && completed === latest.length) return 'This post is already published, so its caption can no longer be edited.';
  if (completed > 0) return 'This post is already published on some platforms, so its caption can no longer be edited.';
  return null;
}

/** null = the caption is acceptable for the platforms the post targets; otherwise the reason it isn't. */
export function getContentProblem(content: unknown, jobs: JobLike[]): string | null {
  if (typeof content !== 'string') return 'content must be a string';
  if (content.trim().length === 0) return 'content cannot be empty';
  if (content.length > MAX_CONTENT_LENGTH) return `content cannot be longer than ${MAX_CONTENT_LENGTH} characters`;

  const targetsThreads = latestJobsPerPlatform(jobs).some((j) => j.platform === 'threads');
  if (targetsThreads && Buffer.byteLength(content, 'utf8') > THREADS_MAX_BYTES) {
    return `Threads text exceeds the ${THREADS_MAX_BYTES} UTF-8 bytes limit.`;
  }
  return null;
}
