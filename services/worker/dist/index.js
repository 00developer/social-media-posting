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
const notificationsQueue = (0, shared_1.getNotificationsQueue)(redisConnection);
console.log('Worker started. Listening to queue:', shared_1.PUBLISH_QUEUE_NAME);
const worker = new bullmq_1.Worker(shared_1.PUBLISH_QUEUE_NAME, async (job) => {
    const { jobId, postId, userId, platform } = job.data;
    console.log(`[Worker] Processing job ${jobId} for platform ${platform}`);
    try {
        await supabase.from('publish_jobs').update({ status: 'processing' }).eq('id', jobId);
        const res = await fetch(`http://localhost:3003/api/v1/publish/${jobId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await res.json();
        if (!res.ok || !result.success) {
            throw new Error(result.error || 'Publishing failed');
        }
        await supabase.from('publish_jobs').update({ status: 'completed' }).eq('id', jobId);
        console.log(`[Worker] Job ${jobId} completed successfully on ${platform}`);
        // Push notification to queue
        await notificationsQueue.add('notify', {
            userId,
            type: 'success',
            message: `Your post to ${platform} has been successfully published.`
        });
    }
    catch (error) {
        console.error(`[Worker] Job ${jobId} failed:`, error.message);
        const { data: currentJob } = await supabase.from('publish_jobs').select('retry_count').eq('id', jobId).single();
        const newRetryCount = (currentJob?.retry_count || 0) + 1;
        if (newRetryCount > 3) {
            await supabase.from('publish_jobs').update({
                status: 'failed',
                error_message: `Max retries exceeded: ${error.message}`,
                retry_count: newRetryCount
            }).eq('id', jobId);
            await notificationsQueue.add('notify', {
                userId,
                type: 'failure',
                message: `Failed to publish your post to ${platform} after 3 retries. Error: ${error.message}`
            });
        }
        else {
            await supabase.from('publish_jobs').update({
                status: 'failed',
                error_message: error.message,
                retry_count: newRetryCount
            }).eq('id', jobId);
            throw error;
        }
    }
}, { connection: redisConnection });
worker.on('failed', (job, err) => {
    console.log(`[Worker] ${job?.id} has failed with ${err.message}`);
});
