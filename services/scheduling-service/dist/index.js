"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const supabase_js_1 = require("@supabase/supabase-js");
const shared_1 = require("@socialpush/shared");
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const redisConnection = (0, shared_1.getRedisConnection)(process.env.REDIS_URL || 'redis://localhost:6379');
const publishQueue = (0, shared_1.getQueue)(redisConnection);
// Options every publish job is queued with. Retries are NOT BullMQ attempts: the worker retries transient failures itself
// (3 attempts, backoff 1 min then 2 min, see services/worker/src/failureRules.ts) and fails permanent errors at once.
// Finished jobs are pruned so Redis does not fill up - the outcome lives in publish_jobs.
const PUBLISH_JOB_OPTIONS = {
    removeOnComplete: { age: 3 * 24 * 3600, count: 500 },
    removeOnFail: { age: 14 * 24 * 3600, count: 500 },
};
app.post('/api/v1/schedules', async (req, res) => {
    const { userId, postId, platforms, scheduledAt, timezone, contentType } = req.body;
    if (!userId || !postId || !platforms || !platforms.length || !scheduledAt || !timezone) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const { data: post } = await supabase.from('posts').select('team_id').eq('id', postId).single();
    if (!post)
        return res.status(404).json({ error: 'Post not found' });
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', post.team_id).eq('user_id', userId).single();
    if (!member || member.role === 'viewer')
        return res.status(403).json({ error: 'Unauthorized: Viewers cannot schedule posts' });
    const scheduledDate = new Date(scheduledAt);
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
    if (isNaN(scheduledDate.getTime()) || scheduledDate < fiveMinutesAgo) {
        return res.status(400).json({ error: 'Invalid or past date' });
    }
    try {
        for (const platform of platforms) {
            // Insert schedule record
            const { error: scheduleError } = await supabase.from('schedules').insert({
                post_id: postId,
                user_id: userId,
                platform,
                scheduled_at: scheduledDate.toISOString(),
                timezone
            });
            if (scheduleError)
                throw scheduleError;
            // Insert publish job record
            const { data: jobRecord, error: jobError } = await supabase.from('publish_jobs').insert({
                post_id: postId,
                user_id: userId,
                platform,
                status: 'scheduled',
                content_type: contentType || 'post'
            }).select().single();
            if (jobError)
                throw jobError;
            // Add to BullMQ
            const delay = scheduledDate.getTime() - Date.now();
            await publishQueue.add('publish-post', {
                jobId: jobRecord.id,
                postId,
                userId,
                platform
            }, { ...PUBLISH_JOB_OPTIONS, delay, jobId: jobRecord.id });
        }
        // Update post status to scheduled
        await supabase.from('posts').update({ status: 'scheduled' }).eq('id', postId);
        res.json({ success: true, message: `Post scheduled for ${platforms.length} platforms` });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A retry adds new publish_jobs rows and leaves the old ones behind, so only the newest job per platform counts.
function latestJobsPerPlatform(jobs) {
    const time = (iso) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? 0 : t; };
    const latest = new Map();
    for (const job of jobs) {
        const key = job.platform ?? '__unknown__';
        const current = latest.get(key);
        if (!current || time(job.created_at) >= time(current.created_at))
            latest.set(key, job);
    }
    return [...latest.values()];
}
// Retry the platforms of a post whose latest job failed. Only those platforms: platforms that already
// published are never touched (no duplicate posts). Each retry is a NEW publish_jobs row (same content_type)
// queued with a new BullMQ id; the old failed rows stay as history.
app.post('/api/v1/posts/:postId/retry', async (req, res) => {
    const { postId } = req.params;
    const { userId, platforms } = req.body ?? {};
    if (!UUID_RE.test(postId) || typeof userId !== 'string' || !UUID_RE.test(userId)) {
        return res.status(400).json({ error: 'Missing or invalid id' });
    }
    if (platforms !== undefined && (!Array.isArray(platforms) || platforms.some((p) => typeof p !== 'string'))) {
        return res.status(400).json({ error: 'platforms must be an array of strings' });
    }
    const { data: post, error: postError } = await supabase.from('posts').select('id, team_id').eq('id', postId).maybeSingle();
    if (postError)
        return res.status(500).json({ error: postError.message });
    if (!post)
        return res.status(404).json({ error: 'Post not found' });
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', post.team_id).eq('user_id', userId).maybeSingle();
    if (!member)
        return res.status(403).json({ error: 'Unauthorized' });
    if (member.role === 'viewer')
        return res.status(403).json({ error: 'Unauthorized: Viewers cannot retry posts' });
    const { data: jobs, error: jobsError } = await supabase.from('publish_jobs').select('*').eq('post_id', postId);
    if (jobsError)
        return res.status(500).json({ error: jobsError.message });
    let failed = latestJobsPerPlatform(jobs ?? []).filter((j) => j.status === 'failed');
    if (Array.isArray(platforms) && platforms.length > 0)
        failed = failed.filter((j) => platforms.includes(j.platform));
    if (failed.length === 0) {
        return res.status(409).json({ error: 'Nothing to retry: this post has no failed platforms.', code: 'NOTHING_TO_RETRY' });
    }
    const created = [];
    try {
        for (const old of failed) {
            const { data: row, error } = await supabase.from('publish_jobs').insert({
                post_id: postId,
                user_id: userId,
                platform: old.platform,
                status: 'scheduled',
                content_type: old.content_type || 'post'
            }).select().single();
            if (error)
                throw error;
            created.push({ id: row.id, platform: row.platform });
            await publishQueue.add('publish-post', { jobId: row.id, postId, userId, platform: row.platform }, { ...PUBLISH_JOB_OPTIONS, jobId: row.id });
        }
        await supabase.from('posts').update({ status: 'scheduled', updated_at: new Date().toISOString() }).eq('id', postId);
        res.json({ success: true, retried: created.map((j) => j.platform), jobs: created.map((j) => j.id) });
    }
    catch (err) {
        console.error(err);
        // Roll back what this request created so no half-retried state is left behind
        for (const row of created) {
            try {
                const queued = await publishQueue.getJob(row.id);
                await queued?.remove();
            }
            catch { /* already running: it will fail harmlessly once its row is gone */ }
        }
        if (created.length > 0)
            await supabase.from('publish_jobs').delete().in('id', created.map((j) => j.id));
        res.status(500).json({ error: err.message });
    }
});
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => console.log(`Scheduling Service listening on port ${PORT}`));
