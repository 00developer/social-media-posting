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
console.log('Notification Service started. Listening to queue:', shared_1.NOTIFICATIONS_QUEUE_NAME);
const worker = new bullmq_1.Worker(shared_1.NOTIFICATIONS_QUEUE_NAME, async (job) => {
    const { userId, type, message } = job.data;
    console.log(`[NotificationService] Processing notification for user ${userId} - Type: ${type}`);
    try {
        await supabase.from('notifications').insert({
            user_id: userId,
            type,
            message,
            read: false
        });
        const { data: user } = await supabase.auth.admin.getUserById(userId);
        const email = user?.user?.email;
        console.log(`[Email Mock] Sending email to ${email}:`);
        console.log(`Subject: SocialPush Update - ${type === 'success' ? 'Post Published' : 'Publishing Failed'}`);
        console.log(`Body: ${message}`);
        console.log('----------------------------------------------------');
    }
    catch (error) {
        console.error(`[NotificationService] Error:`, error.message);
        throw error;
    }
}, { connection: redisConnection });
worker.on('failed', (job, err) => {
    console.log(`[NotificationService] Job ${job?.id} failed with ${err.message}`);
});
