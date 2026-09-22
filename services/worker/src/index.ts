import dotenv from 'dotenv';
import path from 'path';
import { Worker, Job, DelayedError, UnrecoverableError } from 'bullmq';
import { getRedisConnection, PUBLISH_QUEUE_NAME, getNotificationsQueue } from '@socialpush/shared';
import { createClient } from '@supabase/supabase-js';
import {
  decideFailureAction,
  derivePostStatus,
  failureMessage,
  formatDelay,
  MAX_ATTEMPTS,
  RATE_LIMIT_DELAY_MS,
  RETRY_BASE_DELAY_MS,
  retryDelayMs,
} from './failureRules';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

process.on('uncaughtException', (err: any) => {
  if (err.code === 'ECONNRESET') return;
  console.error('[Worker] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err: any) => {
  if (err.code === 'ECONNRESET' || err.cause?.code === 'ECONNRESET') return;
  console.error('[Worker] Unhandled Rejection:', err.message || err);
});
const redisConnection = getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');
const notificationsQueue = getNotificationsQueue(redisConnection);
// Server-to-server call, not exposed to the browser - a plain env var (not NEXT_PUBLIC_*) is enough.
const PUBLISHING_SERVICE_URL = process.env.PUBLISHING_SERVICE_URL || 'http://localhost:3003';

// Same pruning approach as PUBLISH_JOB_OPTIONS in scheduling-service: BullMQ removes a job from
// Redis once it's this old OR the queue has this many finished jobs, whichever comes first. The
// notification itself lives on in the `notifications` table - this only stops the queue entry
// (already-processed bookkeeping) from sitting in Redis forever.
const NOTIFICATION_JOB_OPTIONS = {
  removeOnComplete: { age: 1 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 500 },
};

// Overridable so the retry flow can be exercised quickly without waiting minutes.
const intEnv = (name: string, fallback: number) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const MAX = intEnv('PUBLISH_MAX_ATTEMPTS', MAX_ATTEMPTS);
const BASE_DELAY = intEnv('PUBLISH_RETRY_BASE_MS', RETRY_BASE_DELAY_MS);

console.log('Worker started. Listening to queue:', PUBLISH_QUEUE_NAME, `(max ${MAX} attempts, retry backoff from ${formatDelay(BASE_DELAY)})`);

// Bookkeeping must never turn a finished publish into a failure (that would retry it and post twice),
// so every step after the publish call goes through this: errors are logged, not thrown.
async function bestEffort(label: string, fn: () => PromiseLike<unknown>) {
  try {
    await fn();
  } catch (err: any) {
    console.error(`[Worker] ${label} failed:`, err?.message || err);
  }
}

// After a job finished, recompute the post's status from its jobs (latest job per platform):
// all completed -> published; everything finished with a failure -> failed; still waiting -> leave it.
async function syncPostStatus(postId: string) {
  const { data: jobs } = await supabase.from('publish_jobs').select('platform, status, created_at').eq('post_id', postId);
  const status = derivePostStatus(jobs ?? []);
  if (!status) return;
  await supabase.from('posts').update({ status, updated_at: new Date().toISOString() }).eq('id', postId);
  console.log(`[Worker] Post ${postId} is now ${status}`);
}

const worker = new Worker(PUBLISH_QUEUE_NAME, async (job: Job, token?: string) => {
  const { jobId, postId, userId, platform } = job.data;
  // Retries are managed here, not by BullMQ's `attempts` (see failureRules.ts): `failures` in the job data counts the
  // attempts that already failed. Jobs queued before this existed have no counter and start at 0.
  const attempt = ((job.data.failures as number | undefined) ?? 0) + 1;
  const maxAttempts = MAX;
  console.log(`[Worker] Processing job ${jobId} for platform ${platform} (attempt ${attempt}/${maxAttempts})`);

  let contentExcerpt = 'Your post';
  let httpStatus: number | null = null;

  try {
    await supabase.from('publish_jobs').update({ status: 'processing' }).eq('id', jobId);

    const { data: post } = await supabase.from('posts').select('content').eq('id', postId).single();
    contentExcerpt = post?.content ? `"${post.content.substring(0, 30)}${post.content.length > 30 ? '...' : ''}"` : 'Your post';

    const res = await fetch(`${PUBLISHING_SERVICE_URL}/api/v1/publish/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    httpStatus = res.status;
    const result = await res.json().catch(() => ({} as any));

    if (res.status === 429) {
      // Rate limited (per-user limiter or the platform's own quota): try again in an hour, not an attempt used up.
      console.log(`[Worker] Job ${jobId} rate limited. Delaying for 1 hour.`);
      await supabase.from('publish_jobs').update({ status: 'scheduled', error_message: `Rate limited: ${result.error || 'too many requests'}. Trying again in 1 hour.` }).eq('id', jobId);
      await job.moveToDelayed(Date.now() + RATE_LIMIT_DELAY_MS, token);
      throw new DelayedError();
    }

    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Publishing failed');
    }
  } catch (error: any) {
    if (error instanceof DelayedError) throw error; // the job was moved to "delayed" on purpose

    const message: string = error?.message || 'Publishing failed';
    console.error(`[Worker] Job ${jobId} attempt ${attempt}/${maxAttempts} failed:`, message);
    const decision = decideFailureAction({ httpStatus, message, attempt, maxAttempts });

    let finalMessage = message;
    if (decision.action === 'retry') {
      // Transient failure with attempts left: keep the job "scheduled", remember the failure, and run it again after
      // the backoff (1 min, 2 min, ...). The note tells the user what happened and when it is tried again.
      const delayMs = retryDelayMs(attempt, BASE_DELAY);
      try {
        await job.updateData({ ...job.data, failures: attempt });
        await supabase.from('publish_jobs').update({
          status: 'scheduled',
          retry_count: attempt,
          error_message: `Attempt ${attempt}/${maxAttempts} failed: ${message}. Retrying automatically in ${formatDelay(delayMs)}.`
        }).eq('id', jobId);
        await job.moveToDelayed(Date.now() + delayMs, token);
        throw new DelayedError();
      } catch (retryError: any) {
        if (retryError instanceof DelayedError) throw retryError;
        // The retry could not be scheduled (e.g. Redis hiccup): do not leave the job "retrying" forever, fail it now.
        console.error(`[Worker] Could not schedule the retry of job ${jobId}:`, retryError?.message || retryError);
        finalMessage = `${message} (the automatic retry could not be scheduled)`;
      }
    }

    // Final failure (permanent error, or no attempts left): record it, update the post, tell the user.
    await bestEffort('mark job failed', () => supabase.from('publish_jobs').update({
      status: 'failed',
      retry_count: attempt,
      error_message: finalMessage
    }).eq('id', jobId));
    await bestEffort('sync post status', () => syncPostStatus(postId));
    await bestEffort('failure notification', () => notificationsQueue.add('notify', {
      userId,
      type: 'failure',
      message: failureMessage(contentExcerpt, platform, finalMessage, attempt)
    }, NOTIFICATION_JOB_OPTIONS));
    // UnrecoverableError: BullMQ must not retry this job any more
    throw new UnrecoverableError(finalMessage);
  }

  // Published. Everything below is bookkeeping and must not fail the job.
  console.log(`[Worker] Job ${jobId} completed successfully on ${platform}`);
  await bestEffort('mark job completed', () => supabase.from('publish_jobs').update({ status: 'completed', error_message: null }).eq('id', jobId));
  await bestEffort('sync post status', () => syncPostStatus(postId));
  await bestEffort('success notification', () => notificationsQueue.add('notify', {
    userId,
    type: 'success',
    message: `${contentExcerpt} to ${platform} has been successfully published.`
  }, NOTIFICATION_JOB_OPTIONS));
}, { connection: redisConnection });

worker.on('failed', (job, err) => {
  console.log(`[Worker] ${job?.id} has failed with ${err.message}`);
});

worker.on('error', (err) => {
  if ((err as any).code === 'ECONNRESET') return;
  console.error(`[Worker] Internal error:`, err.message);
});
