// Pure helpers for the calendar's click-to-edit modal (Step 3): what to show per platform, whether the
// caption may be edited, and whether a draft caption is acceptable. No React, no network.
//
// The edit rules MUST stay in step with the server, which is the real gate:
// services/post-service/src/editability.ts (PATCH /api/v1/posts/:id). A parity test compares the two.

import {
  getLatestJobs,
  getPostStart,
  STATUS_META,
  type CalendarJob,
  type CalendarPost,
  type CalendarStatusKey,
} from './calendarStatus';

export type PlatformJob = CalendarJob & { error_message?: string | null; retry_count?: number | null };
export type EditablePost = Omit<CalendarPost, 'publish_jobs'> & { publish_jobs?: PlatformJob[] };
/** A post as returned by GET /api/v1/posts (range query): the row plus its publish_jobs and schedules. */
export type EditablePostRecord = EditablePost & { id: string; content?: string | null; media_url?: string | null };

// Keep in sync with services/post-service/src/editability.ts
export const MAX_CONTENT_LENGTH = 10_000;
export const THREADS_MAX_BYTES = 500;

// ---------------------------------------------------------------------------------------------
// Per-platform status list
// ---------------------------------------------------------------------------------------------

export type PlatformStatus = {
  platform: string;
  /** Same five-colour vocabulary as the calendar (a job is never "partial", that is post-level). */
  statusKey: CalendarStatusKey;
  label: string;
  color: string;
  /** The job's error message when it failed, otherwise null. */
  error: string | null;
  /** "Attempt 1/3 failed … Retrying automatically in 1 min." while the worker is retrying this platform, otherwise null. */
  note: string | null;
  /** When this platform is scheduled to publish (ISO), if known. */
  scheduledAt: string | null;
};

const JOB_STATUS_TO_KEY: Record<string, CalendarStatusKey> = {
  scheduled: 'scheduled',
  processing: 'processing',
  completed: 'published',
  failed: 'failed',
};

const timeOf = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * One row per target platform, in the order platforms first appear (jobs, then schedules that have no
 * job yet). The status comes from the platform's latest job, because retries leave older jobs behind.
 */
export function getPlatformStatuses(post: EditablePost): PlatformStatus[] {
  const latestJobs = getLatestJobs(post.publish_jobs ?? []);
  const schedules = post.schedules ?? [];
  const fallbackStart = getPostStart(post) ?? null;

  const scheduledAtFor = (platform: string): string | null => {
    let newest: { scheduled_at: string; created_at?: string } | null = null;
    for (const s of schedules) {
      if (s.platform !== platform) continue;
      if (!newest || timeOf(s.created_at) >= timeOf(newest.created_at)) newest = s;
    }
    return newest?.scheduled_at ?? fallbackStart;
  };

  const platforms: string[] = [];
  for (const job of latestJobs) if (job.platform && !platforms.includes(job.platform)) platforms.push(job.platform);
  for (const s of schedules) if (s.platform && !platforms.includes(s.platform)) platforms.push(s.platform);

  return platforms.map((platform) => {
    const job = latestJobs.find((j) => j.platform === platform);
    const statusKey: CalendarStatusKey = job ? (JOB_STATUS_TO_KEY[job.status] ?? 'scheduled') : 'scheduled';
    return {
      platform,
      statusKey,
      label: STATUS_META[statusKey].label,
      color: STATUS_META[statusKey].color,
      error: job && job.status === 'failed' ? (job.error_message ?? null) : null,
      note: job && job.status === 'scheduled' && (job.retry_count ?? 0) > 0 ? (job.error_message ?? null) : null,
      scheduledAt: scheduledAtFor(platform),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Media (posts.media_url is a JSON string: { "<platform>": "<public url>" })
// ---------------------------------------------------------------------------------------------

/** Parses `posts.media_url`; anything that isn't a JSON object of strings yields `{}`. */
export function parseMediaMap(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const [platform, url] of Object.entries(parsed)) if (typeof url === 'string' && url) map[platform] = url;
    return map;
  } catch {
    return {};
  }
}

/** Same rule the timeline uses: media-service always writes videos as .mp4 and images as .jpg. */
export function isVideoUrl(url: string | null | undefined): boolean {
  return !!url && (/\.(mp4|mov|webm)(\?.*)?$/i.test(url) || url.endsWith('#video'));
}

// ---------------------------------------------------------------------------------------------
// Can the caption be edited?
// ---------------------------------------------------------------------------------------------

export type EditBlockCode = 'publishing' | 'published' | 'partial' | 'viewer';
export type Editability = { editable: true } | { editable: false; code: EditBlockCode; reason: string };

// Same wording as the server's messages.
const REASONS: Record<EditBlockCode, string> = {
  publishing: 'This post is being published right now, so its caption can no longer be edited.',
  published: 'This post is already published, so its caption can no longer be edited.',
  partial: 'This post is already published on some platforms, so its caption can no longer be edited.',
  viewer: "Viewers can't edit posts.",
};

/**
 * Editable unless some platform's latest job is `processing` or `completed`
 * (a draft, all-scheduled, failed, or a scheduled/failed mix are all editable).
 * The post's own state wins over the viewer role when both apply, because it is the more useful fact
 * to show; callers must still hide "Save" for viewers (any `editable: false` does that).
 */
export function getEditability(post: EditablePost, options: { isViewer?: boolean } = {}): Editability {
  const latest = getLatestJobs(post.publish_jobs ?? []);
  const processing = latest.filter((j) => j.status === 'processing').length;
  const completed = latest.filter((j) => j.status === 'completed').length;

  if (processing > 0) return { editable: false, code: 'publishing', reason: REASONS.publishing };
  if (completed > 0 && completed === latest.length) return { editable: false, code: 'published', reason: REASONS.published };
  if (completed > 0) return { editable: false, code: 'partial', reason: REASONS.partial };
  if (options.isViewer) return { editable: false, code: 'viewer', reason: REASONS.viewer };
  return { editable: true };
}

// ---------------------------------------------------------------------------------------------
// Is a caption acceptable?
// ---------------------------------------------------------------------------------------------

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/** null = acceptable for these platforms; otherwise why not (mirrors the server's getContentProblem). */
export function getCaptionProblem(content: string, platforms: string[]): string | null {
  if (content.trim().length === 0) return 'Caption cannot be empty.';
  if (content.length > MAX_CONTENT_LENGTH) return `Caption cannot be longer than ${MAX_CONTENT_LENGTH} characters.`;
  if (platforms.includes('threads') && utf8Bytes(content) > THREADS_MAX_BYTES) {
    return `Threads text exceeds the ${THREADS_MAX_BYTES} UTF-8 bytes limit.`;
  }
  return null;
}

/** Whether "Save changes" should be enabled: the text really changed and passes getCaptionProblem. */
export function canSaveCaption(original: string, draft: string, platforms: string[]): boolean {
  return draft !== original && getCaptionProblem(draft, platforms) === null;
}
