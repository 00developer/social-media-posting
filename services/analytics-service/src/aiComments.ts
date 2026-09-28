// Classifies newly-synced reader comments and, for the ones worth a reply, drafts one - so the Comments inbox can
// show a ready-to-review suggestion instead of a blank reply box. See the shared package packages/ai for the
// actual model calls; this module is just the "what to do with each comment" policy:
//   spam     -> ai_status = 'skipped_spam', no reply drafted, hidden from the inbox by default
//   negative -> ai_status = 'flagged_negative', no reply drafted (a human should handle it, not an AI guess)
//   normal   -> ai_status = 'suggested', ai_suggested_reply filled in; auto-sent only if the team opted in
// Never touches comments we wrote ourselves (is_own), or ones already classified (ai_status is not null).
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyComment, generateReply, checkAndRecordUsage, AiNotConfiguredError } from '@socialpush/ai';
import { replyToComment, type CommentsContext } from './comments';

const BATCH_SIZE = 30;

let notConfiguredLogged = false;
let quotaLoggedForTeam = new Set<string>();

export async function suggestReplies(ctx: CommentsContext): Promise<{ suggested: number; skipped: number; flagged: number; autoSent: number }> {
  const stats = { suggested: 0, skipped: 0, flagged: 0, autoSent: 0 };

  await sendPendingAutoReplies(ctx, stats);

  const { data: rows, error } = await ctx.supabase.from('post_comments')
    .select('*')
    .is('ai_status', null)
    .eq('is_own', false)
    .order('commented_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) { if (error.code !== 'PGRST205' && error.code !== '42703') console.warn('[AI] Could not read post_comments:', error.message); return stats; }
  if (!rows || rows.length === 0) return stats;

  const captionCache = new Map<string, string | undefined>();
  const autoReplyCache = new Map<string, boolean>();

  for (const comment of rows) {
    try {
      const teamId = comment.team_id as string | null;
      if (!teamId) continue; // classification is billed per team; a comment without one can't be charged anywhere

      if (!captionCache.has(comment.post_id)) {
        const { data: post } = await ctx.supabase.from('posts').select('content').eq('id', comment.post_id).maybeSingle();
        captionCache.set(comment.post_id, post?.content || undefined);
      }
      const postCaption = captionCache.get(comment.post_id);

      const classifyUsage = await checkAndRecordUsage(ctx.supabase, teamId, 'classify');
      if (!classifyUsage.allowed) {
        if (!quotaLoggedForTeam.has(teamId)) { quotaLoggedForTeam.add(teamId); console.warn(`[AI] Team ${teamId} hit its AI generation limit; leaving remaining comments unclassified until next month.`); }
        continue; // leave ai_status null - picked up again once the team is under the limit
      }

      const category = await classifyComment({ commentText: comment.text, postCaption });

      if (category === 'spam') {
        await ctx.supabase.from('post_comments').update({ ai_status: 'skipped_spam', ai_classified_at: new Date().toISOString() }).eq('id', comment.id);
        stats.skipped++;
        continue;
      }
      if (category === 'negative') {
        await ctx.supabase.from('post_comments').update({ ai_status: 'flagged_negative', ai_classified_at: new Date().toISOString() }).eq('id', comment.id);
        stats.flagged++;
        continue;
      }

      const replyUsage = await checkAndRecordUsage(ctx.supabase, teamId, 'reply');
      if (!replyUsage.allowed) {
        if (!quotaLoggedForTeam.has(teamId)) { quotaLoggedForTeam.add(teamId); console.warn(`[AI] Team ${teamId} hit its AI generation limit; leaving remaining comments unclassified until next month.`); }
        continue;
      }
      const suggestion = await generateReply({ commentText: comment.text, authorName: comment.author_name, postCaption });
      await ctx.supabase.from('post_comments').update({ ai_status: 'suggested', ai_suggested_reply: suggestion, ai_classified_at: new Date().toISOString() }).eq('id', comment.id);
      stats.suggested++;

      if (!autoReplyCache.has(teamId)) {
        const { data: team } = await ctx.supabase.from('teams').select('ai_auto_reply_enabled').eq('id', teamId).maybeSingle();
        autoReplyCache.set(teamId, !!team?.ai_auto_reply_enabled);
      }
      if (autoReplyCache.get(teamId)) {
        await replyToComment(ctx, comment, suggestion);
        stats.autoSent++;
      }
    } catch (err: any) {
      if (err instanceof AiNotConfiguredError) {
        if (!notConfiguredLogged) { notConfiguredLogged = true; console.warn('[AI] GEMINI_API_KEY is not set; comment suggestions are paused until it is.'); }
        return stats; // no point trying the rest of the batch this run
      }
      console.error(`[AI] Failed to classify/suggest for comment ${comment.id}:`, err.message);
    }
  }
  return stats;
}

// Catch-up pass: a comment can end up with ai_status='suggested' but never sent - either it was drafted before the
// team turned Auto-send on, or the send itself failed on a previous run. Re-checks those against teams that have
// auto-send on now, and sends the ones that don't already have a reply on the platform. Comments whose reply did
// go out are found via the actual reply row (is_own=true, parent pointing back at this comment) rather than any
// flag on the comment itself, since replyToComment() never touches the original comment's ai_status.
async function sendPendingAutoReplies(ctx: CommentsContext, stats: { autoSent: number }): Promise<void> {
  const { data: enabledTeams } = await ctx.supabase.from('teams').select('id').eq('ai_auto_reply_enabled', true);
  if (!enabledTeams || enabledTeams.length === 0) return;

  const { data: pending, error } = await ctx.supabase.from('post_comments')
    .select('*')
    .eq('ai_status', 'suggested')
    .eq('is_own', false)
    .not('ai_suggested_reply', 'is', null)
    .in('team_id', enabledTeams.map((t: any) => t.id))
    .order('commented_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error || !pending || pending.length === 0) return;

  for (const comment of pending) {
    try {
      const { data: existingReply } = await ctx.supabase.from('post_comments')
        .select('id').eq('platform', comment.platform).eq('parent_external_id', comment.external_comment_id).eq('is_own', true).limit(1).maybeSingle();
      if (existingReply) continue; // already answered (e.g. manually) - nothing to catch up

      await replyToComment(ctx, comment, comment.ai_suggested_reply);
      stats.autoSent++;
    } catch (err: any) {
      console.error(`[AI] Failed to auto-send pending reply for comment ${comment.id}:`, err.message);
    }
  }
}
