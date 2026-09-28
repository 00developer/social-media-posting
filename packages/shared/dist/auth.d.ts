import type { SupabaseClient } from '@supabase/supabase-js';
export type AuthedUser = {
    userId: string;
};
export type AuthFailure = {
    error: string;
    status: number;
};
type ReqLike = {
    headers: {
        authorization?: string;
    };
};
/** Verifies the caller's Supabase session (the JWT in the Authorization header) and returns their real user id. */
export declare function requireUser(req: ReqLike, supabase: SupabaseClient): Promise<AuthedUser | AuthFailure>;
/** requireUser, plus checks the verified caller is actually a member of teamId. Returns their real role. */
export declare function requireTeamMember(req: ReqLike, supabase: SupabaseClient, teamId: string | null | undefined): Promise<(AuthedUser & {
    role: string;
}) | AuthFailure>;
export {};
