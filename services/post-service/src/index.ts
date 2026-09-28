import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { getCachedTeamRole, setCachedTeamRole, upstashRedis, getRedisConnection, requireUser } from '@socialpush/shared';
import { getContentProblem, getEditBlockReason } from './editability';
import { generateCaption, generateCaptionFromImage, checkAndRecordUsage, AiNotConfiguredError } from '@socialpush/ai';

dotenv.config({ path: path.join(__dirname, '../../../.env') });
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redis = upstashRedis || getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');

app.get('/api/v1/posts', async (req, res) => {
  const { teamId, from, to } = req.query;
  if (!teamId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });
  const userId = authed.userId;

  // Authorize user
  let role = await getCachedTeamRole(teamId as string, userId);
  if (!role) {
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
    if (member) {
      role = member.role;
      await setCachedTeamRole(teamId as string, userId, role as string);
    }
  }

  if (!role) return res.status(403).json({ error: 'Unauthorized' });

  const isRangeQuery = !!(from && to);
  if (isRangeQuery && (isNaN(Date.parse(from as string)) || isNaN(Date.parse(to as string)))) {
    return res.status(400).json({ error: 'Invalid from/to date range' });
  }

  try {
    // Range (calendar) queries are never cached: their keys are not invalidated when a
    // post is created, rescheduled or changes status, so a cache would serve stale events.
    const cacheKey = `feed:${teamId}`;
    const cachedFeed = isRangeQuery ? null : await redis.get(cacheKey);

    if (cachedFeed) {
      // If using upstashRedis, it might auto-parse JSON depending on the SDK version, or return string.
      const feed = typeof cachedFeed === 'string' ? JSON.parse(cachedFeed) : cachedFeed;
      return res.json({ success: true, data: feed, source: 'cache' });
    }

    // Cache Miss - Fetch from DB
    // The range (calendar) query leaves out the `user:user_id(email)` embed: posts.user_id
    // references auth.users, which PostgREST cannot embed ("Could not find a relationship
    // between 'posts' and 'user_id'"), and the calendar does not use the author's email.
    const selectClause = isRangeQuery
      ? '*, publish_jobs(*), schedules!inner(*)'
      : '*, user:user_id(email), publish_jobs(*), schedules(*)';
    let query = supabase.from('posts')
      .select(selectClause)
      .eq('team_id', teamId);
      
    if (isRangeQuery) {
      query = query.gte('schedules.scheduled_at', from).lte('schedules.scheduled_at', to);
    } else {
      query = query.order('created_at', { ascending: false }).limit(50);
    }

    const { data: posts, error } = await query;

    if (error) throw error;

    // Cache the normal feed for 60 seconds
    if (!isRangeQuery) {
      if (upstashRedis) {
        await upstashRedis.set(cacheKey, JSON.stringify(posts), { ex: 60 });
      } else {
        await (redis as any).setex(cacheKey, 60, JSON.stringify(posts));
      }
    }

    res.json({ success: true, data: posts, source: 'database' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/posts', async (req, res) => {
  const { teamId, content, mediaUrl } = req.body;

  if (!teamId || !content) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });
  const userId = authed.userId;

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

  // 2. Enforce Billing limits (Increased to 500 for testing). This pre-check is only a fast path to avoid an
  // obviously-over-limit request reaching the DB; the real, race-free enforcement is the
  // enforce_free_plan_post_limit trigger on posts (see supabase/migrations/20260928000001_atomic_usage_limits.sql)
  // - two requests arriving at the same instant could both pass this SELECT-based check before either INSERT
  // lands, but the trigger serializes them with an advisory lock so only one can actually get through.
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

  if (error) {
    if (error.message?.includes('FREE_PLAN_LIMIT_REACHED')) {
      return res.status(402).json({ error: 'Billing limit reached: Free plan allows max 500 posts.' });
    }
    return res.status(500).json({ error: error.message });
  }

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
  const { teamId } = req.query;

  if (!teamId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });
  const userId = authed.userId;

  let role = await getCachedTeamRole(teamId as string, userId);
  if (!role) {
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
    if (member) {
      role = member.role;
      await setCachedTeamRole(teamId as string, userId, role as string);
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Edit a post's caption. Only `posts.content` changes: schedules, publish_jobs and the queued
// BullMQ jobs are left alone, because the worker and publishing-service read the post fresh when
// a job runs. Refused once any platform's latest job is processing or completed.
app.patch('/api/v1/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { teamId, content } = req.body ?? {};

  if (!UUID_RE.test(id) || typeof teamId !== 'string' || !UUID_RE.test(teamId)) {
    return res.status(400).json({ error: 'Missing or invalid id' });
  }

  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });
  const userId = authed.userId;

  // Role: cache first, then the DB (same lookup as the other endpoints)
  let role = await getCachedTeamRole(teamId, userId);
  if (!role) {
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
    if (member) {
      role = member.role;
      await setCachedTeamRole(teamId, userId, role as string);
    }
  }
  if (!role) return res.status(403).json({ error: 'Unauthorized' });
  if (role === 'viewer') return res.status(403).json({ error: 'Unauthorized: Viewers cannot edit posts' });

  try {
    // Scoped to the team, so a post id from another team is simply "not found"
    const { data: post, error: postError } = await supabase.from('posts').select('*').eq('id', id).eq('team_id', teamId).maybeSingle();
    if (postError) throw postError;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { data: jobs, error: jobsError } = await supabase.from('publish_jobs').select('platform, status, created_at').eq('post_id', id);
    if (jobsError) throw jobsError;

    const blocked = getEditBlockReason(jobs ?? []);
    if (blocked) return res.status(409).json({ error: blocked, code: 'NOT_EDITABLE' });

    const problem = getContentProblem(content, jobs ?? []);
    if (problem) return res.status(400).json({ error: problem });

    // Nothing to do: don't touch the row (keeps updated_at meaningful)
    if (post.content === content) return res.json({ success: true, data: post, unchanged: true });

    // updated_at is set explicitly: on the live DB the trigger_set_timestamp trigger is not effective for
    // posts (an UPDATE leaves updated_at unchanged), and the value must move when the caption does.
    const { data: updated, error: updateError } = await supabase.from('posts').update({ content, updated_at: new Date().toISOString() }).eq('id', id).eq('team_id', teamId).select().single();
    if (updateError) throw updateError;

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

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Assistant: turns a short prompt into a caption, a longer paragraph and hashtags, for the composer's
// "Generate" button. The result is only a draft - nothing here saves or publishes anything.
app.post('/api/v1/ai/caption', async (req, res) => {
  const { teamId, prompt, platform, imageUrl } = req.body ?? {};
  if (typeof teamId !== 'string') return res.status(400).json({ error: 'Missing required fields' });
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!cleanPrompt) return res.status(400).json({ error: 'Enter a prompt to generate from.' });

  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });
  const userId = authed.userId;

  let role = await getCachedTeamRole(teamId, userId);
  if (!role) {
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
    if (member) {
      role = member.role;
      await setCachedTeamRole(teamId, userId, role as string);
    }
  }
  if (!role) return res.status(403).json({ error: 'Unauthorized' });
  if (role === 'viewer') return res.status(403).json({ error: 'Unauthorized: Viewers cannot use the AI assistant' });

  try {
    const usage = await checkAndRecordUsage(supabase, teamId, 'caption');
    if (!usage.allowed) return res.status(429).json({ error: 'This team has reached its AI generation limit for this month.' });

    const platformArg = typeof platform === 'string' ? platform : undefined;
    const result = typeof imageUrl === 'string' && imageUrl
      ? await generateCaptionFromImage({ prompt: cleanPrompt, imageUrl, platform: platformArg })
      : await generateCaption({ prompt: cleanPrompt, platform: platformArg });
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err instanceof AiNotConfiguredError) return res.status(503).json({ error: err.message });
    console.error('[AI] Caption generation failed:', err.message);
    res.status(502).json({ error: 'The AI assistant could not generate a result. Please try again.' });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Post Service listening on port ${PORT}`));
