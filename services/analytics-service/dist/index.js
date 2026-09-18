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
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const redisConnection = (0, shared_1.getRedisConnection)(process.env.REDIS_URL || 'redis://localhost:6379');
const ANALYTICS_QUEUE_NAME = 'analytics-queue';
const analyticsQueue = new bullmq_1.Queue(ANALYTICS_QUEUE_NAME, { connection: redisConnection });
async function setupCron() {
    await analyticsQueue.add('fetch-analytics', {}, {
        repeat: { pattern: '*/5 * * * *' } // Every 5 minutes
    });
    console.log('Analytics Service started. Scheduled to run every 5 minutes.');
}
const worker = new bullmq_1.Worker(ANALYTICS_QUEUE_NAME, async (job) => {
    console.log(`[AnalyticsService] Running analytics pull...`);
    try {
        const { data: jobs, error } = await supabase.from('publish_jobs')
            .select('post_id, user_id, platform')
            .eq('status', 'completed');
        if (error)
            throw error;
        if (!jobs || jobs.length === 0)
            return;
        for (const j of jobs) {
            const { data: existing } = await supabase.from('analytics')
                .select('*')
                .eq('post_id', j.post_id)
                .eq('platform', j.platform)
                .single();
            const mockLikes = Math.floor(Math.random() * 5);
            const mockShares = Math.floor(Math.random() * 2);
            const mockViews = Math.floor(Math.random() * 20) + 5;
            if (existing) {
                await supabase.from('analytics')
                    .update({
                    likes: existing.likes + mockLikes,
                    shares: existing.shares + mockShares,
                    views: existing.views + mockViews,
                    recorded_at: new Date().toISOString()
                })
                    .eq('id', existing.id);
            }
            else {
                await supabase.from('analytics')
                    .insert({
                    post_id: j.post_id,
                    user_id: j.user_id,
                    platform: j.platform,
                    likes: mockLikes,
                    shares: mockShares,
                    views: mockViews,
                    recorded_at: new Date().toISOString()
                });
            }
        }
        console.log(`[AnalyticsService] Successfully updated analytics for ${jobs.length} published posts.`);
    }
    catch (err) {
        console.error(`[AnalyticsService] Error:`, err.message);
    }
}, { connection: redisConnection });
setupCron();
