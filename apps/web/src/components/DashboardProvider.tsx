'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

export type Team = { id: string; name?: string; plan?: string; role?: string; [key: string]: unknown };
export type SocialAccount = { id: string; platform?: string; [key: string]: unknown };
export type PublishJob = { status: string; error_message?: string; [key: string]: unknown };
export type Schedule = { scheduled_at: string; platform: string; [key: string]: unknown };
export type Post = { id: string; status?: string; publish_jobs?: PublishJob[]; schedules?: Schedule[]; created_at?: string; media_url?: string; content?: string; [key: string]: unknown };
export type AppNotification = { id: string; [key: string]: unknown };
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
  analytics: AppAnalytics[];
  fetchTeamData: () => Promise<void>;
  fetchUserTeams: (userId: string) => Promise<void>;
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
  
  const router = useRouter();

  const fetchUserTeams = useCallback(async function fetchTeams(userId: string) {
    const { data: teamData } = await supabase.from('team_members').select('team_id, role, teams(id, name, plan)').eq('user_id', userId);
    if (teamData && teamData.length > 0) {
      const formattedTeams = teamData.map((d: Record<string, unknown>) => ({ ...(d.teams as Record<string, unknown>), role: d.role as string })) as Team[];
      setTeams(formattedTeams);
      setActiveTeam((prev: Team | null) => prev ? formattedTeams.find((t: Team) => t.id === prev.id) || formattedTeams[0] : formattedTeams[0]);
    } else {
      // Auto-create a default team for newly signed up users
      const { data: newTeam, error } = await supabase.from('teams').insert({ name: 'My Personal Team' }).select().single();
      if (error) {
        console.error('Error creating team:', error.message || error);
      }
      if (newTeam) {
        const { error: tmError } = await supabase.from('team_members').insert({ team_id: newTeam.id, user_id: userId, role: 'owner' });
        if (tmError) console.error('Error adding team member:', tmError);
        fetchTeams(userId);
      }
    }
  }, []);

  const fetchTeamData = useCallback(async () => {
    if (!activeTeam) return;
    
    const { data: accountsData } = await supabase.from('social_accounts').select('*').eq('team_id', activeTeam.id);
    if (accountsData) setAccounts(accountsData as SocialAccount[]);

    const { data: postsData } = await supabase.from('posts').select('*, publish_jobs(*)').eq('team_id', activeTeam.id).order('created_at', { ascending: false });
    if (postsData) setPosts(postsData as Post[]);

    const { data: notifData } = await supabase.from('notifications').select('*').eq('user_id', user?.id).order('created_at', { ascending: false }).limit(10);
    if (notifData) setNotifications(notifData as AppNotification[]);

    const { data: analyticsData } = await supabase.from('analytics').select('*').eq('team_id', activeTeam.id);
    if (analyticsData) setAnalytics(analyticsData as AppAnalytics[]);
  }, [activeTeam, user?.id]);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
      } else {
        setUser(session.user);
        await fetchUserTeams(session.user.id);
      }
      setLoading(false);
    };
    checkUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login');
      } else if (session) {
        setUser(session.user);
        fetchUserTeams(session.user.id);
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
      .channel('realtime:notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        setNotifications(prev => [payload.new as AppNotification, ...prev].slice(0, 10));
        // Refresh team data to update timeline post statuses
        fetchTeamData();
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchTeamData]);

  const value = {
    user,
    loading,
    teams,
    activeTeam,
    setActiveTeam,
    accounts,
    posts,
    notifications,
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
