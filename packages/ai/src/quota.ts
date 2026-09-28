// One shared usage counter for every AI generation (caption, comment classification, comment reply), so cost stays
// predictable. The owner has not picked a per-team plan limit yet, so there is no product-level cap here - only a
// fixed safety ceiling (AI_SAFETY_CEILING, default 500/month/team) to stop a bug (e.g. a retry loop) from running
// up an unbounded bill. Raise or replace this once real plan limits are decided; nothing else needs to change.
import type { SupabaseClient } from '@supabase/supabase-js';

export type UsageKind = 'caption' | 'classify' | 'reply';

const SAFETY_CEILING = Number(process.env.AI_SAFETY_CEILING) || 500;

function monthStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Current calendar-month usage count for a team (all kinds combined). */
export async function usageThisMonth(supabase: SupabaseClient, teamId: string): Promise<number> {
  const { count } = await supabase.from('ai_usage').select('*', { count: 'exact', head: true }).eq('team_id', teamId).gte('created_at', monthStart());
  return count ?? 0;
}

/**
 * Checks the team is under the safety ceiling and, if so, records one generation. Call this right BEFORE making the
 * Gemini API call (not after), so a crash never leaves usage under-counted while still spending money.
 * Returns { allowed: false } instead of throwing, so callers can show a friendly "quota reached" message.
 *
 * The check-and-insert happens atomically inside the `try_record_ai_usage` Postgres function (an advisory
 * transaction lock serializes concurrent callers for the same team), not as two separate round trips here -
 * otherwise two requests arriving close together could both read "under the ceiling" and both insert, together
 * going over it.
 */
export async function checkAndRecordUsage(supabase: SupabaseClient, teamId: string, kind: UsageKind): Promise<{ allowed: boolean; usedThisMonth: number }> {
  const { data: allowed, error } = await supabase.rpc('try_record_ai_usage', { p_team_id: teamId, p_kind: kind, p_ceiling: SAFETY_CEILING });
  if (error) throw new Error(error.message);
  const used = await usageThisMonth(supabase, teamId);
  return { allowed: !!allowed, usedThisMonth: used };
}
