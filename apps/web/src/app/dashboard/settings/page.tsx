'use client';

import { useState } from 'react';
import { useDashboard, type Team } from '@/components/DashboardProvider';
import { TEAM_SERVICE_URL } from '@/lib/apiUrls';
import { authHeader } from '@/lib/supabase';
import { useConfirm, useToast } from '@/components/ui/Toast';
import { Spinner } from '@/components/ui/Dialog';

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

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
  const toast = useToast();

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
      toast.success('Team renamed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error renaming team');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <form className="flex flex-col sm:flex-row gap-2.5" onSubmit={(e) => { e.preventDefault(); void handleRenameTeam(); }}>
      <label htmlFor="team-name" className="sr-only">Team name</label>
      <input
        id="team-name"
        type="text"
        value={teamNameInput}
        onChange={e => setTeamNameInput(e.target.value)}
        className="rounded-xl border border-line-strong bg-surface-muted/90 px-3.5 py-2 text-sm text-fg placeholder:text-fg-subtle flex-1 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
      <button
        type="submit"
        disabled={savingName || !teamNameInput.trim() || teamNameInput.trim() === team.name}
        aria-busy={savingName}
        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary hover:bg-primary-hover px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
      >
        {savingName && <Spinner />}
        {savingName ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}

export default function SettingsPage() {
  const { user, activeTeam, fetchUserTeams } = useDashboard();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [savingAutoReply, setSavingAutoReply] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const planLabel = `${(activeTeam?.plan || 'free').toUpperCase()} PLAN`;

  const handleToggleAutoReply = async (enabled: boolean) => {
    if (!activeTeam || !user) return;
    setSavingAutoReply(true);
    try {
      // See the same note in handleRenameTeam above - goes through team-service, not a direct client update.
      await updateTeamSettings(activeTeam.id, { aiAutoReplyEnabled: enabled });
      await fetchUserTeams(user.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error updating the AI auto-reply setting');
    } finally {
      setSavingAutoReply(false);
    }
  };

  const handleInvite = async () => {
    if (!user || !activeTeam || inviting) return;
    const email = inviteEmail.trim();
    if (!isValidEmail(email)) {
      setInviteError('Enter a valid email address (e.g. teammate@example.com).');
      return;
    }
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch(`${TEAM_SERVICE_URL}/api/v1/teams/${activeTeam.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ email, role: inviteRole })
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast.success(`Invited ${email} as ${inviteRole}.`);
        setInviteEmail('');
      } else {
        setInviteError(data.error || `Could not send the invite (${res.status}).`);
      }
    } catch(e) {
      console.error(e);
      toast.error('Error inviting member');
    } finally {
      setInviting(false);
    }
  };

  const handleBilling = async (newPlan: string) => {
    if (!user || !activeTeam || billingBusy) return;
    if (newPlan === 'free') {
      const ok = await confirm({
        title: 'Downgrade to the Free plan?',
        description: 'Your team loses Pro features at once. You can upgrade again at any time.',
        confirmLabel: 'Downgrade',
        destructive: true,
      });
      if (!ok) return;
    }
    setBillingBusy(true);
    try {
      const res = await fetch(`${TEAM_SERVICE_URL}/api/v1/teams/${activeTeam.id}/billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ plan: newPlan })
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        await fetchUserTeams(user.id);
        toast.success(newPlan === 'free' ? 'Plan changed to Free.' : 'Plan upgraded to Pro.');
      } else {
        toast.error(data.error || 'Could not update the plan.');
      }
    } catch(e) {
      console.error(e);
      toast.error('Error updating billing');
    } finally {
      setBillingBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Team Settings / Billing */}
      <div className="rounded-xl border border-line bg-surface shadow-card p-4 sm:p-6">
        <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
          <div>
            <h2 className="text-xl font-bold text-fg tracking-tight">Team Settings</h2>
            <p className="text-sm text-fg-muted mt-1">Manage team preferences, members, and subscription.</p>
          </div>
          <span className="text-xs font-semibold uppercase px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/50 text-accent rounded-full">
            {planLabel}
          </span>
        </div>

        <div className="mb-8">
          <h3 className="text-xs font-bold text-fg-muted uppercase tracking-wider mb-3">Team Name</h3>
          {activeTeam?.role === 'owner' && user ? (
            <TeamNameEditor key={activeTeam.id} team={activeTeam} userId={user.id} fetchUserTeams={fetchUserTeams} />
          ) : (
            <p className="text-sm text-fg-muted">Only the team owner can rename this team.</p>
          )}
        </div>

        <hr className="my-6 border-line" />

        {['owner', 'admin'].includes(activeTeam?.role as string) ? (
          <div className="mb-8">
            <h3 className="text-xs font-bold text-fg-muted uppercase tracking-wider mb-3">Invite Member</h3>
            <form className="flex flex-col sm:flex-row gap-2.5" noValidate onSubmit={(e) => { e.preventDefault(); void handleInvite(); }}>
              <label htmlFor="invite-email" className="sr-only">Email address</label>
              <input
                id="invite-email"
                type="email"
                autoComplete="off"
                placeholder="Email address"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); if (inviteError) setInviteError(null); }}
                disabled={inviting}
                aria-invalid={!!inviteError}
                aria-describedby={inviteError ? 'invite-error' : undefined}
                className={`min-w-0 rounded-xl border bg-surface-muted/90 px-3.5 py-2 text-sm text-fg placeholder:text-fg-subtle flex-1 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${inviteError ? 'border-rose-500/70' : 'border-line-strong'}`}
              />
              <label htmlFor="invite-role" className="sr-only">Role</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                disabled={inviting}
                className="rounded-xl border border-line-strong bg-surface-muted px-3.5 py-2 text-sm font-medium text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                aria-busy={inviting}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary hover:bg-primary-hover px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
              >
                {inviting && <Spinner />}
                {inviting ? 'Inviting...' : 'Invite'}
              </button>
            </form>
            {inviteError && <p id="invite-error" role="alert" className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-400">{inviteError}</p>}
          </div>
        ) : (
          <p className="text-sm text-fg-muted mb-6">You do not have permission to invite new members to this team.</p>
        )}

        <hr className="my-6 border-line" />

        {activeTeam?.role === 'owner' ? (
          <div className="mb-8">
            <h3 className="text-xs font-bold text-fg-muted uppercase tracking-wider mb-3">Billing</h3>
            <p className="text-sm text-fg-muted mb-4">Manage your team&apos;s subscription plan.</p>
            {(activeTeam?.plan || 'free') === 'free' ? (
              <button
                type="button"
                onClick={() => handleBilling('pro')}
                disabled={billingBusy}
                aria-busy={billingBusy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 px-5 py-2.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
              >
                {billingBusy && <Spinner />}
                {billingBusy ? 'Upgrading...' : 'Upgrade to Pro Plan'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleBilling('free')}
                disabled={billingBusy}
                aria-busy={billingBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong bg-surface-hover px-6 py-2.5 text-xs font-bold text-fg hover:bg-surface-strong transition-all disabled:opacity-50"
              >
                {billingBusy && <Spinner />}
                {billingBusy ? 'Updating...' : 'Downgrade to Free Plan'}
              </button>
            )}
          </div>
        ) : (
          <div className="mb-8">
             <h3 className="text-xs font-bold text-fg-muted uppercase tracking-wider mb-3">Billing</h3>
             <p className="text-sm text-fg-muted">Only the team owner can manage billing settings.</p>
          </div>
        )}

        <hr className="my-6 border-line" />

        <div>
          <h3 className="text-xs font-bold text-fg-muted uppercase tracking-wider mb-3">AI Assistant</h3>
          {activeTeam?.role === 'owner' ? (
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-surface-muted/60 p-4.5 backdrop-blur-md">
              <div>
                <p className="text-sm font-bold text-fg">Auto-send AI replies</p>
                <p className="mt-1 text-xs text-fg-muted leading-relaxed">
                  When on, comments the AI is confident about (not spam, not a complaint) are replied to automatically instead of only suggested.
                  Negative or spam comments are <span className="font-semibold text-rose-700 dark:text-rose-400">never</span> auto-replied to, and this never overrides that.
                  Off by default - review suggestions yourself on the Comments page until you trust it.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Auto-send AI replies"
                aria-checked={!!activeTeam?.ai_auto_reply_enabled}
                onClick={() => handleToggleAutoReply(!activeTeam?.ai_auto_reply_enabled)}
                disabled={savingAutoReply}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${activeTeam?.ai_auto_reply_enabled ? 'bg-primary shadow-md shadow-indigo-500/40' : 'bg-surface-hover border border-line-strong'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${activeTeam?.ai_auto_reply_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Only the team owner can change the AI auto-reply setting.</p>
          )}
        </div>
      </div>
    </div>
  );
}
