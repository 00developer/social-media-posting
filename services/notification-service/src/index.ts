import dotenv from 'dotenv';
import path from 'path';
import { Worker, Job } from 'bullmq';
import { getRedisConnection, NOTIFICATIONS_QUEUE_NAME } from '@socialpush/shared';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redisConnection = getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');

console.log('Notification Service started. Listening to queue:', NOTIFICATIONS_QUEUE_NAME);

const worker = new Worker(NOTIFICATIONS_QUEUE_NAME, async (job: Job) => {
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

  } catch (error: any) {
    console.error(`[NotificationService] Error:`, error.message);
    throw error;
  }
}, { connection: redisConnection });

worker.on('failed', (job, err) => {
  console.log(`[NotificationService] Job ${job?.id} failed with ${err.message}`);
});
