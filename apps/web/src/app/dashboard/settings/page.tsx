'use client';

import { useState } from 'react';
import { useDashboard, type Team } from '@/components/DashboardProvider';
import { supabase } from '@/lib/supabase';
import { TEAM_SERVICE_URL } from '@/lib/apiUrls';

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
      // RLS ("Team owners can update their teams") enforces owner-only server-side too.
      const { error } = await supabase.from('teams').update({ name: newName }).eq('id', team.id);
      if (error) {
        alert(error.message);
      } else {
        await fetchUserTeams(userId);
      }
    } catch (e) {
      console.error(e);
      alert('Error renaming team');
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

  const handleInvite = async () => {
    if (!inviteEmail || !user || !activeTeam) return;
    try {
      const res = await fetch(`${TEAM_SERVICE_URL}/api/v1/teams/${activeTeam.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, inviterId: user.id })
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlan, requesterId: user.id })
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
      </div>
    </div>
  );
}
