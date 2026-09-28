"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireUser = requireUser;
exports.requireTeamMember = requireTeamMember;
/** Verifies the caller's Supabase session (the JWT in the Authorization header) and returns their real user id. */
async function requireUser(req, supabase) {
    const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
    if (!token)
        return { error: 'Missing Authorization header', status: 401 };
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user)
        return { error: 'Invalid or expired session', status: 401 };
    return { userId: data.user.id };
}
/** requireUser, plus checks the verified caller is actually a member of teamId. Returns their real role. */
async function requireTeamMember(req, supabase, teamId) {
    const auth = await requireUser(req, supabase);
    if ('error' in auth)
        return auth;
    if (!teamId)
        return { error: 'Missing team', status: 400 };
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', auth.userId).maybeSingle();
    if (!member)
        return { error: 'You are not a member of this team', status: 403 };
    return { userId: auth.userId, role: member.role };
}
