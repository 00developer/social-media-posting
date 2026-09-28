import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { Queue, Worker, Job } from 'bullmq';
import { getRedisConnection, upstashRedis, requireEncryptionKey } from '@socialpush/shared';
import { createClient } from '@supabase/supabase-js';
import { syncComments, replyToComment, type CommentsContext } from './comments';
import { syncPublishedPostStats, syncThreadsStats, backfillAnalyticsTeamIds, recordAnalyticsHistory } from './publishedStats';
import { suggestReplies } from './aiComments';
import { cleanupOldAiContextUploads } from './cleanup';
import { classifyComment, generateReply, checkAndRecordUsage, AiNotConfiguredError } from '@socialpush/ai';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const PINTEREST_API_BASE = process.env.PINTEREST_API_BASE || 'https://api.pinterest.com';

// Trial-access apps get 401 in the sandbox with a normal OAuth token; the sandbox needs the token generated in the Pinterest developer portal.
const pinterestToken = (oauthToken: string) =>
  PINTEREST_API_BASE.includes('sandbox') && process.env.PINTEREST_SANDBOX_TOKEN ? process.env.PINTEREST_SANDBOX_TOKEN : oauthToken;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

process.on('uncaughtException', (err: any) => {
  if (err.code === 'ECONNRESET') return;
  console.error('[Analytics] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err: any) => {
  if (err.code === 'ECONNRESET' || err.cause?.code === 'ECONNRESET') return;
  console.error('[Analytics] Unhandled Rejection:', err.message || err);
});
const redisConnection = getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');
const ENCRYPTION_KEY = requireEncryptionKey();
// Server-to-server call, not exposed to the browser - a plain env var (not NEXT_PUBLIC_*) is enough.
const ACCOUNT_SERVICE_URL = process.env.ACCOUNT_SERVICE_URL || 'http://localhost:3001';

function decrypt(text: string) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

const app = express();
app.use(cors());
app.use(express.json());

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
    if (upstashRedis) {
      await upstashRedis.incr(key);
    } else {
      await redisConnection.incr(key);
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error incrementing counter:', err);
    res.status(500).json({ error: 'Failed to record event' });
  }
});

// --- Comments: read the comments on published posts and reply to them from the dashboard ---------------------------
const commentsCtx: CommentsContext = { supabase, decrypt, accountServiceUrl: ACCOUNT_SERVICE_URL };

// The caller is the signed-in dashboard user: check their Supabase token and that they belong to the team.
async function authorizeTeam(req: express.Request, teamId: string | null | undefined): Promise<{ userId: string } | { error: string; status: number }> {
  const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: 'Invalid or expired session', status: 401 };
  if (!teamId) return { error: 'Missing team', status: 400 };
  const { data: member } = await supabase.from('team_members').select('user_id').eq('team_id', teamId).eq('user_id', data.user.id).maybeSingle();
  if (!member) return { error: 'You are not a member of this team', status: 403 };
  return { userId: data.user.id };
}

// Pull the latest comments for a team now (the Comments page uses this for its Refresh button).
app.post('/api/v1/comments/sync', async (req, res) => {
  const auth = await authorizeTeam(req, req.body?.teamId);
  if ('error' in auth) return res.status(auth.status).json({ error: auth.error });
  try {
    res.json({ success: true, saved: await syncComments(commentsCtx, { teamId: req.body.teamId }) });
  } catch (err: any) {
    console.error('[Comments] Sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reply to one stored comment on its platform.
app.post('/api/v1/comments/reply', async (req, res) => {
  const { commentId, text } = req.body || {};
  const reply = typeof text === 'string' ? text.trim() : '';
  if (!commentId || !reply) return res.status(400).json({ error: 'commentId and text are required' });
  const { data: comment } = await supabase.from('post_comments').select('*').eq('id', commentId).maybeSingle();
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const auth = await authorizeTeam(req, comment.team_id);
  if ('error' in auth) return res.status(auth.status).json({ error: auth.error });
  try {
    res.json({ success: true, reply: await replyToComment(commentsCtx, comment, reply) });
  } catch (err: any) {
    console.error('[Comments] Reply failed:', err.message);
    res.status(err.status && err.status < 500 ? 400 : 502).json({ error: err.message });
  }
});

// Re-runs classification + (for a "normal" comment) the reply draft for one comment on demand - the Comments
// page's "Regenerate" button. Counts against the team's AI usage the same as the background job does.
app.post('/api/v1/comments/:id/regenerate-suggestion', async (req, res) => {
  const { data: comment } = await supabase.from('post_comments').select('*').eq('id', req.params.id).maybeSingle();
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const auth = await authorizeTeam(req, comment.team_id);
  if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

  try {
    const { data: post } = await supabase.from('posts').select('content').eq('id', comment.post_id).maybeSingle();
    const postCaption = post?.content || undefined;

    const classifyUsage = await checkAndRecordUsage(supabase, comment.team_id, 'classify');
    if (!classifyUsage.allowed) return res.status(429).json({ error: 'This team has reached its AI generation limit for this month.' });
    const category = await classifyComment({ commentText: comment.text, postCaption });

    let updates: Record<string, unknown> = { ai_classified_at: new Date().toISOString() };
    if (category === 'spam') updates = { ...updates, ai_status: 'skipped_spam', ai_suggested_reply: null };
    else if (category === 'negative') updates = { ...updates, ai_status: 'flagged_negative', ai_suggested_reply: null };
    else {
      const replyUsage = await checkAndRecordUsage(supabase, comment.team_id, 'reply');
      if (!replyUsage.allowed) return res.status(429).json({ error: 'This team has reached its AI generation limit for this month.' });
      const suggestion = await generateReply({ commentText: comment.text, authorName: comment.author_name, postCaption });
      updates = { ...updates, ai_status: 'suggested', ai_suggested_reply: suggestion };
    }

    const { data: updated, error } = await supabase.from('post_comments').update(updates).eq('id', comment.id).select().single();
    if (error) throw error;
    res.json({ success: true, comment: updated });
  } catch (err: any) {
    if (err instanceof AiNotConfiguredError) return res.status(503).json({ error: err.message });
    console.error('[AI] Regenerate suggestion failed:', err.message);
    res.status(502).json({ error: 'The AI assistant could not generate a result. Please try again.' });
  }
});

const PORT = process.env.PORT || 3008;
app.listen(PORT, () => {
  console.log(`Analytics API running on port ${PORT}`);
});

let pinterestSandboxLogged = false;
let lastAiCleanupAt = 0;
const AI_CLEANUP_INTERVAL_MS = 24 * 3600 * 1000;

const ANALYTICS_QUEUE_NAME = 'analytics-queue';
const analyticsQueue = new Queue(ANALYTICS_QUEUE_NAME, { connection: redisConnection });

async function setupCron() {
  await analyticsQueue.add('sync-analytics', {}, {
    repeat: { pattern: '*/5 * * * *' }, // Every 5 minutes
    // Without this, every run (288/day) leaves a finished job in Redis forever - prune like the
    // other queues (publish-queue's PUBLISH_JOB_OPTIONS, notifications-queue's NOTIFICATION_JOB_OPTIONS).
    removeOnComplete: { age: 1 * 24 * 3600, count: 500 },
    removeOnFail: { age: 7 * 24 * 3600, count: 100 },
  });
  console.log('Analytics Worker started. Scheduled to sync every 5 minutes.');
}

const worker = new Worker(ANALYTICS_QUEUE_NAME, async (job: Job) => {
  console.log(`[AnalyticsService] Running analytics sync...`);
  
  try {
    // Each numbered step below runs in its own try/catch: previously one outer try/catch wrapped the whole
    // pipeline, so an error in an early step (e.g. step 1's Redis scan) silently skipped every later step for
    // that whole 5-minute cycle - including comment syncing and AI drafting (steps 8-9), which had nothing to do
    // with the failure. Each step now fails independently and the rest of the run still happens.

    // 1. Sync real-time events from Redis
    try {
    let allKeys: string[] = [];
    if (upstashRedis) {
      let cursor = 0;
      do {
        const [nextCursor, keys] = await upstashRedis.scan(cursor, { match: 'analytics:*', count: 100 });
        allKeys.push(...keys);
        cursor = Number(nextCursor);
      } while (cursor !== 0);
    } else {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redisConnection.scan(cursor, 'MATCH', 'analytics:*', 'COUNT', 100);
        allKeys.push(...keys);
        cursor = nextCursor;
      } while (cursor !== '0');
    }

    if (allKeys.length > 0) {
      const aggregated: Record<string, { views: number, likes: number, shares: number }> = {};

      for (const key of allKeys) {
        let valStr: string | null = null;
        if (upstashRedis) {
          const v = await upstashRedis.get(key);
          valStr = v !== null ? String(v) : null;
          if (valStr) await upstashRedis.del(key);
        } else {
          valStr = await redisConnection.getdel(key) as string;
        }

        if (!valStr) continue;
        const val = parseInt(valStr, 10);
        if (isNaN(val)) continue;

        const [, postId, platform, eventType] = key.split(':');
        const aggKey = `${postId}:${platform}`;
        if (!aggregated[aggKey]) {
          aggregated[aggKey] = { views: 0, likes: 0, shares: 0 };
        }

        if (eventType === 'views') aggregated[aggKey].views += val;
        if (eventType === 'likes') aggregated[aggKey].likes += val;
        if (eventType === 'shares') aggregated[aggKey].shares += val;
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
        } else {
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
    } catch (err: any) {
      console.error('[AnalyticsService] Step 1 (Redis event sync) failed:', err.message);
    }

    // 2. Sync YouTube Analytics via API
    try {
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

          if (!account) continue;

          let activeToken = decrypt(account.access_token_encrypted);

          // Test token by fetching basic stats
          let ytRes = await fetch(`https://youtube.googleapis.com/youtube/v3/videos?part=statistics&id=${session.video_id}`, {
            headers: { 'Authorization': `Bearer ${activeToken}` }
          });

          if (ytRes.status === 401) {
            // Attempt refresh
            const refreshRes = await fetch(`${ACCOUNT_SERVICE_URL}/api/v1/auth/youtube/refresh`, {
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
              } else {
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
        } catch (err: any) {
          console.error(`[AnalyticsService] Failed to sync YouTube stats for video ${session.video_id}:`, err.message);
        }
      }
      console.log(`[AnalyticsService] Successfully synced YouTube API stats for ${ytSessions.length} videos.`);
    }
    } catch (err: any) {
      console.error('[AnalyticsService] Step 2 (YouTube stats sync) failed:', err.message);
    }

    // 3. Sync Pinterest Analytics via API
    try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    // Pinterest refuses analytics requests in its sandbox ("This endpoint does not support sandbox requests"),
    // so there is nothing to fetch until the app has Standard access and PINTEREST_API_BASE is the real API.
    const pinterestSandbox = PINTEREST_API_BASE.includes('sandbox');
    if (pinterestSandbox && !pinterestSandboxLogged) {
      pinterestSandboxLogged = true;
      console.log('[AnalyticsService] Skipping Pinterest analytics: the Pinterest sandbox does not support them.');
    }
    const { data: pinterestPins } = pinterestSandbox
      ? { data: null }
      : await supabase.from('pinterest_published_pins')
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

          if (!account) continue;

          const activeToken = decrypt(account.access_token_encrypted);
          
          const endDate = new Date().toISOString().split('T')[0];
          // Start date needs to be at least the creation date, but if it was created today, start and end are the same
          const pinStartDateStr = pin.created_at.split('T')[0];
          
          const pinToken = pinterestToken(activeToken);
          const url = `${PINTEREST_API_BASE}/v5/pins/${pin.pin_id}/analytics?start_date=${pinStartDateStr}&end_date=${endDate}&metric_types=IMPRESSION,OUTBOUND_CLICK,SAVE`;

          const pinRes = await fetch(url, {
            headers: { 'Authorization': `Bearer ${pinToken}` }
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
            } else {
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
          } else {
            console.warn(`[AnalyticsService] Failed to fetch Pinterest stats for pin ${pin.pin_id}:`, await pinRes.text());
          }
        } catch (err: any) {
          console.error(`[AnalyticsService] Failed to sync Pinterest stats for pin ${pin.pin_id}:`, err.message);
        }
      }
      console.log(`[AnalyticsService] Successfully synced Pinterest API stats for ${pinterestPins.length} pins.`);
    }
    } catch (err: any) {
      console.error('[AnalyticsService] Step 3 (Pinterest stats sync) failed:', err.message);
    }

    // 4. Facebook / Instagram / LinkedIn stats for the posts whose platform ids the publisher saved
    try {
      await syncPublishedPostStats(supabase, decrypt);
    } catch (err: any) {
      console.error('[AnalyticsService] Step 4 (Facebook/Instagram/LinkedIn stats sync) failed:', err.message);
    }

    // 5. Threads stats (by saved post id; older posts are matched by their text once and then saved)
    try {
      await syncThreadsStats(supabase, decrypt);
    } catch (err: any) {
      console.error('[AnalyticsService] Step 5 (Threads stats sync) failed:', err.message);
    }

    // 6. Make sure every analytics row carries its team_id so the dashboard can load it
    try {
      await backfillAnalyticsTeamIds(supabase);
    } catch (err: any) {
      console.error('[AnalyticsService] Step 6 (team_id backfill) failed:', err.message);
    }

    // 7. Append the latest numbers to the history that feeds the Analytics page charts
    try {
      await recordAnalyticsHistory(supabase);
    } catch (err: any) {
      console.error('[AnalyticsService] Step 7 (analytics history) failed:', err.message);
    }

    // 8. Comments on published posts (Facebook, Instagram, Threads, YouTube)
    try {
      await syncComments(commentsCtx);
    } catch (err: any) {
      console.error('[AnalyticsService] Step 8 (comment sync) failed:', err.message);
    }

    // 9. AI Assistant: classify new comments and draft replies for the ones worth answering
    try {
      const aiStats = await suggestReplies(commentsCtx);
      if (aiStats.suggested || aiStats.skipped || aiStats.flagged) {
        console.log(`[AI] Comments: ${aiStats.suggested} suggested, ${aiStats.skipped} spam skipped, ${aiStats.flagged} flagged, ${aiStats.autoSent} auto-sent.`);
      }
    } catch (err: any) {
      console.error('[AnalyticsService] Step 9 (AI comment suggestions) failed:', err.message);
    }

    // 10. Delete AI-context images older than 7 days (not time-sensitive, so this only actually runs once a day
    // rather than every 5-minute tick - no point re-listing storage that often for what's usually nothing to do).
    if (Date.now() - lastAiCleanupAt > AI_CLEANUP_INTERVAL_MS) {
      lastAiCleanupAt = Date.now();
      try {
        const deleted = await cleanupOldAiContextUploads(supabase);
        if (deleted > 0) console.log(`[Cleanup] Deleted ${deleted} stale ai-context upload(s).`);
      } catch (err: any) {
        console.error('[AnalyticsService] Step 10 (ai-context cleanup) failed:', err.message);
      }
    }

  } catch (err: any) {
    console.error(`[AnalyticsService] Error:`, err.message);
  }
}, { connection: redisConnection });

setupCron();

worker.on('error', (err) => {
  if ((err as any).code === 'ECONNRESET') return;
  console.error(`[AnalyticsService] Internal error:`, err.message);
});
