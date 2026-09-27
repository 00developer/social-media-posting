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
 * Anthropic API call (not after), so a crash never leaves usage under-counted while still spending money.
 * Returns { allowed: false } instead of throwing, so callers can show a friendly "quota reached" message.
 */
async function checkAndRecordUsage(supabase, teamId, kind) {
    const used = await usageThisMonth(supabase, teamId);
    if (used >= SAFETY_CEILING)
        return { allowed: false, usedThisMonth: used };
    await supabase.from('ai_usage').insert({ team_id: teamId, kind });
    return { allowed: true, usedThisMonth: used + 1 };
}
