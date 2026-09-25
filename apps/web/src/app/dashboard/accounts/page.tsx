'use client';

import { useDashboard } from '@/components/DashboardProvider';
import { ACCOUNT_SERVICE_URL } from '@/lib/apiUrls';
import { getAccountLabel } from '@/lib/accountLabel';

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
      const res = await fetch(`${ACCOUNT_SERVICE_URL}/api/v1/auth/${platform}/url?userId=${user.id}&teamId=${activeTeam.id}`);
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
      const res = await fetch(`${ACCOUNT_SERVICE_URL}/api/v1/auth/accounts/${id}?userId=${user.id}&teamId=${activeTeam.id}`, {
        method: 'DELETE'
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
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
        <div className="mb-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Connected Accounts</h2>
            <p className="text-sm text-gray-500 mt-1">Manage the social platforms connected to your workspace.</p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center border border-gray-100 mb-8">
            <h3 className="text-lg font-semibold text-gray-700 mb-1">No platforms connected</h3>
            <p className="text-sm text-gray-500">Connect a platform below to start publishing.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {accounts.map(acc => {
              const label = getAccountLabel(acc);
              const isExpiringSoon = acc.platform === 'linkedin' && typeof acc.refresh_token_expires_at === 'string' && new Date(acc.refresh_token_expires_at).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
              
              return (
              <div key={acc.id} className="bg-white border border-gray-200 p-4 rounded-2xl flex items-center justify-between shadow-sm hover:border-indigo-200 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center border border-gray-100">
                    <span className="capitalize font-bold text-gray-700">{(acc.platform || '').charAt(0)}</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 capitalize">{acc.platform || 'Unknown'}</h4>
                    {label ? (
                      <p className="text-sm text-indigo-700 font-semibold truncate max-w-[14rem]" title={label}>{label}</p>
                    ) : (
                      <p className="text-xs text-gray-500 font-medium">Active Connection</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isExpiringSoon && (
                    <span className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 px-3 py-1 rounded-full font-bold uppercase tracking-wider">
                      Reconnect Required Soon
                    </span>
                  )}
                  <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1 rounded-full font-bold uppercase tracking-wider">
                    Connected
                  </span>
                  <button 
                    onClick={() => handleDisconnect(acc.id)}
                    className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors border border-transparent hover:border-red-100"
                    title="Disconnect account"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
              )
            })}
          </div>
        )}
        
        <div className="border-t border-gray-100 pt-8">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Connect New Platform</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {['twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'pinterest', 'threads'].map(platform => {
              const isConnected = accounts.some(a => a.platform === platform);
              return (
                <button 
                  key={platform}
                  disabled={!activeTeam || activeTeam?.role === 'viewer' || isConnected} 
                  onClick={() => handleConnect(platform)} 
                  className={`relative overflow-hidden group p-4 rounded-2xl border text-left transition-all duration-300 ${isConnected ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed' : 'bg-white border-gray-200 hover:border-indigo-400 hover:shadow-md hover:shadow-indigo-100'}`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isConnected ? 'bg-gray-200' : 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors'}`}>
                       <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                    </div>
                  </div>
                  <h4 className="font-bold text-gray-900 capitalize mb-1">{platform}</h4>
                  <p className="text-xs text-gray-500 font-medium">{isConnected ? 'Already connected' : 'Click to connect'}</p>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
