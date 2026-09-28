import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * `Authorization` header carrying the current session's JWT, for calls to backend services that verify the
 * caller's identity server-side (see `requireUser`/`requireTeamMember` in packages/shared) instead of trusting a
 * plain userId in the request. Empty token if there's no session - the backend will reject it with 401.
 */
export async function authHeader(): Promise<{ Authorization: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token ?? ''}` };
}
