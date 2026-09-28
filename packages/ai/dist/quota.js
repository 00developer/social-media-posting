"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageThisMonth = usageThisMonth;
exports.checkAndRecordUsage = checkAndRecordUsage;
const SAFETY_CEILING = Number(process.env.AI_SAFETY_CEILING) || 500;
function monthStart() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
/** Current calendar-month usage count for a team (all kinds combined). */
async function usageThisMonth(supabase, teamId) {
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
async function checkAndRecordUsage(supabase, teamId, kind) {
    const { data: allowed, error } = await supabase.rpc('try_record_ai_usage', { p_team_id: teamId, p_kind: kind, p_ceiling: SAFETY_CEILING });
    if (error)
        throw new Error(error.message);
    const used = await usageThisMonth(supabase, teamId);
    return { allowed: !!allowed, usedThisMonth: used };
}
