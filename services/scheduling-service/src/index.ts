import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { getRedisConnection, getQueue } from '@socialpush/shared';

dotenv.config({ path: path.join(__dirname, '../../../.env') });
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redisConnection = getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');
const publishQueue = getQueue(redisConnection);

app.post('/api/v1/schedules', async (req, res) => {
  const { userId, postId, platforms, scheduledAt, timezone, contentType } = req.body;
  
  if (!userId || !postId || !platforms || !platforms.length || !scheduledAt || !timezone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: post } = await supabase.from('posts').select('team_id').eq('id', postId).single();
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const { data: member } = await supabase.from('team_members').select('role').eq('team_id', post.team_id).eq('user_id', userId).single();
  if (!member || member.role === 'viewer') return res.status(403).json({ error: 'Unauthorized: Viewers cannot schedule posts' });

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
      if (scheduleError) throw scheduleError;

      // Insert publish job record
      const { data: jobRecord, error: jobError } = await supabase.from('publish_jobs').insert({
        post_id: postId,
        user_id: userId,
        platform,
        status: 'scheduled',
        content_type: contentType || 'post'
      }).select().single();
      if (jobError) throw jobError;

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
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => console.log(`Scheduling Service listening on port ${PORT}`));
