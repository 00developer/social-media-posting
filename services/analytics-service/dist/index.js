"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const crypto_1 = __importDefault(require("crypto"));
const bullmq_1 = require("bullmq");
const shared_1 = require("@socialpush/shared");
const supabase_js_1 = require("@supabase/supabase-js");
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
    console.error('[Analytics] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err) => {
    if (err.code === 'ECONNRESET' || err.cause?.code === 'ECONNRESET')
        return;
    console.error('[Analytics] Unhandled Rejection:', err.message || err);
});
const redisConnection = (0, shared_1.getRedisConnection)(process.env.REDIS_URL || 'redis://localhost:6379');
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';
function decrypt(text) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// API route to accept real-time analytics events
app.post('/api/v1/analytics/event', async (req, res) => {
    const { postId, platform, eventType } = req.body;
    if (!postId || !platform || !eventType) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['views', 'likes', 'shares'].includes(eventType)) {
        return res.status(400).json({ error: 'Invalid eventType' });
    }
    try {
        // Atomically increment the specific counter in Redis
        const key = `analytics:${postId}:${platform}:${eventType}`;
        if (shared_1.upstashRedis) {
            await shared_1.upstashRedis.incr(key);
        }
        else {
            await redisConnection.incr(key);
        }
        res.json({ success: true });
    }
    catch (err) {
        console.error('Error incrementing counter:', err);
        res.status(500).json({ error: 'Failed to record event' });
    }
});
const PORT = process.env.PORT || 3008;
app.listen(PORT, () => {
    console.log(`Analytics API running on port ${PORT}`);
});
const ANALYTICS_QUEUE_NAME = 'analytics-queue';
const analyticsQueue = new bullmq_1.Queue(ANALYTICS_QUEUE_NAME, { connection: redisConnection });
async function setupCron() {
    await analyticsQueue.add('sync-analytics', {}, {
        repeat: { pattern: '*/5 * * * *' } // Every 5 minutes
    });
    console.log('Analytics Worker started. Scheduled to sync every 5 minutes.');
}
const worker = new bullmq_1.Worker(ANALYTICS_QUEUE_NAME, async (job) => {
    console.log(`[AnalyticsService] Running analytics sync...`);
    try {
        // 1. Sync real-time events from Redis
        let allKeys = [];
        if (shared_1.upstashRedis) {
            let cursor = 0;
            do {
                const [nextCursor, keys] = await shared_1.upstashRedis.scan(cursor, { match: 'analytics:*', count: 100 });
                allKeys.push(...keys);
                cursor = Number(nextCursor);
            } while (cursor !== 0);
        }
        else {
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redisConnection.scan(cursor, 'MATCH', 'analytics:*', 'COUNT', 100);
                allKeys.push(...keys);
                cursor = nextCursor;
            } while (cursor !== '0');
        }
        if (allKeys.length > 0) {
            const aggregated = {};
            for (const key of allKeys) {
                let valStr = null;
                if (shared_1.upstashRedis) {
                    const v = await shared_1.upstashRedis.get(key);
                    valStr = v !== null ? String(v) : null;
                    if (valStr)
                        await shared_1.upstashRedis.del(key);
                }
                else {
                    valStr = await redisConnection.getdel(key);
                }
                if (!valStr)
                    continue;
                const val = parseInt(valStr, 10);
                if (isNaN(val))
                    continue;
                const [, postId, platform, eventType] = key.split(':');
                const aggKey = `${postId}:${platform}`;
                if (!aggregated[aggKey]) {
                    aggregated[aggKey] = { views: 0, likes: 0, shares: 0 };
                }
                if (eventType === 'views')
                    aggregated[aggKey].views += val;
                if (eventType === 'likes')
                    aggregated[aggKey].likes += val;
                if (eventType === 'shares')
                    aggregated[aggKey].shares += val;
            }
            for (const [aggKey, counts] of Object.entries(aggregated)) {
                const [postId, platform] = aggKey.split(':');
                const { data: existing } = await supabase.from('analytics')
                    .select('*')
                    .eq('post_id', postId)
                    .eq('platform', platform)
                    .single();
                if (existing) {
                    await supabase.from('analytics')
                        .update({
                        likes: existing.likes + counts.likes,
                        shares: existing.shares + counts.shares,
                        views: existing.views + counts.views,
                        recorded_at: new Date().toISOString()
                    })
                        .eq('id', existing.id);
                }
                else {
                    const { data: jobData } = await supabase.from('publish_jobs')
                        .select('user_id')
                        .eq('post_id', postId)
                        .single();
                    await supabase.from('analytics')
                        .insert({
                        post_id: postId,
                        user_id: jobData?.user_id || 'unknown',
                        platform: platform,
                        likes: counts.likes,
                        shares: counts.shares,
                        views: counts.views,
                        recorded_at: new Date().toISOString()
                    });
                }
            }
            console.log(`[AnalyticsService] Successfully synced redis analytics for ${Object.keys(aggregated).length} posts.`);
        }
        // 2. Sync YouTube Analytics via API
        const { data: ytSessions } = await supabase.from('youtube_upload_sessions')
            .select('post_id, user_id, video_id')
            .eq('status', 'completed')
            .not('video_id', 'is', null);
        if (ytSessions && ytSessions.length > 0) {
            for (const session of ytSessions) {
                try {
                    const { data: account } = await supabase.from('social_accounts')
                        .select('*')
                        .eq('user_id', session.user_id)
                        .eq('platform', 'youtube')
                        .single();
                    if (!account)
                        continue;
                    let activeToken = decrypt(account.access_token_encrypted);
                    // Test token by fetching basic stats
                    let ytRes = await fetch(`https://youtube.googleapis.com/youtube/v3/videos?part=statistics&id=${session.video_id}`, {
                        headers: { 'Authorization': `Bearer ${activeToken}` }
                    });
                    if (ytRes.status === 401) {
                        // Attempt refresh
                        const refreshRes = await fetch('http://localhost:3001/api/v1/auth/youtube/refresh', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ accountId: account.id })
                        });
                        const refreshData = await refreshRes.json();
                        if (refreshData.success) {
                            activeToken = refreshData.accessToken;
                            ytRes = await fetch(`https://youtube.googleapis.com/youtube/v3/videos?part=statistics&id=${session.video_id}`, {
                                headers: { 'Authorization': `Bearer ${activeToken}` }
                            });
                        }
                    }
                    if (ytRes.ok) {
                        const ytData = await ytRes.json();
                        if (ytData.items && ytData.items.length > 0) {
                            const stats = ytData.items[0].statistics;
                            const views = parseInt(stats.viewCount || '0', 10);
                            const likes = parseInt(stats.likeCount || '0', 10);
                            const comments = parseInt(stats.commentCount || '0', 10);
                            const { data: existing } = await supabase.from('analytics')
                                .select('*')
                                .eq('post_id', session.post_id)
                                .eq('platform', 'youtube')
                                .single();
                            if (existing) {
                                await supabase.from('analytics')
                                    .update({
                                    views,
                                    likes,
                                    shares: comments, // Map comments to shares for standard schema
                                    recorded_at: new Date().toISOString()
                                })
                                    .eq('id', existing.id);
                            }
                            else {
                                await supabase.from('analytics')
                                    .insert({
                                    post_id: session.post_id,
                                    user_id: session.user_id,
                                    platform: 'youtube',
                                    views,
                                    likes,
                                    shares: comments,
                                    recorded_at: new Date().toISOString()
                                });
                            }
                        }
                    }
                }
                catch (err) {
                    console.error(`[AnalyticsService] Failed to sync YouTube stats for video ${session.video_id}:`, err.message);
                }
            }
            console.log(`[AnalyticsService] Successfully synced YouTube API stats for ${ytSessions.length} videos.`);
        }
        // 3. Sync Pinterest Analytics via API
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const { data: pinterestPins } = await supabase.from('pinterest_published_pins')
            .select('*')
            .gte('created_at', ninetyDaysAgo.toISOString());
        if (pinterestPins && pinterestPins.length > 0) {
            for (const pin of pinterestPins) {
                try {
                    const { data: account } = await supabase.from('social_accounts')
                        .select('*')
                        .eq('user_id', pin.user_id)
                        .eq('platform', 'pinterest')
                        .single();
                    if (!account)
                        continue;
                    const activeToken = decrypt(account.access_token_encrypted);
                    const endDate = new Date().toISOString().split('T')[0];
                    // Start date needs to be at least the creation date, but if it was created today, start and end are the same
                    const pinStartDateStr = pin.created_at.split('T')[0];
                    const url = `https://api.pinterest.com/v5/pins/${pin.pin_id}/analytics?start_date=${pinStartDateStr}&end_date=${endDate}&metric_types=IMPRESSION,OUTBOUND_CLICK,SAVE`;
                    const pinRes = await fetch(url, {
                        headers: { 'Authorization': `Bearer ${activeToken}` }
                    });
                    if (pinRes.ok) {
                        const pinData = await pinRes.json();
                        const summary = pinData.all_metrics || {};
                        const views = summary.IMPRESSION || 0;
                        const clicks = summary.OUTBOUND_CLICK || 0;
                        const saves = summary.SAVE || 0;
                        const { data: existing } = await supabase.from('analytics')
                            .select('*')
                            .eq('post_id', pin.post_id)
                            .eq('platform', 'pinterest')
                            .single();
                        if (existing) {
                            await supabase.from('analytics')
                                .update({
                                views,
                                likes: saves,
                                shares: clicks,
                                recorded_at: new Date().toISOString()
                            })
                                .eq('id', existing.id);
                        }
                        else {
                            await supabase.from('analytics')
                                .insert({
                                post_id: pin.post_id,
                                user_id: pin.user_id,
                                platform: 'pinterest',
                                views,
                                likes: saves,
                                shares: clicks,
                                recorded_at: new Date().toISOString()
                            });
                        }
                    }
                    else {
                        console.warn(`[AnalyticsService] Failed to fetch Pinterest stats for pin ${pin.pin_id}:`, await pinRes.text());
                    }
                }
                catch (err) {
                    console.error(`[AnalyticsService] Failed to sync Pinterest stats for pin ${pin.pin_id}:`, err.message);
                }
            }
            console.log(`[AnalyticsService] Successfully synced Pinterest API stats for ${pinterestPins.length} pins.`);
        }
        // 4. Sync Threads Analytics via API
        const { data: threadsAccounts } = await supabase.from('social_accounts')
            .select('*')
            .eq('platform', 'threads');
        if (threadsAccounts && threadsAccounts.length > 0) {
            for (const account of threadsAccounts) {
                try {
                    const activeToken = decrypt(account.access_token_encrypted);
                    // Fetch recent threads
                    const threadsRes = await fetch(`https://graph.threads.net/v1.0/me/threads?fields=id,text&access_token=${activeToken}`);
                    if (!threadsRes.ok)
                        continue;
                    const threadsData = await threadsRes.json();
                    const threads = threadsData.data || [];
                    for (const thread of threads) {
                        if (!thread.text)
                            continue;
                        // Find matching post in our DB by text content (since we cannot add new tables for Threads)
                        const { data: matchedPost } = await supabase.from('posts')
                            .select('id')
                            .eq('user_id', account.user_id)
                            .eq('content', thread.text)
                            .limit(1)
                            .maybeSingle();
                        if (!matchedPost)
                            continue;
                        // Fetch insights for this specific thread
                        const insightsRes = await fetch(`https://graph.threads.net/v1.0/${thread.id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${activeToken}`);
                        if (!insightsRes.ok)
                            continue;
                        const insightsData = await insightsRes.json();
                        const metrics = insightsData.data || [];
                        let views = 0, likes = 0, replies = 0, reposts = 0, quotes = 0;
                        for (const m of metrics) {
                            if (m.name === 'views')
                                views = m.values[0].value;
                            if (m.name === 'likes')
                                likes = m.values[0].value;
                            if (m.name === 'replies')
                                replies = m.values[0].value;
                            if (m.name === 'reposts')
                                reposts = m.values[0].value;
                            if (m.name === 'quotes')
                                quotes = m.values[0].value;
                        }
                        const shares = reposts + quotes + replies;
                        const { data: existing } = await supabase.from('analytics')
                            .select('id')
                            .eq('post_id', matchedPost.id)
                            .eq('platform', 'threads')
                            .maybeSingle();
                        if (existing) {
                            await supabase.from('analytics').update({
                                views, likes, shares, recorded_at: new Date().toISOString()
                            }).eq('id', existing.id);
                        }
                        else {
                            await supabase.from('analytics').insert({
                                post_id: matchedPost.id,
                                user_id: account.user_id,
                                platform: 'threads',
                                views, likes, shares, recorded_at: new Date().toISOString()
                            });
                        }
                    }
                }
                catch (err) {
                    console.error(`[AnalyticsService] Failed to sync Threads stats for user ${account.user_id}:`, err.message);
                }
            }
            console.log(`[AnalyticsService] Successfully synced Threads API stats for ${threadsAccounts.length} accounts.`);
        }
    }
    catch (err) {
        console.error(`[AnalyticsService] Error:`, err.message);
    }
}, { connection: redisConnection });
setupCron();
worker.on('error', (err) => {
    if (err.code === 'ECONNRESET')
        return;
    console.error(`[AnalyticsService] Internal error:`, err.message);
});
