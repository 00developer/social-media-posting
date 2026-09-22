'use client';

import React, { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { NOTIFICATION_LIMIT, NOTIFICATION_POLL_MS } from '@/lib/notifications';

export type Team = { id: string; name?: string; plan?: string; role?: string; [key: string]: unknown };
export type SocialAccount = { id: string; platform?: string; [key: string]: unknown };
export type PublishJob = { status: string; error_message?: string; [key: string]: unknown };
export type Schedule = { scheduled_at: string; platform: string; [key: string]: unknown };
export type Post = { id: string; status?: string; publish_jobs?: PublishJob[]; schedules?: Schedule[]; created_at?: string; media_url?: string; content?: string; [key: string]: unknown };
export type AppNotification = { id: string; type?: string; message?: string; read?: boolean; created_at?: string; [key: string]: unknown };
export type AppAnalytics = { id: string; platform?: string; views?: number; likes?: number; shares?: number; comments?: number; [key: string]: unknown };

interface DashboardContextType {
  user: User | null;
  loading: boolean;
  teams: Team[];
  activeTeam: Team | null;
  setActiveTeam: React.Dispatch<React.SetStateAction<Team | null>>;
  accounts: SocialAccount[];
  posts: Post[];
  notifications: AppNotification[];
  /** Marks these notifications as read (immediately in the UI, then in the database). */
  markNotificationsRead: (ids: string[]) => Promise<void>;
  analytics: AppAnalytics[];
  fetchTeamData: () => Promise<void>;
  fetchUserTeams: (userId: string, requestedTeamName?: string) => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [analytics, setAnalytics] = useState<AppAnalytics[]>([]);
  // Ids the user already read in this session. Applied on top of every fetch, so a notification stays read
  // even if the database update is refused (missing UPDATE policy) or a poll returns the old flag.
  const locallyRead = useRef<Set<string>>(new Set());
  const withLocalRead = useCallback((list: AppNotification[]) => list.map((n) => (locallyRead.current.has(n.id) ? { ...n, read: true } : n)), []);
  
  const router = useRouter();

  const fetchUserTeamsRaw = useCallback(async function fetchTeams(userId: string, requestedTeamName?: string): Promise<void> {
    const { data: teamData, error } = await supabase.from('team_members').select('team_id, role, teams(id, name, plan)').eq('user_id', userId);
    if (error) {
      // Don't fall through to auto-create on a failed read - that would create a
      // duplicate "My Personal Team" even though the user's real team(s) just failed to load.
      console.error('Error fetching teams:', error.message);
      return;
    }
    if (teamData && teamData.length > 0) {
      const formattedTeams = teamData.map((d: Record<string, unknown>) => ({ ...(d.teams as Record<string, unknown>), role: d.role as string })) as Team[];
      setTeams(formattedTeams);
      setActiveTeam((prev: Team | null) => prev ? formattedTeams.find((t: Team) => t.id === prev.id) || formattedTeams[0] : formattedTeams[0]);
    } else {
      // Auto-create a team for newly signed up users - named after what they typed at
      // signup (options.data.team_name in user_metadata), falling back to a default.
      const { data: newTeam, error: createError } = await supabase.from('teams').insert({ name: requestedTeamName?.trim() || 'My Personal Team' }).select().single();
      if (createError) {
        console.error('Error creating team:', createError.message || createError);
      }
      if (newTeam) {
        const { error: tmError } = await supabase.from('team_members').insert({ team_id: newTeam.id, user_id: userId, role: 'owner' });
        if (tmError) console.error('Error adding team member:', tmError);
        await fetchTeams(userId, requestedTeamName);
      }
    }
  }, []);

  // checkUser()'s getSession() and onAuthStateChange's INITIAL_SESSION both fire on every
  // mount, each calling this with the same userId almost simultaneously. Without dedup, both
  // in-flight calls can see "no team yet" before either INSERT lands and each auto-create its
  // own "My Personal Team" - a real duplicate-teams bug this surfaced (two identical entries in
  // the team switcher). Concurrent calls for the same user now share one in-flight promise.
  const teamsFetchRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);
  const fetchUserTeams = useCallback((userId: string, requestedTeamName?: string) => {
    if (teamsFetchRef.current?.userId === userId) return teamsFetchRef.current.promise;
    const promise = fetchUserTeamsRaw(userId, requestedTeamName).finally(() => {
      if (teamsFetchRef.current?.promise === promise) teamsFetchRef.current = null;
    });
    teamsFetchRef.current = { userId, promise };
    return promise;
  }, [fetchUserTeamsRaw]);

  const fetchTeamData = useCallback(async () => {
    if (!activeTeam) return;
    
    const { data: accountsData } = await supabase.from('social_accounts').select('*').eq('team_id', activeTeam.id);
    if (accountsData) setAccounts(accountsData as SocialAccount[]);

    const { data: postsData } = await supabase.from('posts').select('*, publish_jobs(*), schedules(*)').eq('team_id', activeTeam.id).order('created_at', { ascending: false });
    if (postsData) setPosts(postsData as Post[]);

    const { data: notifData } = await supabase.from('notifications').select('*').eq('user_id', user?.id).order('created_at', { ascending: false }).limit(NOTIFICATION_LIMIT);
    if (notifData) setNotifications(withLocalRead(notifData as AppNotification[]));

    const { data: analyticsData } = await supabase.from('analytics').select('*').eq('team_id', activeTeam.id);
    if (analyticsData) setAnalytics(analyticsData as AppAnalytics[]);
  }, [activeTeam, user?.id, withLocalRead]);

  // Notifications only (cheap): used by the poll below and after marking as read.
  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(NOTIFICATION_LIMIT);
    if (data) setNotifications(withLocalRead(data as AppNotification[]));
  }, [user, withLocalRead]);

  const markNotificationsRead = useCallback(async (ids: string[]) => {
    if (!user || ids.length === 0) return;
    ids.forEach((id) => locallyRead.current.add(id));
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids).eq('user_id', user.id);
    if (error) console.error('Could not mark notifications as read (is the UPDATE policy applied?):', error.message);
  }, [user]);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
      } else {
        setUser(session.user);
        await fetchUserTeams(session.user.id, session.user.user_metadata?.team_name);
      }
      setLoading(false);
    };
    checkUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login');
      } else if (session) {
        setUser(session.user);
        fetchUserTeams(session.user.id, session.user.user_metadata?.team_name);
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, [router, fetchUserTeams]);

  useEffect(() => {
    if (user && activeTeam) {
      fetchTeamData();
    }
  }, [user, activeTeam, fetchTeamData]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('realtime:updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        setNotifications(prev => [payload.new as AppNotification, ...prev].slice(0, NOTIFICATION_LIMIT));
        // Refresh team data to update timeline post statuses
        fetchTeamData();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'publish_jobs', filter: `user_id=eq.${user.id}` }, () => {
        fetchTeamData();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts', filter: `user_id=eq.${user.id}` }, () => {
        fetchTeamData();
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchTeamData]);

  // Realtime for `notifications` is not guaranteed to be enabled on the database, so the bell also polls
  // while the tab is visible, and refreshes when the tab becomes visible again.
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };
    const timer = setInterval(refresh, NOTIFICATION_POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user, fetchNotifications]);

  const value = {
    user,
    loading,
    teams,
    activeTeam,
    setActiveTeam,
    accounts,
    posts,
    notifications,
    markNotificationsRead,
    analytics,
    fetchTeamData,
    fetchUserTeams
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (context === undefined) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}
