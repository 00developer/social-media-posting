import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { getCachedTeamRole, setCachedTeamRole } from '@socialpush/shared';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

app.get('/api/v1/teams', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id, name, plan)')
    .eq('user_id', userId);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, teams: data.map((d: any) => ({ ...d.teams, role: d.role })) });
});

app.post('/api/v1/teams/:teamId/invite', async (req, res) => {
  const { teamId } = req.params;
  const { email, role, inviterId } = req.body;
  
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
  const { plan, requesterId } = req.body;
  
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
  const { name, aiAutoReplyEnabled, requesterId } = req.body ?? {};
  if (!requesterId) return res.status(400).json({ error: 'requesterId is required' });

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

const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`Team Service running on port ${PORT}`);
});
