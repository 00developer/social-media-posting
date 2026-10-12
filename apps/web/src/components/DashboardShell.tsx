'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDashboard } from './DashboardProvider';
import { NotificationBell } from './NotificationBell';
import { supabase } from '@/lib/supabase';
import {
  LayoutDashboard,
  PenSquare,
  Calendar,
  BarChart3,
  MessageSquare,
  Sparkles,
  Share2,
  Settings,
  LogOut,
  ChevronDown,
  Zap,
  Menu,
  X,
  Building2,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/posts', label: 'Posts & Compose', icon: PenSquare },
  { href: '/dashboard/calendar', label: 'Calendar', icon: Calendar },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/comments', label: 'Comments', icon: MessageSquare },
  { href: '/dashboard/ai-assistant', label: 'AI Assistant', icon: Sparkles, badge: 'AI' },
  { href: '/dashboard/accounts', label: 'Accounts', icon: Share2 },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading, teams, activeTeam, setActiveTeam, notifications, markNotificationsRead } = useDashboard();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const displayName = user?.email?.split('@')[0] || 'there';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#090d16] text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium tracking-wide text-slate-400">Loading workspace...</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col md:flex-row text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Mobile Top Header */}
      <div className="md:hidden flex items-center justify-between px-5 py-3.5 bg-[#0e1322] border-b border-slate-800 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
            <Zap className="w-3.5 h-3.5 fill-white" />
          </div>
          <span className="font-bold text-base text-white tracking-tight">SocialPush</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Toggle Navigation"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`${
          mobileMenuOpen ? 'fixed inset-0 z-40 bg-[#0e1322] flex' : 'hidden'
        } md:flex w-full md:w-64 bg-[#0d121f] border-r border-slate-800/80 flex-col min-h-screen md:sticky md:top-0 md:h-screen z-20`}
      >
        {/* Brand */}
        <div className="h-16 hidden md:flex items-center px-5 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Zap className="w-3.5 h-3.5 fill-white" />
            </div>
            <div>
              <span className="font-bold text-sm text-white tracking-tight leading-none block">SocialPush</span>
              <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">Social Studio</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Workspace
          </div>

          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`group relative flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                    {item.badge}
                  </span>
                )}

                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.75 bg-indigo-500 rounded-r-full" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer User / Logout */}
        <div className="p-3.5 border-t border-slate-800/80 bg-[#090d16]/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200 text-[11px] font-bold uppercase shrink-0">
                {displayName.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-200 truncate">{displayName}</p>
                <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 bg-[#0d121f] border-b border-slate-800/80 px-6 sm:px-8 flex justify-between items-center sticky top-0 z-20">
          <div className="flex items-center gap-2.5">
            {teams.length > 0 && (
              <div className="relative flex items-center">
                <div className="absolute left-2.5 pointer-events-none text-slate-400">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <select
                  className="appearance-none pl-8 pr-7 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 hover:border-slate-700 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                  value={activeTeam?.id || ''}
                  onChange={(e) => setActiveTeam(teams.find((t) => t.id === e.target.value) || null)}
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id} className="bg-slate-900 text-slate-200">
                      {t.name} ({t.role})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 pointer-events-none" />
              </div>
            )}
            {activeTeam && (
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                {activeTeam.plan}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <NotificationBell notifications={notifications} onMarkRead={markNotificationsRead} />
            <button
              onClick={handleLogout}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors px-2.5 py-1.5 rounded-lg"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-5 sm:p-7 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
