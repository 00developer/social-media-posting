'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDashboard } from './DashboardProvider';
import { supabase } from '@/lib/supabase';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading, teams, activeTeam, setActiveTeam, notifications } = useDashboard();
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-600">Loading your workspace...</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row text-gray-800 font-sans">
      
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-white border-r border-gray-100 flex flex-col min-h-screen z-10">
        <div className="h-16 flex items-center px-6 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-gray-900 to-gray-600 tracking-tight">SocialPush</h1>
          </div>
        </div>
        
        <nav className="flex-1 py-6 px-4 space-y-1">
          <div className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Menu</div>
          <Link 
            href="/dashboard/posts" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${pathname.includes('/posts') ? 'bg-indigo-50/80 text-indigo-700 shadow-sm font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
            Posts
          </Link>
          <Link 
            href="/dashboard/accounts" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${pathname.includes('/accounts') ? 'bg-indigo-50/80 text-indigo-700 shadow-sm font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            Accounts
          </Link>
          <Link 
            href="/dashboard/settings" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${pathname.includes('/settings') ? 'bg-indigo-50/80 text-indigo-700 shadow-sm font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Settings
          </Link>
        </nav>

        {/* Notifications in Sidebar */}
        <div className="p-5 bg-gray-50/50 m-4 rounded-2xl border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Updates</h3>
          </div>
          {notifications.length === 0 ? (
            <p className="text-xs text-gray-400">No new notifications.</p>
          ) : (
            <ul className="space-y-3 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
              {notifications.slice(0, 4).map(n => (
                <li key={n.id} className="relative pl-3">
                  <span className={`absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full ${n.type === 'success' ? 'bg-green-400' : 'bg-red-400'}`}></span>
                  <p className="text-[13px] leading-relaxed text-gray-600 line-clamp-2">{n.message as string}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Topbar */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-100 px-8 flex justify-between items-center sticky top-0 z-10">
          <div className="flex items-center gap-4">
            {teams.length > 0 && (
              <div className="relative">
                <select 
                  className="appearance-none pl-3 pr-8 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
                  value={activeTeam?.id || ''}
                  onChange={(e) => setActiveTeam(teams.find(t => t.id === e.target.value) || null)}
                >
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.role})</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            )}
            {activeTeam && (
              <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-600 border border-indigo-100">
                {activeTeam.plan}
              </span>
            )}
          </div>
          
          <button 
            onClick={handleLogout} 
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
          >
            Log Out
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </button>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
