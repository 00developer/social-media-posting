'use client';

import { useState } from 'react';
import { useDashboard, type Team } from '@/components/DashboardProvider';
import { TEAM_SERVICE_URL } from '@/lib/apiUrls';
import { authHeader } from '@/lib/supabase';

async function updateTeamSettings(teamId: string, updates: { name?: string; aiAutoReplyEnabled?: boolean }) {
  const res = await fetch(`${TEAM_SERVICE_URL}/api/v1/teams/${teamId}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not save this setting.');
}

// Keyed by activeTeam.id from the parent (see render below) so switching teams remounts this
// with a fresh default instead of needing an effect to resync local state from a prop.
function TeamNameEditor({ team, userId, fetchUserTeams }: { team: Team; userId: string; fetchUserTeams: (userId: string) => Promise<void> }) {
  const [teamNameInput, setTeamNameInput] = useState(team.name || '');
  const [savingName, setSavingName] = useState(false);

  const handleRenameTeam = async () => {
    const newName = teamNameInput.trim();
    if (!newName || newName === team.name) return;
    setSavingName(true);
    try {
      // Goes through team-service (service role), not a direct client-side Supabase update: the `teams` UPDATE
      // RLS policy was silently matching 0 rows for a real, correctly-owner-matching browser session (PostgREST
      // then reports "Cannot coerce the result to a single JSON object" once the row is asked for back). Routing
      // through the backend - the same path Invite and Billing already use - sidesteps that entirely.
      await updateTeamSettings(team.id, { name: newName });
      await fetchUserTeams(userId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error renaming team');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={teamNameInput}
        onChange={e => setTeamNameInput(e.target.value)}
        className="border p-2 text-sm rounded flex-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
      />
      <button
        onClick={handleRenameTeam}
        disabled={savingName || !teamNameInput.trim() || teamNameInput.trim() === team.name}
        className="bg-indigo-600 text-white px-4 py-2 text-sm rounded font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
      >
        {savingName ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { user, activeTeam, fetchUserTeams } = useDashboard();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [savingAutoReply, setSavingAutoReply] = useState(false);

  const handleToggleAutoReply = async (enabled: boolean) => {
    if (!activeTeam || !user) return;
    setSavingAutoReply(true);
    try {
      // See the same note in handleRenameTeam above - goes through team-service, not a direct client update.
      await updateTeamSettings(activeTeam.id, { aiAutoReplyEnabled: enabled });
      await fetchUserTeams(user.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error updating the AI auto-reply setting');
    } finally {
      setSavingAutoReply(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail || !user || !activeTeam) return;
    try {
      const res = await fetch(`${TEAM_SERVICE_URL}/api/v1/teams/${activeTeam.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole })
      });
      const data = await res.json();
      if (data.success) {
        alert('Invited successfully');
        setInviteEmail('');
      } else {
        alert(data.error);
      }
    } catch(e) {
      console.error(e);
      alert('Error inviting member');
    }
  };

  const handleBilling = async (newPlan: string) => {
    if (!user || !activeTeam) return;
    try {
      const res = await fetch(`${TEAM_SERVICE_URL}/api/v1/teams/${activeTeam.id}/billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ plan: newPlan })
      });
      const data = await res.json();
      if (data.success) {
        fetchUserTeams(user.id);
        alert('Plan updated!');
      } else {
        alert(data.error);
      }
    } catch(e) {
      console.error(e);
      alert('Error updating billing');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Team Settings / Billing */}
      <div className="bg-white p-6 rounded-lg shadow border-t-4 border-indigo-500">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Team Settings</h2>
          <span className="text-xs font-bold uppercase px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full">
            {activeTeam?.plan} PLAN
          </span>
        </div>

        <div className="mb-8">
          <h3 className="text-sm font-semibold mb-3">Team Name</h3>
          {activeTeam?.role === 'owner' && user ? (
            <TeamNameEditor key={activeTeam.id} team={activeTeam} userId={user.id} fetchUserTeams={fetchUserTeams} />
          ) : (
            <p className="text-sm text-gray-500">Only the team owner can rename this team.</p>
          )}
        </div>

        <hr className="my-6 border-gray-100" />

        {['owner', 'admin'].includes(activeTeam?.role as string) ? (
          <div className="mb-8">
            <h3 className="text-sm font-semibold mb-3">Invite Member</h3>
            <div className="flex gap-2">
              <input 
                type="email" 
                placeholder="Email address" 
                value={inviteEmail} 
                onChange={e => setInviteEmail(e.target.value)} 
                className="border p-2 text-sm rounded flex-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" 
              />
              <select 
                value={inviteRole} 
                onChange={e => setInviteRole(e.target.value)} 
                className="border p-2 text-sm rounded bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button 
                onClick={handleInvite} 
                className="bg-indigo-600 text-white px-4 py-2 text-sm rounded font-medium hover:bg-indigo-700 transition-colors"
              >
                Invite
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 mb-6">You do not have permission to invite new members to this team.</p>
        )}

        <hr className="my-6 border-gray-100" />

        {activeTeam?.role === 'owner' ? (
          <div>
            <h3 className="text-sm font-semibold mb-3">Billing</h3>
            <p className="text-sm text-gray-600 mb-4">Manage your team&apos;s subscription plan. (Mock Implementation)</p>
            {activeTeam?.plan === 'free' ? (
              <button 
                onClick={() => handleBilling('pro')} 
                className="bg-yellow-500 text-white text-sm px-6 py-2 rounded font-medium hover:bg-yellow-600 transition-colors"
              >
                Upgrade to Pro Plan
              </button>
            ) : (
              <button 
                onClick={() => handleBilling('free')} 
                className="bg-gray-200 text-gray-800 text-sm px-6 py-2 rounded font-medium hover:bg-gray-300 transition-colors"
              >
                Downgrade to Free Plan
              </button>
            )}
          </div>
        ) : (
          <div>
             <h3 className="text-sm font-semibold mb-3">Billing</h3>
             <p className="text-sm text-gray-500">Only the team owner can manage billing settings.</p>
          </div>
        )}

        <hr className="my-6 border-gray-100" />

        <div>
          <h3 className="text-sm font-semibold mb-3">AI Assistant</h3>
          {activeTeam?.role === 'owner' ? (
            <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
              <div>
                <p className="text-sm font-medium text-gray-800">Auto-send AI replies</p>
                <p className="mt-1 text-sm text-gray-500">
                  When on, comments the AI is confident about (not spam, not a complaint) are replied to automatically instead of only suggested.
                  Negative or spam comments are <span className="font-semibold">never</span> auto-replied to, and this never overrides that.
                  Off by default - review suggestions yourself on the Comments page until you trust it.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!activeTeam?.ai_auto_reply_enabled}
                onClick={() => handleToggleAutoReply(!activeTeam?.ai_auto_reply_enabled)}
                disabled={savingAutoReply}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${activeTeam?.ai_auto_reply_enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activeTeam?.ai_auto_reply_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Only the team owner can change the AI auto-reply setting.</p>
          )}
        </div>
      </div>
    </div>
  );
}
