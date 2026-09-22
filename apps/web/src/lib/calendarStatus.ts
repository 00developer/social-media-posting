// Pure helpers that turn a post (with its publish_jobs and schedules) into what the
// calendar shows: one aggregate status, one start time, and the target platforms.
// No React and no network access here so it stays trivially testable.

export type CalendarJob = { platform?: string; status: string; created_at?: string };
export type CalendarSchedule = { scheduled_at: string; platform?: string; created_at?: string };
export type CalendarPost = {
  status?: string;
  created_at?: string;
  publish_jobs?: CalendarJob[];
  schedules?: CalendarSchedule[];
};

export type CalendarStatusKey = 'scheduled' | 'processing' | 'published' | 'partial' | 'failed';

export const STATUS_META: Record<CalendarStatusKey, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: '#3b82f6' },
  processing: { label: 'Processing', color: '#f59e0b' },
  published: { label: 'Published', color: '#22c55e' },
  partial: { label: 'Partially Published', color: '#ca8a04' },
  failed: { label: 'Failed', color: '#ef4444' },
};

export const PLATFORM_SHORT_LABELS: Record<string, string> = {
  twitter: 'X',
  facebook: 'FB',
  instagram: 'IG',
  youtube: 'YT',
  linkedin: 'LI',
  tiktok: 'TT',
  pinterest: 'PN',
  threads: 'TH',
};

const timeOf = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * A retry or re-schedule creates new publish_jobs rows and leaves the old ones behind,
 * so only the newest job per platform describes the current state of that platform.
 */
export function getLatestJobs<T extends CalendarJob>(jobs: T[] = []): T[] {
  const latest = new Map<string, T>();
  for (const job of jobs) {
    const key = job.platform ?? '__unknown__';
    const current = latest.get(key);
    if (!current || timeOf(job.created_at) >= timeOf(current.created_at)) {
      latest.set(key, job);
    }
  }
  return [...latest.values()];
}

export function deriveCalendarStatus(post: CalendarPost): CalendarStatusKey {
  const jobs = getLatestJobs(post.publish_jobs);

  // No jobs yet (or not visible): fall back to the post-level status.
  if (jobs.length === 0) {
    if (post.status === 'published') return 'published';
    if (post.status === 'failed') return 'failed';
    if (post.status === 'processing') return 'processing';
    return 'scheduled';
  }

  const completed = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const processing = jobs.filter((j) => j.status === 'processing').length;

  if (processing > 0) return 'processing';
  if (completed === jobs.length) return 'published';
  if (failed === jobs.length) return 'failed';
  if (completed > 0 && failed > 0) return 'partial';
  if (failed > 0) return 'failed'; // some failed, nothing completed, the rest still waiting
  if (completed > 0) return 'processing'; // some completed, the rest still waiting
  return 'scheduled';
}

/** The newest schedule row wins, because retries add rows rather than updating them. */
export function getPostStart(post: CalendarPost): string | undefined {
  const schedules = post.schedules ?? [];
  if (schedules.length === 0) return post.created_at;
  let newest = schedules[0];
  for (const s of schedules) {
    if (timeOf(s.created_at) >= timeOf(newest.created_at)) newest = s;
  }
  return newest.scheduled_at;
}

/** Unique target platforms in a stable order (first appearance). */
export function getPostPlatforms(post: CalendarPost): string[] {
  const seen: string[] = [];
  const source = (post.publish_jobs && post.publish_jobs.length > 0 ? post.publish_jobs : post.schedules) ?? [];
  for (const item of source) {
    if (item.platform && !seen.includes(item.platform)) seen.push(item.platform);
  }
  return seen;
}
