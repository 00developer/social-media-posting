import type { SupabaseClient } from '@supabase/supabase-js';
export type UsageKind = 'caption' | 'classify' | 'reply';
/** Current calendar-month usage count for a team (all kinds combined). */
export declare function usageThisMonth(supabase: SupabaseClient, teamId: string): Promise<number>;
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
export declare function checkAndRecordUsage(supabase: SupabaseClient, teamId: string, kind: UsageKind): Promise<{
    allowed: boolean;
    usedThisMonth: number;
}>;
