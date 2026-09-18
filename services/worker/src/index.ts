import dotenv from 'dotenv';
import path from 'path';
import { Worker, Job } from 'bullmq';
import { getRedisConnection, PUBLISH_QUEUE_NAME, getNotificationsQueue } from '@socialpush/shared';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redisConnection = getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');
const notificationsQueue = getNotificationsQueue(redisConnection);

console.log('Worker started. Listening to queue:', PUBLISH_QUEUE_NAME);

const worker = new Worker(PUBLISH_QUEUE_NAME, async (job: Job) => {
  const { jobId, postId, userId, platform } = job.data;
  console.log(`[Worker] Processing job ${jobId} for platform ${platform}`);

  let contentExcerpt = 'Your post';
  try {
    await supabase.from('publish_jobs').update({ status: 'processing' }).eq('id', jobId);

    const { data: post } = await supabase.from('posts').select('content').eq('id', postId).single();
    contentExcerpt = post?.content ? `"${post.content.substring(0, 30)}${post.content.length > 30 ? '...' : ''}"` : 'Your post';

    const res = await fetch(`http://localhost:3003/api/v1/publish/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await res.json();

    if (res.status === 429) {
      console.log(`[Worker] Job ${jobId} rate limited. Delaying for 1 hour.`);
      await job.moveToDelayed(Date.now() + 60 * 60 * 1000, job.token!);
      await supabase.from('publish_jobs').update({ status: 'scheduled' }).eq('id', jobId);
      return;
    }

    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Publishing failed');
    }

    await supabase.from('publish_jobs').update({ status: 'completed' }).eq('id', jobId);
    console.log(`[Worker] Job ${jobId} completed successfully on ${platform}`);

    // Check if all jobs for this post are completed
    const { data: allJobs } = await supabase.from('publish_jobs').select('status').eq('post_id', postId);
    if (allJobs && allJobs.every(j => j.status === 'completed')) {
      await supabase.from('posts').update({ status: 'published' }).eq('id', postId);
      console.log(`[Worker] Post ${postId} fully published`);
    }

    // Push notification to queue
    await notificationsQueue.add('notify', {
      userId,
      type: 'success',
      message: `${contentExcerpt} to ${platform} has been successfully published.`
    });

  } catch (error: any) {
    console.error(`[Worker] Job ${jobId} failed:`, error.message);
    
    const { data: currentJob } = await supabase.from('publish_jobs').select('retry_count').eq('id', jobId).single();
    const newRetryCount = (currentJob?.retry_count || 0) + 1;

    if (newRetryCount > 3) {
      await supabase.from('publish_jobs').update({ 
        status: 'failed', 
        error_message: `Max retries exceeded: ${error.message}`,
        retry_count: newRetryCount 
      }).eq('id', jobId);

      await supabase.from('posts').update({ status: 'failed' }).eq('id', postId);

      await notificationsQueue.add('notify', {
        userId,
        type: 'failure',
        message: `Failed to publish ${contentExcerpt.toLowerCase()} to ${platform} after 3 retries. Error: ${error.message}`
      });
    } else {
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
