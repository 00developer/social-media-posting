'use client';

import { useEffect, useRef, useState } from 'react';
import { useDashboard } from '@/components/DashboardProvider';
import { ACCOUNT_SERVICE_URL } from '@/lib/apiUrls';
import { getAccountLabel } from '@/lib/accountLabel';
import { authHeader } from '@/lib/supabase';
import { useConfirm, useToast } from '@/components/ui/Toast';
import { Spinner } from '@/components/ui/Dialog';

const PLATFORMS = ['twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'pinterest', 'threads'];
const EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

export default function AccountsPage() {
  const { user, activeTeam, accounts, fetchTeamData, dataLoaded } = useDashboard();
  const toast = useToast();
  const confirm = useConfirm();
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  // "Now" for the LinkedIn token-expiry badge, captured once (reading the clock during render is impure).
  const [nowMs] = useState(() => Date.now());
  // The OAuth popup watcher; cleared on unmount so it never outlives the page.
  const popupTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (popupTimer.current) clearInterval(popupTimer.current);
  }, []);

  const isViewer = activeTeam?.role === 'viewer';

  const handleConnect = async (platform: string) => {
    if (connectingPlatform) return;
    if (!user || !activeTeam) {
      toast.info('Please wait for your team to load before connecting accounts.');
      return;
    }

    // Open window immediately to avoid popup blockers
    const popup = window.open('', '_blank', 'width=600,height=600');
    setConnectingPlatform(platform);
    let keepWaiting = false;

    try {
      const res = await fetch(`${ACCOUNT_SERVICE_URL}/api/v1/auth/${platform}/url?teamId=${activeTeam.id}`, {
        headers: await authHeader(),
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        if (popup) {
          popup.location.href = data.url;
          keepWaiting = true;
          // Check periodically if the popup was closed, then refresh the account list.
          if (popupTimer.current) clearInterval(popupTimer.current);
          popupTimer.current = setInterval(() => {
            if (popup.closed) {
              if (popupTimer.current) clearInterval(popupTimer.current);
              popupTimer.current = null;
              setConnectingPlatform(null);
              void fetchTeamData();
            }
          }, 500);
        } else {
          window.location.assign(data.url);
        }
      } else {
        popup?.close();
        toast.error(data.error || `Could not start connecting ${platform}.`);
      }
    } catch (e) {
      console.error(e);
      popup?.close();
      toast.error('Error connecting account.');
    } finally {
      if (!keepWaiting) setConnectingPlatform(null);
    }
  };

  const handleDisconnect = async (id: string, platform: string) => {
    if (!user || !activeTeam || isViewer || disconnectingId) return;
    const ok = await confirm({
      title: `Disconnect ${platform}?`,
      description: 'Scheduled posts for this account will fail until you connect it again.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    setDisconnectingId(id);
    try {
      const res = await fetch(`${ACCOUNT_SERVICE_URL}/api/v1/auth/accounts/${id}?teamId=${activeTeam.id}`, {
        method: 'DELETE',
        headers: await authHeader(),
      });
      if (res.ok) {
        toast.success(`${platform.charAt(0).toUpperCase()}${platform.slice(1)} disconnected.`);
        await fetchTeamData();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to disconnect');
      }
    } catch (e) {
      console.error(e);
      toast.error('Error disconnecting account.');
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-800 bg-[#0d131f] p-4 sm:p-6 shadow-xs">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white tracking-tight">Connected Accounts</h2>
            <p className="text-xs text-slate-400 mt-0.5">Manage the social platforms connected to your workspace.</p>
          </div>
        </div>

        {!dataLoaded ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6" aria-busy="true" aria-label="Loading accounts">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 flex items-center gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-slate-800" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-20 rounded bg-slate-800" />
                  <div className="h-2.5 w-32 rounded bg-slate-800/70" />
                </div>
              </div>
            ))}
            <span className="sr-only">Loading accounts...</span>
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center mb-6">
            <h3 className="text-sm font-semibold text-white mb-1">No platforms connected</h3>
            <p className="text-xs text-slate-400">Connect a platform below to start publishing.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {accounts.map(acc => {
              const label = getAccountLabel(acc);
              const platform = acc.platform || 'unknown';
              const isExpiringSoon = acc.platform === 'linkedin' && typeof acc.refresh_token_expires_at === 'string' && new Date(acc.refresh_token_expires_at).getTime() - nowMs < EXPIRY_WARNING_MS;
              const disconnecting = disconnectingId === acc.id;

              return (
                <li key={acc.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 hover:border-slate-700 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-8 h-8 shrink-0 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700" aria-hidden="true">
                      <span className="capitalize font-bold text-xs text-indigo-400">{platform.charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-xs text-white capitalize">{acc.platform || 'Unknown'}</h4>
                      {label ? (
                        <p className="text-xs text-indigo-400 font-medium truncate" title={label}>{label}</p>
                      ) : (
                        <p className="text-[11px] text-slate-400">Active</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isExpiringSoon && (
                      <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-md font-medium">
                        Expiring Soon
                      </span>
                    )}
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded-md font-medium">
                      Connected
                    </span>
                    {!isViewer && (
                      <button
                        type="button"
                        onClick={() => handleDisconnect(acc.id, platform)}
                        disabled={!!disconnectingId}
                        aria-busy={disconnecting}
                        className="text-slate-400 hover:text-rose-400 p-1.5 rounded-lg transition-colors hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={disconnecting ? 'Disconnecting...' : `Disconnect ${platform}`}
                        aria-label={disconnecting ? `Disconnecting ${platform}` : `Disconnect ${platform}${label ? ` (${label})` : ''}`}
                      >
                        {disconnecting ? (
                          <Spinner />
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        )}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-slate-800 pt-6">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Connect Platform</h3>
          {isViewer && <p className="mb-3 text-xs text-slate-500">Viewers cannot connect or disconnect accounts.</p>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PLATFORMS.map(platform => {
              const isConnected = dataLoaded && accounts.some(a => a.platform === platform);
              const connecting = connectingPlatform === platform;
              return (
                <button
                  key={platform}
                  type="button"
                  disabled={!activeTeam || !dataLoaded || isViewer || isConnected || !!connectingPlatform}
                  onClick={() => handleConnect(platform)}
                  aria-busy={connecting}
                  aria-label={isConnected ? `${platform} connected` : `Connect ${platform}`}
                  className={`min-w-0 p-3.5 rounded-xl border text-left transition-colors disabled:cursor-not-allowed ${isConnected ? 'bg-slate-900/30 border-slate-800/60 opacity-50' : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900 disabled:opacity-60 disabled:hover:bg-slate-900/50'}`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isConnected ? 'bg-slate-800 text-slate-500' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`} aria-hidden="true">
                      {connecting ? (
                        <Spinner />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      )}
                    </div>
                  </div>
                  <h4 className="font-semibold text-xs text-white capitalize truncate">{platform}</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">{isConnected ? 'Connected' : connecting ? 'Waiting for sign-in...' : 'Connect account'}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
