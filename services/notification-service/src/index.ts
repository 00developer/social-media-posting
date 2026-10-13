import dotenv from 'dotenv';
import path from 'path';
import { Worker, Job } from 'bullmq';
import { getRedisConnection, NOTIFICATIONS_QUEUE_NAME } from '@socialpush/shared';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

// Upstash drops idle connections (ECONNRESET). Without these guards an unhandled 'error' event crashed this service
// and every later notification (success or failure) just piled up in the queue, unread by anyone.
process.on('uncaughtException', (err: any) => {
  if (err?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT') return;
  console.error('[NotificationService] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err: any) => {
  if (err?.code === 'ECONNRESET' || err?.cause?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND' || err?.cause?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT') return;
  console.error('[NotificationService] Unhandled Rejection:', err?.message || err);
});

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redisConnection = getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');

console.log('Notification Service started. Listening to queue:', NOTIFICATIONS_QUEUE_NAME);

const worker = new Worker(NOTIFICATIONS_QUEUE_NAME, async (job: Job) => {
  const { userId, type, message } = job.data;
  console.log(`[NotificationService] Processing notification for user ${userId} - Type: ${type}`);

  try {
    // Throwing on a failed insert lets BullMQ record (and retry) the job instead of reporting it as done while the
    // user never sees the notification.
    const { error: insertError } = await supabase.from('notifications').insert({
      user_id: userId,
      type,
      message,
      read: false
    });
    if (insertError) throw new Error(`Saving the notification failed: ${insertError.message}`);

    // Email delivery is still a mock; log the user id rather than their address.
    console.log(`[Email Mock] Notification email for user ${userId}:`);
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

worker.on('error', (err) => {
  const code = (err as any)?.code;
  if (code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') return;
  console.error('[NotificationService] Internal error:', err.message);
});
