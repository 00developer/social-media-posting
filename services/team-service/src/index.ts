import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { getCachedTeamRole, setCachedTeamRole, requireUser } from '@socialpush/shared';

const INVITE_ROLES = ['admin', 'editor', 'viewer'];
const BILLING_PLANS = ['free', 'pro'];

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

app.get('/api/v1/teams', async (req, res) => {
  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });

  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id, name, plan)')
    .eq('user_id', authed.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, teams: data.map((d: any) => ({ ...d.teams, role: d.role })) });
});

app.post('/api/v1/teams/:teamId/invite', async (req, res) => {
  const { teamId } = req.params;
  const { email, role } = req.body;

  // The inviter's identity comes from their verified session, never a client-supplied inviterId - otherwise
  // anyone who learns an admin's userId + a teamId could invite themselves onto that team.
  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });
  const inviterId = authed.userId;

  if (!INVITE_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role - must be one of: ${INVITE_ROLES.join(', ')}` });
  }

  let inviterRole = await getCachedTeamRole(teamId, inviterId);
  if (!inviterRole) {
    const { data: inviter } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', inviterId).single();
    if (inviter) {
      inviterRole = inviter.role as string;
      await setCachedTeamRole(teamId, inviterId, inviterRole);
    }
  }

  if (!inviterRole || !['owner', 'admin'].includes(inviterRole)) {
    return res.status(403).json({ error: 'Only admins can invite' });
  }
  // An admin can invite editors/viewers, but only the owner can hand out the admin role - otherwise any admin
  // could invite a collaborator (or an alt account of their own) straight in as another admin.
  if (role === 'admin' && inviterRole !== 'owner') {
    return res.status(403).json({ error: 'Only the team owner can invite another admin' });
  }

  const { data: { users }, error: fetchErr } = await supabase.auth.admin.listUsers();
  const targetUser = users.find((u: any) => u.email === email);

  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const { error } = await supabase.from('team_members').insert({
    team_id: teamId,
    user_id: targetUser.id,
    role
  });

  if (error) return res.status(500).json({ error: error.message });

  // Invalidate/set cache for the new user immediately
  await setCachedTeamRole(teamId, targetUser.id, role);

  res.json({ success: true, message: 'Invited successfully' });
});

app.post('/api/v1/teams/:teamId/billing', async (req, res) => {
  const { teamId } = req.params;
  const { plan } = req.body;

  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });
  const requesterId = authed.userId;

  if (!BILLING_PLANS.includes(plan)) {
    return res.status(400).json({ error: `Invalid plan - must be one of: ${BILLING_PLANS.join(', ')}` });
  }

  let requesterRole = await getCachedTeamRole(teamId, requesterId);
  if (!requesterRole) {
    const { data: requester } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', requesterId).single();
    if (requester) {
      requesterRole = requester.role as string;
      await setCachedTeamRole(teamId, requesterId, requesterRole);
    }
  }

  if (!requesterRole || requesterRole !== 'owner') return res.status(403).json({ error: 'Only owners can manage billing' });

  const { error } = await supabase.from('teams').update({ plan }).eq('id', teamId);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

// Team name + AI auto-reply toggle. Owner-only, same pattern as billing above. This goes through the backend
// (service role) rather than a direct client-side Supabase update: the `teams` UPDATE RLS policy checks
// team_members via a nested EXISTS, and on the live project that combination was silently returning 0 rows for a
// real, correctly-owner-matching request (PostgREST then reports "Cannot coerce the result to a single JSON
// object" once the caller asks for the row back) - rather than chase that further, settings changes now go
// through the same trusted, already-working path as Invite and Billing.
app.patch('/api/v1/teams/:teamId/settings', async (req, res) => {
  const { teamId } = req.params;
  const { name, aiAutoReplyEnabled } = req.body ?? {};

  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });
  const requesterId = authed.userId;

  let requesterRole = await getCachedTeamRole(teamId, requesterId);
  if (!requesterRole) {
    const { data: requester } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', requesterId).single();
    if (requester) {
      requesterRole = requester.role as string;
      await setCachedTeamRole(teamId, requesterId, requesterRole);
    }
  }
  if (!requesterRole || requesterRole !== 'owner') return res.status(403).json({ error: 'Only the team owner can change these settings' });

  const updates: Record<string, unknown> = {};
  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (!trimmed) return res.status(400).json({ error: 'Team name cannot be empty' });
    updates.name = trimmed;
  }
  if (typeof aiAutoReplyEnabled === 'boolean') updates.ai_auto_reply_enabled = aiAutoReplyEnabled;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const { data, error } = await supabase.from('teams').update(updates).eq('id', teamId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, team: data });
});

// Marks notifications as read. Not a direct client-side Supabase `.update()`: like the teams settings endpoint
// above, notifications has no working UPDATE RLS policy for this (the browser's `.update({read:true})` in
// DashboardProvider.tsx silently affects 0 rows), so the read/unread flag never actually persists. Same trusted
// backend path as the rest of this service; scoped to the verified caller's own notifications only.
app.patch('/api/v1/notifications/read', async (req, res) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
    return res.status(400).json({ error: 'ids must be a non-empty array of strings' });
  }

  const authed = await requireUser(req, supabase);
  if ('error' in authed) return res.status(authed.status).json({ error: authed.error });

  const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids).eq('user_id', authed.userId);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`Team Service running on port ${PORT}`);
});
