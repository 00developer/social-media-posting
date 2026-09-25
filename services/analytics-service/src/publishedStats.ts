// Stats for posts published to Facebook, Instagram and LinkedIn.
// The publishing-service saves the platform-side id of each of these posts in `published_posts`;
// this module looks those ids up and stores the counts in `analytics`.
//
// What is available depends on the permissions the app has been granted:
//  - Facebook:  reactions / comments / shares (pages_read_engagement). Impressions need `read_insights`.
//  - Instagram: likes / comments (instagram_basic). Reach / views need `instagram_manage_insights`.
//  - LinkedIn:  needs `r_member_postAnalytics` (Community Management API, restricted). Without it the calls are
//               denied and skipped quietly; nothing else breaks.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Stats = { views: number; likes: number; shares: number; comments: number };

const GRAPH = 'https://graph.facebook.com/v18.0';
const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION || '202606';
const LOOKBACK_DAYS = 90;
const MAX_POSTS_PER_RUN = 200;

export async function getJson(url: string, headers?: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const err: any = new Error(body?.error?.message || body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// The Page the publisher posts to (its first Page), with that Page's own access token.
// /me/accounts is empty for accounts whose Pages sit in a Business portfolio, but the Page ids are still
// in debug_token's granular_scopes (same fallback as the publishing-service).
export async function getPages(userToken: string): Promise<any[]> {
  const direct = (await getJson(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${userToken}`)).data || [];
  if (direct.length > 0) return direct;

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return [];
  const debug = await getJson(`${GRAPH}/debug_token?input_token=${userToken}&access_token=${appId}|${appSecret}`);
  const ids = new Set<string>();
  for (const scope of debug.data?.granular_scopes || []) (scope.target_ids || []).forEach((id: string) => ids.add(id));

  const pages: any[] = [];
  for (const id of ids) {
    try {
      const page = await getJson(`${GRAPH}/${id}?fields=id,name,access_token&access_token=${userToken}`);
      if (page.access_token) pages.push(page); // ids without a page token (e.g. the Instagram account id) are not Pages
    } catch { /* not a Page we can read */ }
  }
  return pages;
}

export async function fetchFacebookStats(kind: string, externalId: string, pageToken: string): Promise<Stats> {
  if (kind === 'video' || kind === 'reel') {
    // Reels are stored by video id. `views` is a legacy field and may be refused, so ask for it separately.
    const base = 'likes.summary(true).limit(0),comments.summary(true).limit(0)';
    let data: any;
    let views = 0;
    try {
      data = await getJson(`${GRAPH}/${externalId}?fields=${base},views&access_token=${pageToken}`);
      views = Number(data.views) || 0;
    } catch {
      data = await getJson(`${GRAPH}/${externalId}?fields=${base}&access_token=${pageToken}`);
    }
    return { views, likes: data.likes?.summary?.total_count || 0, shares: 0, comments: data.comments?.summary?.total_count || 0 };
  }
  const data = await getJson(`${GRAPH}/${externalId}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=${pageToken}`);
  return {
    views: 0, // impressions need read_insights
    likes: data.reactions?.summary?.total_count || 0,
    shares: data.shares?.count || 0,
    comments: data.comments?.summary?.total_count || 0,
  };
}

// Views need the instagram_manage_insights permission; without it (or for media types that do not report it) they stay 0.
async function fetchInstagramViews(mediaId: string, userToken: string): Promise<number> {
  for (const metric of ['views', 'impressions']) {
    try {
      const data = await getJson(`${GRAPH}/${mediaId}/insights?metric=${metric}&access_token=${userToken}`);
      const value = data.data?.[0]?.values?.[0]?.value;
      if (typeof value === 'number') return value;
    } catch { /* try the next metric */ }
  }
  return 0;
}

export async function fetchInstagramStats(mediaId: string, userToken: string): Promise<Stats> {
  const data = await getJson(`${GRAPH}/${mediaId}?fields=like_count,comments_count&access_token=${userToken}`);
  const views = await fetchInstagramViews(mediaId, userToken);
  return { views, likes: data.like_count || 0, shares: 0, comments: data.comments_count || 0 };
}

/** Returns null when LinkedIn denies analytics access (the app lacks r_member_postAnalytics). */
export async function fetchLinkedInStats(urn: string, token: string): Promise<Stats | null> {
  const entity = urn.startsWith('urn:li:ugcPost:') ? `(ugc:${encodeURIComponent(urn)})` : `(share:${encodeURIComponent(urn)})`;
  const headers = { Authorization: `Bearer ${token}`, 'Linkedin-Version': LINKEDIN_API_VERSION, 'X-Restli-Protocol-Version': '2.0.0' };
  const count = async (queryType: string) => {
    const body = await getJson(`https://api.linkedin.com/rest/memberCreatorPostAnalytics?q=entity&entity=${entity}&queryType=${queryType}&aggregation=TOTAL`, headers);
    return Number(body.elements?.[0]?.count) || 0;
  };
  try {
    const [views, likes, shares, comments] = await Promise.all([count('IMPRESSION'), count('REACTION'), count('RESHARE'), count('COMMENT')]);
    return { views, likes, shares, comments };
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) return null;
    throw err;
  }
}

async function saveStats(supabase: SupabaseClient, row: any, stats: Stats) {
  const values = { ...stats, recorded_at: new Date().toISOString(), team_id: row.team_id ?? null };
  const { data: existing } = await supabase.from('analytics').select('id').eq('post_id', row.post_id).eq('platform', row.platform).maybeSingle();
  const { error } = existing
    ? await supabase.from('analytics').update(values).eq('id', existing.id)
    : await supabase.from('analytics').insert({ post_id: row.post_id, user_id: row.user_id, platform: row.platform, ...values });
  if (error) throw new Error(error.message);
}

let linkedInDeniedLogged = false;

export async function syncPublishedPostStats(supabase: SupabaseClient, decrypt: (text: string) => string) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: rows, error } = await supabase.from('published_posts')
    .select('*')
    .in('platform', ['facebook', 'instagram', 'linkedin'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_POSTS_PER_RUN);
  if (error) {
    // The table appears once the migration has been applied.
    if (error.code !== 'PGRST205') console.warn('[AnalyticsService] Could not read published_posts:', error.message);
    return;
  }
  if (!rows || rows.length === 0) return;

  const accountCache = new Map<string, any>();
  const pageTokenCache = new Map<string, string | null>();
  let linkedInDenied = false;
  let synced = 0;

  for (const row of rows) {
    try {
      const key = `${row.user_id}:${row.platform}:${row.team_id ?? ''}`;
      if (!accountCache.has(key)) {
        let query = supabase.from('social_accounts').select('*').eq('user_id', row.user_id).eq('platform', row.platform);
        if (row.team_id) query = query.eq('team_id', row.team_id);
        const { data } = await query.limit(1);
        accountCache.set(key, data?.[0] ?? null);
      }
      const account = accountCache.get(key);
      if (!account) continue;
      const token = decrypt(account.access_token_encrypted);

      let stats: Stats | null = null;
      if (row.platform === 'facebook') {
        if (!pageTokenCache.has(account.id)) pageTokenCache.set(account.id, (await getPages(token))[0]?.access_token ?? null);
        const pageToken = pageTokenCache.get(account.id);
        if (!pageToken) continue;
        stats = await fetchFacebookStats(row.external_kind, row.external_id, pageToken);
      } else if (row.platform === 'instagram') {
        stats = await fetchInstagramStats(row.external_id, token);
      } else if (row.platform === 'linkedin') {
        if (linkedInDenied) continue;
        stats = await fetchLinkedInStats(row.external_id, token);
        if (!stats) {
          linkedInDenied = true;
          if (!linkedInDeniedLogged) {
            linkedInDeniedLogged = true;
            console.warn('[AnalyticsService] LinkedIn denied post analytics (the app needs r_member_postAnalytics); skipping LinkedIn stats.');
          }
          continue;
        }
      }

      if (stats) { await saveStats(supabase, row, stats); synced++; }
    } catch (err: any) {
      console.error(`[AnalyticsService] Failed to sync ${row.platform} stats for post ${row.post_id}:`, err.message);
    }
  }
  if (synced > 0) console.log(`[AnalyticsService] Synced Facebook/Instagram/LinkedIn stats for ${synced} posts.`);
}

// Older rows (and the YouTube / Pinterest / Threads syncs) were saved without team_id, but the dashboard loads
// analytics by team_id, so they never showed up. Fill it in from the post.
export async function backfillAnalyticsTeamIds(supabase: SupabaseClient) {
  const { data: rows } = await supabase.from('analytics').select('id, post_id').is('team_id', null).limit(200);
  if (!rows || rows.length === 0) return;

  const postIds = [...new Set(rows.map((r: any) => r.post_id).filter(Boolean))];
  const { data: posts } = await supabase.from('posts').select('id, team_id').in('id', postIds);
  const teamByPost = new Map((posts || []).map((p: any) => [p.id, p.team_id]));

  const idsByTeam = new Map<string, string[]>();
  for (const r of rows) {
    const team = teamByPost.get(r.post_id);
    if (!team) continue;
    idsByTeam.set(team, [...(idsByTeam.get(team) || []), r.id]);
  }
  for (const [team, ids] of idsByTeam) await supabase.from('analytics').update({ team_id: team }).in('id', ids);
}

// Appends today's numbers to `analytics_history` (the data behind the Analytics page charts).
// A row is added when a post's numbers changed since its last history row, or when its last row is older than
// HISTORY_HEARTBEAT_MS, so a quiet post still gets a point on the chart now and then.
const HISTORY_HEARTBEAT_MS = 6 * 3600 * 1000;

export async function recordAnalyticsHistory(supabase: SupabaseClient) {
  const { data: rows, error } = await supabase.from('analytics')
    .select('post_id, platform, views, likes, shares, comments, team_id, user_id')
    .not('team_id', 'is', null)
    .limit(500);
  if (error || !rows || rows.length === 0) return;

  const postIds = [...new Set(rows.map((r: any) => r.post_id))];
  const { data: recent, error: histError } = await supabase.from('analytics_history')
    .select('post_id, platform, views, likes, shares, comments, recorded_at')
    .in('post_id', postIds)
    .order('recorded_at', { ascending: false })
    .limit(2000);
  if (histError) {
    // The table appears once the migration has been applied.
    if (histError.code !== 'PGRST205') console.warn('[AnalyticsService] Could not read analytics_history:', histError.message);
    return;
  }

  const latest = new Map<string, any>();
  for (const h of recent || []) {
    const key = `${h.post_id}:${h.platform}`;
    if (!latest.has(key)) latest.set(key, h); // rows are newest first
  }

  const now = Date.now();
  const toInsert = rows.filter((r: any) => {
    const last = latest.get(`${r.post_id}:${r.platform}`);
    if (!last) return true;
    const changed = last.views !== r.views || last.likes !== r.likes || last.shares !== r.shares || (last.comments ?? 0) !== (r.comments ?? 0);
    return changed || now - new Date(last.recorded_at).getTime() > HISTORY_HEARTBEAT_MS;
  }).map((r: any) => ({
    post_id: r.post_id, platform: r.platform, views: r.views ?? 0, likes: r.likes ?? 0, shares: r.shares ?? 0,
    comments: r.comments ?? 0, team_id: r.team_id, user_id: r.user_id,
  }));

  if (toInsert.length === 0) return;
  const { error: insertError } = await supabase.from('analytics_history').insert(toInsert);
  if (insertError) console.warn('[AnalyticsService] Could not save analytics history:', insertError.message);
  else console.log(`[AnalyticsService] Saved ${toInsert.length} analytics history points.`);
}

// ---------------------------------------------------------------------------------------------------------
// Threads. Needs the `threads_manage_insights` permission (the Threads app must grant it, and the account must
// have been connected after it was added).

/** Views / likes / replies (as comments) / reposts + quotes (as shares) for one Threads post. */
export async function fetchThreadsStats(threadId: string, token: string): Promise<Stats> {
  const body = await getJson(`https://graph.threads.net/v1.0/${threadId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${token}`);
  const value = (name: string) => {
    const m = (body.data || []).find((x: any) => x.name === name);
    return Number(m?.values?.[0]?.value ?? m?.total_value?.value) || 0;
  };
  return { views: value('views'), likes: value('likes'), comments: value('replies'), shares: value('reposts') + value('quotes') };
}

// Threads rewrites the caption it stores (its first #hashtag becomes a topic tag and loses the "#"), so compare
// captions with the "#"s removed and whitespace / case ignored.
export function normalizeThreadsText(text: string): string {
  return text.replace(/#/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function syncThreadsStats(supabase: SupabaseClient, decrypt: (text: string) => string) {
  const { data: accounts } = await supabase.from('social_accounts').select('*').eq('platform', 'threads');
  if (!accounts || accounts.length === 0) return;
  let synced = 0;

  for (const account of accounts) {
    try {
      const token = decrypt(account.access_token_encrypted);

      // Posts we published to Threads whose Threads id we already know
      const { data: known } = await supabase.from('published_posts').select('post_id, external_id')
        .eq('platform', 'threads').eq('user_id', account.user_id);
      const idByPost = new Map<string, string>((known || []).map((k: any) => [k.post_id, k.external_id]));

      // Older posts have no saved id: find them once by their text, then save the id so this never repeats.
      const { data: jobs } = await supabase.from('publish_jobs').select('post_id')
        .eq('platform', 'threads').eq('status', 'completed').eq('user_id', account.user_id).limit(200);
      const unmatchedIds = [...new Set((jobs || []).map((j: any) => j.post_id))].filter((id) => !idByPost.has(id));
      if (unmatchedIds.length > 0) {
        const { data: posts } = await supabase.from('posts').select('id, content, team_id, user_id').in('id', unmatchedIds);
        const list = await getJson(`https://graph.threads.net/v1.0/me/threads?fields=id,text&limit=50&access_token=${token}`);
        const taken = new Set(idByPost.values());
        for (const post of posts || []) {
          const wanted = normalizeThreadsText(post.content || '');
          if (!wanted) continue;
          const match = (list.data || []).find((t: any) => t.text && !taken.has(t.id) && normalizeThreadsText(t.text) === wanted);
          if (!match) continue;
          taken.add(match.id);
          idByPost.set(post.id, match.id);
          await supabase.from('published_posts').upsert(
            { post_id: post.id, platform: 'threads', external_id: match.id, external_kind: 'post', user_id: post.user_id, team_id: post.team_id ?? null },
            { onConflict: 'post_id,platform' }
          );
        }
      }
      if (idByPost.size === 0) continue;

      const { data: posts } = await supabase.from('posts').select('id, team_id, user_id').in('id', [...idByPost.keys()]);
      for (const post of posts || []) {
        const stats = await fetchThreadsStats(idByPost.get(post.id)!, token);
        await saveStats(supabase, { post_id: post.id, platform: 'threads', user_id: post.user_id, team_id: post.team_id }, stats);
        synced++;
      }
    } catch (err: any) {
      console.error(`[AnalyticsService] Failed to sync Threads stats for user ${account.user_id}:`, err.message);
    }
  }
  if (synced > 0) console.log(`[AnalyticsService] Synced Threads stats for ${synced} posts.`);
}
