'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDashboard } from './DashboardProvider';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
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
  // The menu is "open for" the path it was opened on, so navigating anywhere closes it without an effect.
  const [menuOpenPath, setMenuOpenPath] = useState<string | null>(null);
  const mobileMenuOpen = menuOpenPath === pathname;
  const setMobileMenuOpen = (open: boolean) => setMenuOpenPath(open ? pathname : null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpenPath(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const displayName = user?.email?.split('@')[0] || 'there';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-fg-muted">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium tracking-wide text-fg-muted">Loading workspace...</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-canvas flex flex-col md:flex-row text-fg font-sans selection:bg-indigo-500 selection:text-white">
      {/* Mobile Top Header */}
      <div className="md:hidden flex items-center justify-between px-5 py-3.5 bg-sidebar text-sidebar-fg border-b border-sidebar-line sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
            <Zap className="w-3.5 h-3.5 fill-white" />
          </div>
          <span className="font-bold text-base text-white tracking-tight">SocialPush</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg text-sidebar-fg-muted hover:text-white hover:bg-sidebar-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileMenuOpen}
          aria-controls="dashboard-sidebar"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar */}
      {/* Desktop: sticky, full viewport height with its own scroll, so the column never ends before the page does.
          Mobile: a full-screen overlay with its own close button. */}
      <aside
        id="dashboard-sidebar"
        aria-label="Main navigation"
        className={`${
          mobileMenuOpen ? 'fixed inset-0 z-40 flex' : 'hidden'
        } md:flex w-full md:w-64 shrink-0 bg-sidebar text-sidebar-fg border-r border-sidebar-line flex-col h-dvh md:sticky md:top-0 md:self-start md:h-screen md:z-20 overflow-hidden`}
      >
        {/* Mobile menu header with close button (the page header sits underneath the overlay) */}
        <div className="md:hidden flex items-center justify-between px-5 py-3.5 border-b border-sidebar-line shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Zap className="w-3.5 h-3.5 fill-white" />
            </div>
            <span className="font-bold text-base text-white tracking-tight">SocialPush</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="p-2 rounded-lg text-sidebar-fg-muted hover:text-white hover:bg-sidebar-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Brand */}
        <div className="h-14 hidden md:flex items-center px-5 border-b border-sidebar-line shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Zap className="w-3.5 h-3.5 fill-white" />
            </div>
            <div>
              <span className="font-bold text-sm text-white tracking-tight leading-none block">SocialPush</span>
              <span className="text-[10px] text-sidebar-fg-muted block leading-tight mt-0.5">Social Studio</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 py-4 px-3 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="px-3 mb-2 text-[10px] font-semibold text-sidebar-fg-muted uppercase tracking-wider">
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
                aria-current={isActive ? 'page' : undefined}
                className={`group relative flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  isActive
                    ? 'bg-sidebar-active text-white font-semibold'
                    : 'text-sidebar-fg-muted hover:text-white hover:bg-sidebar-hover'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive ? 'text-indigo-400' : 'text-sidebar-fg-muted group-hover:text-sidebar-fg'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 leading-none rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/25">
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
        <div className="p-3.5 border-t border-sidebar-line bg-black/15 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-400/25 flex items-center justify-center text-indigo-200 text-[11px] font-bold uppercase shrink-0">
                {displayName.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white truncate">{displayName}</p>
                <p className="text-[10px] text-sidebar-fg-muted truncate">{user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-sidebar-fg-muted hover:text-rose-300 hover:bg-rose-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/75 border-b border-line px-4 sm:px-8 flex justify-between items-center gap-3 md:sticky md:top-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            {teams.length > 0 && (
              <div className="relative flex items-center min-w-0">
                <div className="absolute left-2.5 pointer-events-none text-fg-subtle">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <select
                  aria-label="Active team"
                  className="appearance-none max-w-[60vw] sm:max-w-xs truncate pl-8 pr-7 py-1.5 bg-surface border border-line-strong rounded-lg text-xs font-medium text-fg shadow-xs hover:bg-surface-hover focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors cursor-pointer"
                  value={activeTeam?.id || ''}
                  onChange={(e) => setActiveTeam(teams.find((t) => t.id === e.target.value) || null)}
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id} className="bg-surface text-fg">
                      {t.name} ({t.role})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-fg-subtle absolute right-2 pointer-events-none" />
              </div>
            )}
            {activeTeam && (
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-primary-soft text-accent border border-indigo-500/20">
                {activeTeam.plan || 'free'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <NotificationBell notifications={notifications} onMarkRead={markNotificationsRead} />
            <button
              type="button"
              onClick={handleLogout}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors px-2.5 py-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
