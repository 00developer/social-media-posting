// Comments on the posts we published: pulled from each platform into `post_comments`, and replies sent back.
//
// Permissions the platforms want (connect the account again after they are added to the app):
//  - Facebook:  pages_read_engagement + pages_read_user_content (read), pages_manage_engagement (reply)
//  - Instagram: instagram_manage_comments
//  - Threads:   threads_read_replies (read), threads_manage_replies (reply)
//  - YouTube:   https://www.googleapis.com/auth/youtube.force-ssl
// Without them the platform refuses the call; that is logged once per run and nothing else breaks.
// LinkedIn and Pinterest give apps like this no comments API, so they are not covered.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getJson, getPages } from './publishedStats';

const GRAPH = 'https://graph.facebook.com/v18.0';
const THREADS = 'https://graph.threads.net/v1.0';
const YOUTUBE = 'https://www.googleapis.com/youtube/v3';
const LOOKBACK_DAYS = 90;
const MAX_POSTS_PER_RUN = 100;

export const COMMENT_PLATFORMS = ['facebook', 'instagram', 'threads', 'youtube'];

export type CommentsContext = {
  supabase: SupabaseClient;
  decrypt: (text: string) => string;
  accountServiceUrl: string;
};

type Fetched = { id: string; parent: string | null; authorName: string; authorId: string | null; text: string; at: string | null; own: boolean };

const clean = (s?: string | null) => (s || '').replace(/^@/, '').trim().toLowerCase();

async function loadAccount(ctx: CommentsContext, userId: string, platform: string, teamId: string | null) {
  let query = ctx.supabase.from('social_accounts').select('*').eq('user_id', userId).eq('platform', platform);
  if (teamId) query = query.eq('team_id', teamId);
  // Reconnecting can leave an older row behind: use the most recently connected account.
  const { data } = await query.order('created_at', { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

// --- YouTube: access token that is refreshed through the account-service when it has expired ---------------------

async function youtubeCall(ctx: CommentsContext, account: any, url: string, init: { method?: string; body?: unknown } = {}) {
  let token = ctx.decrypt(account.access_token_encrypted);
  const send = () => fetch(url, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let res = await send();
  if (res.status === 401) {
    const refresh = await fetch(`${ctx.accountServiceUrl}/api/v1/auth/youtube/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: account.id }),
    });
    const data: any = await refresh.json().catch(() => ({}));
    if (data.success) { token = data.accessToken; res = await send(); }
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const err: any = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// --- Readers: one function per platform, each returns top-level comments and replies flattened ---------------------

async function readFacebook(externalId: string, account: any, token: string): Promise<Fetched[]> {
  const page = (await getPages(token))[0];
  if (!page?.access_token) return [];
  const fields = 'id,message,from{id,name},created_time,comments.limit(25){id,message,from{id,name},created_time}';
  const data = await getJson(`${GRAPH}/${externalId}/comments?fields=${encodeURIComponent(fields)}&filter=toplevel&limit=50&access_token=${page.access_token}`);
  const out: Fetched[] = [];
  const map = (c: any, parent: string | null): Fetched => ({
    id: c.id, parent, authorName: c.from?.name || 'Someone', authorId: c.from?.id ?? null, text: c.message || '',
    at: c.created_time ?? null, own: c.from?.id === page.id,
  });
  for (const c of data.data || []) {
    out.push(map(c, null));
    for (const r of c.comments?.data || []) out.push(map(r, c.id));
  }
  return out;
}

async function readInstagram(externalId: string, account: any, token: string): Promise<Fetched[]> {
  const fields = 'id,text,username,timestamp,replies{id,text,username,timestamp}';
  const data = await getJson(`${GRAPH}/${externalId}/comments?fields=${encodeURIComponent(fields)}&limit=50&access_token=${token}`);
  const me = clean(account.handle);
  const out: Fetched[] = [];
  const map = (c: any, parent: string | null): Fetched => ({
    id: c.id, parent, authorName: c.username || 'Someone', authorId: c.username ?? null, text: c.text || '',
    at: c.timestamp ?? null, own: !!me && clean(c.username) === me,
  });
  for (const c of data.data || []) {
    out.push(map(c, null));
    for (const r of c.replies?.data || []) out.push(map(r, c.id));
  }
  return out;
}

async function readThreads(externalId: string, account: any, token: string): Promise<Fetched[]> {
  const data = await getJson(`${THREADS}/${externalId}/conversation?fields=id,text,username,timestamp,replied_to&reverse=false&access_token=${token}`);
  const me = clean(account.handle);
  return (data.data || []).map((c: any): Fetched => {
    const parent = c.replied_to?.id && c.replied_to.id !== externalId ? c.replied_to.id : null;
    return { id: c.id, parent, authorName: c.username || 'Someone', authorId: c.username ?? null, text: c.text || '', at: c.timestamp ?? null, own: !!me && clean(c.username) === me };
  });
}

async function readYoutube(ctx: CommentsContext, videoId: string, account: any): Promise<Fetched[]> {
  const data = await youtubeCall(ctx, account, `${YOUTUBE}/commentThreads?part=snippet,replies&videoId=${videoId}&maxResults=100&order=time&textFormat=plainText`);
  const out: Fetched[] = [];
  const map = (c: any, parent: string | null): Fetched => ({
    id: c.id, parent, authorName: c.snippet?.authorDisplayName || 'Someone', authorId: c.snippet?.authorChannelId?.value ?? null,
    text: c.snippet?.textDisplay || c.snippet?.textOriginal || '', at: c.snippet?.publishedAt ?? null,
    own: !!account.channel_id && c.snippet?.authorChannelId?.value === account.channel_id,
  });
  for (const t of data.items || []) {
    const top = t.snippet?.topLevelComment;
    if (!top) continue;
    out.push(map(top, null));
    for (const r of t.replies?.comments || []) out.push(map(r, top.id));
  }
  return out;
}

// --- Sync -------------------------------------------------------------------------------------------------------

type PostRef = { post_id: string; platform: string; external_id: string; user_id: string; team_id: string | null };

async function postsToCheck(supabase: SupabaseClient, teamId?: string): Promise<PostRef[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const refs: PostRef[] = [];

  let q = supabase.from('published_posts').select('post_id, platform, external_id, user_id, team_id')
    .in('platform', ['facebook', 'instagram', 'threads']).gte('created_at', since).order('created_at', { ascending: false }).limit(MAX_POSTS_PER_RUN);
  if (teamId) q = q.eq('team_id', teamId);
  const { data, error } = await q;
  if (error) { if (error.code !== 'PGRST205') console.warn('[Comments] Could not read published_posts:', error.message); }
  else refs.push(...(data as PostRef[]));

  // YouTube keeps its video ids in youtube_upload_sessions (no team_id there, so take it from the post).
  const { data: sessions } = await supabase.from('youtube_upload_sessions').select('post_id, video_id, user_id')
    .not('video_id', 'is', null).gte('created_at', since).order('created_at', { ascending: false }).limit(MAX_POSTS_PER_RUN);
  if (sessions?.length) {
    const { data: posts } = await supabase.from('posts').select('id, team_id').in('id', sessions.map((s: any) => s.post_id));
    const teamByPost = new Map((posts || []).map((p: any) => [p.id, p.team_id]));
    for (const s of sessions as any[]) {
      const team = teamByPost.get(s.post_id) ?? null;
      if (teamId && team !== teamId) continue;
      refs.push({ post_id: s.post_id, platform: 'youtube', external_id: s.video_id, user_id: s.user_id, team_id: team });
    }
  }
  return refs;
}

/** Reads the comments of recently published posts and stores them. Returns how many comments were saved. */
export async function syncComments(ctx: CommentsContext, opts: { teamId?: string } = {}): Promise<number> {
  const refs = await postsToCheck(ctx.supabase, opts.teamId);
  const denied = new Set<string>();
  const accounts = new Map<string, any>();
  let saved = 0;

  for (const ref of refs) {
    const key = `${ref.user_id}:${ref.platform}:${ref.team_id ?? ''}`;
    if (denied.has(key)) continue; // this account was refused earlier in this run
    try {
      if (!accounts.has(key)) accounts.set(key, await loadAccount(ctx, ref.user_id, ref.platform, ref.team_id));
      const account = accounts.get(key);
      if (!account) continue;
      const token = ctx.decrypt(account.access_token_encrypted);

      let comments: Fetched[] = [];
      if (ref.platform === 'facebook') comments = await readFacebook(ref.external_id, account, token);
      else if (ref.platform === 'instagram') comments = await readInstagram(ref.external_id, account, token);
      else if (ref.platform === 'threads') comments = await readThreads(ref.external_id, account, token);
      else if (ref.platform === 'youtube') comments = await readYoutube(ctx, ref.external_id, account);
      if (comments.length === 0) continue;

      const rows = comments.map((c) => ({
        team_id: ref.team_id, user_id: ref.user_id, post_id: ref.post_id, account_id: account.id, platform: ref.platform,
        external_post_id: ref.external_id, external_comment_id: c.id, parent_external_id: c.parent,
        author_name: c.authorName, author_id: c.authorId, text: c.text, commented_at: c.at, is_own: c.own,
      }));
      const { error } = await ctx.supabase.from('post_comments').upsert(rows, { onConflict: 'platform,external_comment_id' });
      if (error) {
        // The table appears once the migration has been applied.
        if (error.code !== 'PGRST205') console.warn('[Comments] Could not save comments:', error.message);
        return saved;
      }
      saved += rows.length;
    } catch (err: any) {
      // 400/401/403 from the platform = the permission for comments was not granted (or the account must reconnect)
      if ([400, 401, 403].includes(err.status) || /permission|scope|OAuth/i.test(err.message || '')) {
        denied.add(key);
        console.warn(`[Comments] ${ref.platform} refused reading comments for one account (${err.message}). Add the comment permission and reconnect that account; skipping it this run.`);
      } else {
        console.error(`[Comments] Failed to read ${ref.platform} comments for post ${ref.post_id}:`, err.message);
      }
    }
  }
  return saved;
}

// --- Reply ------------------------------------------------------------------------------------------------------

/** Sends `text` as a reply to the stored comment and stores the reply. Returns the saved reply row. */
export async function replyToComment(ctx: CommentsContext, comment: any, text: string) {
  const account = comment.account_id
    ? (await ctx.supabase.from('social_accounts').select('*').eq('id', comment.account_id).maybeSingle()).data
    : await loadAccount(ctx, comment.user_id, comment.platform, comment.team_id);
  if (!account) throw Object.assign(new Error('The social account for this comment is no longer connected.'), { status: 400 });
  const token = ctx.decrypt(account.access_token_encrypted);

  let replyId: string | undefined;
  let replyParent: string = comment.external_comment_id;
  const form = (params: Record<string, string>) => new URLSearchParams(params);
  const post = async (url: string, params: Record<string, string>) => {
    const res = await fetch(url, { method: 'POST', body: form(params) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw Object.assign(new Error(body?.error?.message || `HTTP ${res.status}`), { status: res.status });
    return body;
  };

  if (comment.platform === 'facebook') {
    const page = (await getPages(token))[0];
    if (!page?.access_token) throw Object.assign(new Error('No Facebook Page is available for this account.'), { status: 400 });
    replyId = (await post(`${GRAPH}/${comment.external_comment_id}/comments`, { message: text, access_token: page.access_token })).id;
  } else if (comment.platform === 'instagram') {
    replyId = (await post(`${GRAPH}/${comment.external_comment_id}/replies`, { message: text, access_token: token })).id;
  } else if (comment.platform === 'threads') {
    const container = await post(`${THREADS}/me/threads`, { media_type: 'TEXT', text, reply_to_id: comment.external_comment_id, access_token: token });
    replyId = (await post(`${THREADS}/me/threads_publish`, { creation_id: container.id, access_token: token })).id;
  } else if (comment.platform === 'youtube') {
    // YouTube replies only nest one level: answer the top-level comment of the thread.
    replyParent = comment.parent_external_id || comment.external_comment_id;
    const body = await youtubeCall(ctx, account, `${YOUTUBE}/comments?part=snippet`, {
      method: 'POST', body: { snippet: { parentId: replyParent, textOriginal: text } },
    });
    replyId = body.id;
  } else {
    throw Object.assign(new Error(`Replying is not supported on ${comment.platform}.`), { status: 400 });
  }
  if (!replyId) throw new Error('The platform did not return an id for the reply.');

  const row = {
    team_id: comment.team_id, user_id: comment.user_id, post_id: comment.post_id, account_id: account.id, platform: comment.platform,
    external_post_id: comment.external_post_id, external_comment_id: replyId, parent_external_id: replyParent,
    author_name: account.channel_title || account.handle || 'You', author_id: account.channel_id || account.provider_account_id || null,
    text, commented_at: new Date().toISOString(), is_own: true,
  };
  const { data, error } = await ctx.supabase.from('post_comments').upsert(row, { onConflict: 'platform,external_comment_id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}
