import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { getCachedTeamRole, setCachedTeamRole, upstashRedis, getRedisConnection } from '@socialpush/shared';

dotenv.config({ path: path.join(__dirname, '../../../.env') });
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redis = upstashRedis || getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');

app.get('/api/v1/posts', async (req, res) => {
  const { userId, teamId } = req.query;
  if (!userId || !teamId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Authorize user
  let role = await getCachedTeamRole(teamId as string, userId as string);
  if (!role) {
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
    if (member) {
      role = member.role;
      await setCachedTeamRole(teamId as string, userId as string, role as string);
    }
  }

  if (!role) return res.status(403).json({ error: 'Unauthorized' });

  try {
    const cacheKey = `feed:${teamId}`;
    const cachedFeed = await redis.get(cacheKey);
    
    if (cachedFeed) {
      // If using upstashRedis, it might auto-parse JSON depending on the SDK version, or return string.
      const feed = typeof cachedFeed === 'string' ? JSON.parse(cachedFeed) : cachedFeed;
      return res.json({ success: true, data: feed, source: 'cache' });
    }

    // Cache Miss - Fetch from DB
    const { data: posts, error } = await supabase.from('posts')
      .select('*, user:user_id(email), publish_jobs(*), schedules(*)')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Cache for 60 seconds
    if (upstashRedis) {
      await upstashRedis.set(cacheKey, JSON.stringify(posts), { ex: 60 });
    } else {
      await (redis as any).setex(cacheKey, 60, JSON.stringify(posts));
    }

    res.json({ success: true, data: posts, source: 'database' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/posts', async (req, res) => {
  const { userId, teamId, content, mediaUrl } = req.body; 
  
  if (!userId || !teamId || !content) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1. Enforce RBAC using Role Cache
  let role = await getCachedTeamRole(teamId, userId);
  let plan = 'free';

  if (!role) {
    const { data: member } = await supabase.from('team_members')
      .select('role, teams(plan)')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .single();

    if (member) {
      role = member.role;
      plan = (member.teams as any)?.plan || 'free';
      await setCachedTeamRole(teamId as string, userId as string, role as string);
    }
  }

  if (!role || role === 'viewer') {
    return res.status(403).json({ error: 'Unauthorized: Viewers cannot create posts' });
  }

  // Fetch plan if we had a role cache hit
  if (role && plan === 'free') {
    const { data: teamData } = await supabase.from('teams').select('plan').eq('id', teamId).single();
    if (teamData) plan = teamData.plan;
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

  if (error) return res.status(500).json({ error: error.message });

  // Invalidate feed cache so new post appears immediately
  try {
    const cacheKey = `feed:${teamId}`;
    if (upstashRedis) {
      await upstashRedis.del(cacheKey);
    } else {
      await (redis as any).del(cacheKey);
    }
  } catch (err) {
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

  let role = await getCachedTeamRole(teamId as string, userId as string);
  if (!role) {
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
    if (member) {
      role = member.role;
      await setCachedTeamRole(teamId as string, userId as string, role as string);
    }
  }

  if (!role || role === 'viewer') return res.status(403).json({ error: 'Unauthorized' });

  const { error } = await supabase.from('posts').delete().eq('id', id).eq('team_id', teamId);
  if (error) return res.status(500).json({ error: error.message });

  try {
    const cacheKey = `feed:${teamId}`;
    if (upstashRedis) {
      await upstashRedis.del(cacheKey);
    } else {
      await (redis as any).del(cacheKey);
    }
  } catch (err) {
    console.error('Failed to invalidate feed cache', err);
  }

  res.json({ success: true });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Post Service listening on port ${PORT}`));
