// Verifies who is actually calling a backend endpoint, instead of trusting a userId/teamId the client simply
// typed into a query string or request body. Every endpoint that acts on behalf of a user (connecting an
// account, inviting a member, changing billing/settings) must call one of these first - a raw req.query.userId
// is a claim, not proof, and taking it at face value lets anyone act as anyone else just by knowing their id.
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuthedUser = { userId: string };
export type AuthFailure = { error: string; status: number };

type ReqLike = { headers: { authorization?: string } };

/** Verifies the caller's Supabase session (the JWT in the Authorization header) and returns their real user id. */
export async function requireUser(req: ReqLike, supabase: SupabaseClient): Promise<AuthedUser | AuthFailure> {
  const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: 'Invalid or expired session', status: 401 };
  return { userId: data.user.id };
}

/** requireUser, plus checks the verified caller is actually a member of teamId. Returns their real role. */
export async function requireTeamMember(req: ReqLike, supabase: SupabaseClient, teamId: string | null | undefined): Promise<(AuthedUser & { role: string }) | AuthFailure> {
  const auth = await requireUser(req, supabase);
  if ('error' in auth) return auth;
  if (!teamId) return { error: 'Missing team', status: 400 };
  const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', auth.userId).maybeSingle();
  if (!member) return { error: 'You are not a member of this team', status: 403 };
  return { userId: auth.userId, role: member.role as string };
}
