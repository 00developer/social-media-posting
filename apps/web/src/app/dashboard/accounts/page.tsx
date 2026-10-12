'use client';

import { useDashboard } from '@/components/DashboardProvider';
import { ACCOUNT_SERVICE_URL } from '@/lib/apiUrls';
import { getAccountLabel } from '@/lib/accountLabel';
import { authHeader } from '@/lib/supabase';

export default function AccountsPage() {
  const { user, activeTeam, accounts } = useDashboard();

  const handleConnect = async (platform: string) => {
    if (!user || !activeTeam) {
      alert("Please wait for your team to load before connecting accounts.");
      return;
    }
    
    // Open window immediately to avoid popup blockers
    const popup = window.open('', '_blank', 'width=600,height=600');
    
    try {
      const res = await fetch(`${ACCOUNT_SERVICE_URL}/api/v1/auth/${platform}/url?teamId=${activeTeam.id}`, {
        headers: await authHeader(),
      });
      const data = await res.json();
      if (data.url) {
        if (popup) {
          popup.location.href = data.url;
          
          // Check periodically if popup is closed to auto-refresh
          const timer = setInterval(() => {
            if (popup.closed) {
              clearInterval(timer);
              fetchTeamData();
            }
          }, 500);
          
        } else {
          window.location.assign(data.url);
        }
      } else {
        if (popup) popup.close();
        alert(data.error);
      }
    } catch (e) {
      console.error(e);
      if (popup) popup.close();
      alert('Error connecting account.');
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!user || !activeTeam) return;
    if (!confirm('Are you sure you want to disconnect this account?')) return;
    try {
      const res = await fetch(`${ACCOUNT_SERVICE_URL}/api/v1/auth/accounts/${id}?teamId=${activeTeam.id}`, {
        method: 'DELETE',
        headers: await authHeader(),
      });
      if (res.ok) {
        fetchTeamData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to disconnect');
      }
    } catch (e) {
      console.error(e);
      alert('Error disconnecting account.');
    }
  };
  
  const { fetchTeamData } = useDashboard();

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-800 bg-[#0d131f] p-6 shadow-xs">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Connected Accounts</h2>
            <p className="text-xs text-slate-400 mt-0.5">Manage the social platforms connected to your workspace.</p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center mb-6">
            <h3 className="text-sm font-semibold text-white mb-1">No platforms connected</h3>
            <p className="text-xs text-slate-400">Connect a platform below to start publishing.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {accounts.map(acc => {
              const label = getAccountLabel(acc);
              const isExpiringSoon = acc.platform === 'linkedin' && typeof acc.refresh_token_expires_at === 'string' && new Date(acc.refresh_token_expires_at).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
              
              return (
              <div key={acc.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 flex items-center justify-between hover:border-slate-700 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                    <span className="capitalize font-bold text-xs text-indigo-400">{(acc.platform || '').charAt(0)}</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-xs text-white capitalize">{acc.platform || 'Unknown'}</h4>
                    {label ? (
                      <p className="text-xs text-indigo-400 font-medium truncate max-w-52" title={label}>{label}</p>
                    ) : (
                      <p className="text-[11px] text-slate-400">Active</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isExpiringSoon && (
                    <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-md font-medium">
                      Expiring Soon
                    </span>
                  )}
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded-md font-medium">
                    Connected
                  </span>
                  <button 
                    onClick={() => handleDisconnect(acc.id)}
                    className="text-slate-400 hover:text-rose-400 p-1.5 rounded-lg transition-colors hover:bg-slate-800"
                    title="Disconnect account"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
              )
            })}
          </div>
        )}
        
        <div className="border-t border-slate-800 pt-6">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Connect Platform</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {['twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'pinterest', 'threads'].map(platform => {
              const isConnected = accounts.some(a => a.platform === platform);
              return (
                <button 
                  key={platform}
                  disabled={!activeTeam || activeTeam?.role === 'viewer' || isConnected} 
                  onClick={() => handleConnect(platform)} 
                  className={`p-3.5 rounded-xl border text-left transition-colors ${isConnected ? 'bg-slate-900/30 border-slate-800/60 opacity-50 cursor-not-allowed' : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900'}`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isConnected ? 'bg-slate-800 text-slate-500' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`}>
                       <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    </div>
                  </div>
                  <h4 className="font-semibold text-xs text-white capitalize">{platform}</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">{isConnected ? 'Connected' : 'Connect account'}</p>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
