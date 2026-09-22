"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const bullmq_1 = require("bullmq");
const shared_1 = require("@socialpush/shared");
const supabase_js_1 = require("@supabase/supabase-js");
const failureRules_1 = require("./failureRules");
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
process.on('uncaughtException', (err) => {
    if (err.code === 'ECONNRESET')
        return;
    console.error('[Worker] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err) => {
    if (err.code === 'ECONNRESET' || err.cause?.code === 'ECONNRESET')
        return;
    console.error('[Worker] Unhandled Rejection:', err.message || err);
});
const redisConnection = (0, shared_1.getRedisConnection)(process.env.REDIS_URL || 'redis://localhost:6379');
const notificationsQueue = (0, shared_1.getNotificationsQueue)(redisConnection);
// Overridable so the retry flow can be exercised quickly without waiting minutes.
const intEnv = (name, fallback) => {
    const n = parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
const MAX = intEnv('PUBLISH_MAX_ATTEMPTS', failureRules_1.MAX_ATTEMPTS);
const BASE_DELAY = intEnv('PUBLISH_RETRY_BASE_MS', failureRules_1.RETRY_BASE_DELAY_MS);
console.log('Worker started. Listening to queue:', shared_1.PUBLISH_QUEUE_NAME, `(max ${MAX} attempts, retry backoff from ${(0, failureRules_1.formatDelay)(BASE_DELAY)})`);
// Bookkeeping must never turn a finished publish into a failure (that would retry it and post twice),
// so every step after the publish call goes through this: errors are logged, not thrown.
async function bestEffort(label, fn) {
    try {
        await fn();
    }
    catch (err) {
        console.error(`[Worker] ${label} failed:`, err?.message || err);
    }
}
// After a job finished, recompute the post's status from its jobs (latest job per platform):
// all completed -> published; everything finished with a failure -> failed; still waiting -> leave it.
async function syncPostStatus(postId) {
    const { data: jobs } = await supabase.from('publish_jobs').select('platform, status, created_at').eq('post_id', postId);
    const status = (0, failureRules_1.derivePostStatus)(jobs ?? []);
    if (!status)
        return;
    await supabase.from('posts').update({ status, updated_at: new Date().toISOString() }).eq('id', postId);
    console.log(`[Worker] Post ${postId} is now ${status}`);
}
const worker = new bullmq_1.Worker(shared_1.PUBLISH_QUEUE_NAME, async (job, token) => {
    const { jobId, postId, userId, platform } = job.data;
    // Retries are managed here, not by BullMQ's `attempts` (see failureRules.ts): `failures` in the job data counts the
    // attempts that already failed. Jobs queued before this existed have no counter and start at 0.
    const attempt = (job.data.failures ?? 0) + 1;
    const maxAttempts = MAX;
    console.log(`[Worker] Processing job ${jobId} for platform ${platform} (attempt ${attempt}/${maxAttempts})`);
    let contentExcerpt = 'Your post';
    let httpStatus = null;
    try {
        await supabase.from('publish_jobs').update({ status: 'processing' }).eq('id', jobId);
        const { data: post } = await supabase.from('posts').select('content').eq('id', postId).single();
        contentExcerpt = post?.content ? `"${post.content.substring(0, 30)}${post.content.length > 30 ? '...' : ''}"` : 'Your post';
        const res = await fetch(`http://localhost:3003/api/v1/publish/${jobId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        httpStatus = res.status;
        const result = await res.json().catch(() => ({}));
        if (res.status === 429) {
            // Rate limited (per-user limiter or the platform's own quota): try again in an hour, not an attempt used up.
            console.log(`[Worker] Job ${jobId} rate limited. Delaying for 1 hour.`);
            await supabase.from('publish_jobs').update({ status: 'scheduled', error_message: `Rate limited: ${result.error || 'too many requests'}. Trying again in 1 hour.` }).eq('id', jobId);
            await job.moveToDelayed(Date.now() + failureRules_1.RATE_LIMIT_DELAY_MS, token);
            throw new bullmq_1.DelayedError();
        }
        if (!res.ok || !result.success) {
            throw new Error(result.error || 'Publishing failed');
        }
    }
    catch (error) {
        if (error instanceof bullmq_1.DelayedError)
            throw error; // the job was moved to "delayed" on purpose
        const message = error?.message || 'Publishing failed';
        console.error(`[Worker] Job ${jobId} attempt ${attempt}/${maxAttempts} failed:`, message);
        const decision = (0, failureRules_1.decideFailureAction)({ httpStatus, message, attempt, maxAttempts });
        let finalMessage = message;
        if (decision.action === 'retry') {
            // Transient failure with attempts left: keep the job "scheduled", remember the failure, and run it again after
            // the backoff (1 min, 2 min, ...). The note tells the user what happened and when it is tried again.
            const delayMs = (0, failureRules_1.retryDelayMs)(attempt, BASE_DELAY);
            try {
                await job.updateData({ ...job.data, failures: attempt });
                await supabase.from('publish_jobs').update({
                    status: 'scheduled',
                    retry_count: attempt,
                    error_message: `Attempt ${attempt}/${maxAttempts} failed: ${message}. Retrying automatically in ${(0, failureRules_1.formatDelay)(delayMs)}.`
                }).eq('id', jobId);
                await job.moveToDelayed(Date.now() + delayMs, token);
                throw new bullmq_1.DelayedError();
            }
            catch (retryError) {
                if (retryError instanceof bullmq_1.DelayedError)
                    throw retryError;
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
            message: (0, failureRules_1.failureMessage)(contentExcerpt, platform, finalMessage, attempt)
        }));
        // UnrecoverableError: BullMQ must not retry this job any more
        throw new bullmq_1.UnrecoverableError(finalMessage);
    }
    // Published. Everything below is bookkeeping and must not fail the job.
    console.log(`[Worker] Job ${jobId} completed successfully on ${platform}`);
    await bestEffort('mark job completed', () => supabase.from('publish_jobs').update({ status: 'completed', error_message: null }).eq('id', jobId));
    await bestEffort('sync post status', () => syncPostStatus(postId));
    await bestEffort('success notification', () => notificationsQueue.add('notify', {
        userId,
        type: 'success',
        message: `${contentExcerpt} to ${platform} has been successfully published.`
    }));
}, { connection: redisConnection });
worker.on('failed', (job, err) => {
    console.log(`[Worker] ${job?.id} has failed with ${err.message}`);
});
worker.on('error', (err) => {
    if (err.code === 'ECONNRESET')
        return;
    console.error(`[Worker] Internal error:`, err.message);
});
