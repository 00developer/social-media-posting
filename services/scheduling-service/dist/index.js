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
app.post('/api/v1/schedules', async (req, res) => {
    const { userId, postId, platforms, scheduledAt, timezone } = req.body;
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
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
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
                status: 'scheduled'
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
            }, { delay, jobId: jobRecord.id });
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
const PORT = process.env.PORT || 3004;
app.listen(PORT, () => console.log(`Scheduling Service listening on port ${PORT}`));
