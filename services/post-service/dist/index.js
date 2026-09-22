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
const editability_1 = require("./editability");
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const redis = shared_1.upstashRedis || (0, shared_1.getRedisConnection)(process.env.REDIS_URL || 'redis://localhost:6379');
app.get('/api/v1/posts', async (req, res) => {
    const { userId, teamId, from, to } = req.query;
    if (!userId || !teamId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // Authorize user
    let role = await (0, shared_1.getCachedTeamRole)(teamId, userId);
    if (!role) {
        const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
        if (member) {
            role = member.role;
            await (0, shared_1.setCachedTeamRole)(teamId, userId, role);
        }
    }
    if (!role)
        return res.status(403).json({ error: 'Unauthorized' });
    const isRangeQuery = !!(from && to);
    if (isRangeQuery && (isNaN(Date.parse(from)) || isNaN(Date.parse(to)))) {
        return res.status(400).json({ error: 'Invalid from/to date range' });
    }
    try {
        // Range (calendar) queries are never cached: their keys are not invalidated when a
        // post is created, rescheduled or changes status, so a cache would serve stale events.
        const cacheKey = `feed:${teamId}`;
        const cachedFeed = isRangeQuery ? null : await redis.get(cacheKey);
        if (cachedFeed) {
            // If using upstashRedis, it might auto-parse JSON depending on the SDK version, or return string.
            const feed = typeof cachedFeed === 'string' ? JSON.parse(cachedFeed) : cachedFeed;
            return res.json({ success: true, data: feed, source: 'cache' });
        }
        // Cache Miss - Fetch from DB
        // The range (calendar) query leaves out the `user:user_id(email)` embed: posts.user_id
        // references auth.users, which PostgREST cannot embed ("Could not find a relationship
        // between 'posts' and 'user_id'"), and the calendar does not use the author's email.
        const selectClause = isRangeQuery
            ? '*, publish_jobs(*), schedules!inner(*)'
            : '*, user:user_id(email), publish_jobs(*), schedules(*)';
        let query = supabase.from('posts')
            .select(selectClause)
            .eq('team_id', teamId);
        if (isRangeQuery) {
            query = query.gte('schedules.scheduled_at', from).lte('schedules.scheduled_at', to);
        }
        else {
            query = query.order('created_at', { ascending: false }).limit(50);
        }
        const { data: posts, error } = await query;
        if (error)
            throw error;
        // Cache the normal feed for 60 seconds
        if (!isRangeQuery) {
            if (shared_1.upstashRedis) {
                await shared_1.upstashRedis.set(cacheKey, JSON.stringify(posts), { ex: 60 });
            }
            else {
                await redis.setex(cacheKey, 60, JSON.stringify(posts));
            }
        }
        res.json({ success: true, data: posts, source: 'database' });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/v1/posts', async (req, res) => {
    const { userId, teamId, content, mediaUrl } = req.body;
    if (!userId || !teamId || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // 1. Enforce RBAC using Role Cache
    let role = await (0, shared_1.getCachedTeamRole)(teamId, userId);
    let plan = 'free';
    if (!role) {
        const { data: member } = await supabase.from('team_members')
            .select('role, teams(plan)')
            .eq('team_id', teamId)
            .eq('user_id', userId)
            .single();
        if (member) {
            role = member.role;
            plan = member.teams?.plan || 'free';
            await (0, shared_1.setCachedTeamRole)(teamId, userId, role);
        }
    }
    if (!role || role === 'viewer') {
        return res.status(403).json({ error: 'Unauthorized: Viewers cannot create posts' });
    }
    // Fetch plan if we had a role cache hit
    if (role && plan === 'free') {
        const { data: teamData } = await supabase.from('teams').select('plan').eq('id', teamId).single();
        if (teamData)
            plan = teamData.plan;
    }
    // 2. Enforce Billing limits (Increased to 500 for testing)
    if (plan === 'free') {
        const { count } = await supabase.from('posts').select('*', { count: 'exact', head: true }).eq('team_id', teamId);
        if (count !== null && count >= 500) {
            return res.status(402).json({ error: 'Billing limit reached: Free plan allows max 500 posts.' });
        }
    }
    const { data, error } = await supabase.from('posts').insert({
        team_id: teamId,
        user_id: userId,
        content,
        media_url: mediaUrl,
        status: 'draft'
    }).select().single();
    if (error)
        return res.status(500).json({ error: error.message });
    // Invalidate feed cache so new post appears immediately
    try {
        const cacheKey = `feed:${teamId}`;
        if (shared_1.upstashRedis) {
            await shared_1.upstashRedis.del(cacheKey);
        }
        else {
            await redis.del(cacheKey);
        }
    }
    catch (err) {
        console.error('Failed to invalidate feed cache', err);
    }
    res.json({ success: true, data });
});
app.delete('/api/v1/posts/:id', async (req, res) => {
    const { id } = req.params;
    const { userId, teamId } = req.query;
    if (!userId || !teamId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    let role = await (0, shared_1.getCachedTeamRole)(teamId, userId);
    if (!role) {
        const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
        if (member) {
            role = member.role;
            await (0, shared_1.setCachedTeamRole)(teamId, userId, role);
        }
    }
    if (!role || role === 'viewer')
        return res.status(403).json({ error: 'Unauthorized' });
    const { error } = await supabase.from('posts').delete().eq('id', id).eq('team_id', teamId);
    if (error)
        return res.status(500).json({ error: error.message });
    try {
        const cacheKey = `feed:${teamId}`;
        if (shared_1.upstashRedis) {
            await shared_1.upstashRedis.del(cacheKey);
        }
        else {
            await redis.del(cacheKey);
        }
    }
    catch (err) {
        console.error('Failed to invalidate feed cache', err);
    }
    res.json({ success: true });
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Edit a post's caption. Only `posts.content` changes: schedules, publish_jobs and the queued
// BullMQ jobs are left alone, because the worker and publishing-service read the post fresh when
// a job runs. Refused once any platform's latest job is processing or completed.
app.patch('/api/v1/posts/:id', async (req, res) => {
    const { id } = req.params;
    const { userId, teamId, content } = req.body ?? {};
    if (!UUID_RE.test(id) || typeof userId !== 'string' || !UUID_RE.test(userId) || typeof teamId !== 'string' || !UUID_RE.test(teamId)) {
        return res.status(400).json({ error: 'Missing or invalid id' });
    }
    // Role: cache first, then the DB (same lookup as the other endpoints)
    let role = await (0, shared_1.getCachedTeamRole)(teamId, userId);
    if (!role) {
        const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
        if (member) {
            role = member.role;
            await (0, shared_1.setCachedTeamRole)(teamId, userId, role);
        }
    }
    if (!role)
        return res.status(403).json({ error: 'Unauthorized' });
    if (role === 'viewer')
        return res.status(403).json({ error: 'Unauthorized: Viewers cannot edit posts' });
    try {
        // Scoped to the team, so a post id from another team is simply "not found"
        const { data: post, error: postError } = await supabase.from('posts').select('*').eq('id', id).eq('team_id', teamId).maybeSingle();
        if (postError)
            throw postError;
        if (!post)
            return res.status(404).json({ error: 'Post not found' });
        const { data: jobs, error: jobsError } = await supabase.from('publish_jobs').select('platform, status, created_at').eq('post_id', id);
        if (jobsError)
            throw jobsError;
        const blocked = (0, editability_1.getEditBlockReason)(jobs ?? []);
        if (blocked)
            return res.status(409).json({ error: blocked, code: 'NOT_EDITABLE' });
        const problem = (0, editability_1.getContentProblem)(content, jobs ?? []);
        if (problem)
            return res.status(400).json({ error: problem });
        // Nothing to do: don't touch the row (keeps updated_at meaningful)
        if (post.content === content)
            return res.json({ success: true, data: post, unchanged: true });
        // updated_at is set explicitly: on the live DB the trigger_set_timestamp trigger is not effective for
        // posts (an UPDATE leaves updated_at unchanged), and the value must move when the caption does.
        const { data: updated, error: updateError } = await supabase.from('posts').update({ content, updated_at: new Date().toISOString() }).eq('id', id).eq('team_id', teamId).select().single();
        if (updateError)
            throw updateError;
        try {
            const cacheKey = `feed:${teamId}`;
            if (shared_1.upstashRedis) {
                await shared_1.upstashRedis.del(cacheKey);
            }
            else {
                await redis.del(cacheKey);
            }
        }
        catch (err) {
            console.error('Failed to invalidate feed cache', err);
        }
        res.json({ success: true, data: updated });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Post Service listening on port ${PORT}`));
