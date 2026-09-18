-- Initial empty migration as per Phase 0 requirement
-- Create social_accounts table
CREATE TABLE public.social_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform text NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS for social_accounts
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

-- Policies for social_accounts
CREATE POLICY "Users can view their own social accounts" ON public.social_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own social accounts" ON public.social_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own social accounts" ON public.social_accounts FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own social accounts" ON public.social_accounts FOR DELETE USING (auth.uid() = user_id);

-- Create posts table
CREATE TABLE public.posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content text,
  media_url text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS for posts
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Policies for posts
CREATE POLICY "Users can view their own posts" ON public.posts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own posts" ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own posts" ON public.posts FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own posts" ON public.posts FOR DELETE USING (auth.uid() = user_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_social_accounts
BEFORE UPDATE ON public.social_accounts
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_posts
BEFORE UPDATE ON public.posts
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();
-- Create schedules table
CREATE TABLE public.schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  timezone text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS for schedules
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- Policies for schedules
CREATE POLICY "Users can view their own schedules" ON public.schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own schedules" ON public.schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own schedules" ON public.schedules FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own schedules" ON public.schedules FOR DELETE USING (auth.uid() = user_id);


-- Create publish_jobs table
CREATE TABLE public.publish_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  retry_count integer DEFAULT 0 NOT NULL,
  error_message text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS for publish_jobs
ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;

-- Policies for publish_jobs
CREATE POLICY "Users can view their own publish_jobs" ON public.publish_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own publish_jobs" ON public.publish_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own publish_jobs" ON public.publish_jobs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own publish_jobs" ON public.publish_jobs FOR DELETE USING (auth.uid() = user_id);


-- Triggers for updated_at
CREATE TRIGGER set_timestamp_schedules
BEFORE UPDATE ON public.schedules
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_publish_jobs
BEFORE UPDATE ON public.publish_jobs
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();
-- Create a new storage bucket for post media
INSERT INTO storage.buckets (id, name, public) 
VALUES ('post_media', 'post_media', true) 
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies on storage.objects

-- Allow users to upload files to their own prefix ({user_id}/...)
CREATE POLICY "Users can upload their own media" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'post_media' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to update their own files
CREATE POLICY "Users can update their own media" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'post_media' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to delete their own files
CREATE POLICY "Users can delete their own media" ON storage.objects
FOR DELETE USING (
  bucket_id = 'post_media' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Since it's a public bucket for serving, anyone can read
CREATE POLICY "Anyone can read media" ON storage.objects
FOR SELECT USING (
  bucket_id = 'post_media'
);
CREATE TABLE public.analytics (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform text NOT NULL,
  likes integer DEFAULT 0,
  shares integer DEFAULT 0,
  views integer DEFAULT 0,
  recorded_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own analytics" ON public.analytics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own analytics" ON public.analytics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own analytics" ON public.analytics FOR UPDATE USING (auth.uid() = user_id);

CREATE TABLE public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own notifications" ON public.notifications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
-- Create Teams
CREATE TABLE public.teams (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  plan text DEFAULT 'free', -- 'free', 'pro'
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create Team Members
CREATE TABLE public.team_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(team_id, user_id)
);

-- RLS setup for Teams and Team Members
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team members can view their teams" ON public.teams FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = teams.id AND user_id = auth.uid())
);
CREATE POLICY "Team owners can update their teams" ON public.teams FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = teams.id AND user_id = auth.uid() AND role = 'owner')
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team members can view members of their teams" ON public.team_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid())
);
CREATE POLICY "Admins can manage team members" ON public.team_members FOR ALL USING (
  EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid() AND role IN ('owner', 'admin'))
);

-- Alter existing tables to add team_id
ALTER TABLE public.social_accounts ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.posts ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.analytics ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;

-- Auto-migrate existing users: Create a team for each user and migrate their resources
DO $$
DECLARE
  u record;
  new_team_id uuid;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.posts UNION SELECT DISTINCT user_id FROM public.social_accounts LOOP
    INSERT INTO public.teams (name) VALUES ('My Team') RETURNING id INTO new_team_id;
    INSERT INTO public.team_members (team_id, user_id, role) VALUES (new_team_id, u.user_id, 'owner');
    
    UPDATE public.social_accounts SET team_id = new_team_id WHERE user_id = u.user_id;
    UPDATE public.posts SET team_id = new_team_id WHERE user_id = u.user_id;
    UPDATE public.analytics SET team_id = new_team_id WHERE user_id = u.user_id;
  END LOOP;
END $$;

-- RLS for social_accounts
DROP POLICY IF EXISTS "Users can view their own social accounts" ON public.social_accounts;
DROP POLICY IF EXISTS "Users can insert their own social accounts" ON public.social_accounts;
DROP POLICY IF EXISTS "Users can update their own social accounts" ON public.social_accounts;
DROP POLICY IF EXISTS "Users can delete their own social accounts" ON public.social_accounts;

CREATE POLICY "Team members can view accounts" ON public.social_accounts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = social_accounts.team_id AND user_id = auth.uid())
);
CREATE POLICY "Editors+ can insert accounts" ON public.social_accounts FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = social_accounts.team_id AND user_id = auth.uid() AND role IN ('owner', 'admin', 'editor'))
);
CREATE POLICY "Editors+ can update accounts" ON public.social_accounts FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = social_accounts.team_id AND user_id = auth.uid() AND role IN ('owner', 'admin', 'editor'))
);
CREATE POLICY "Admins+ can delete accounts" ON public.social_accounts FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = social_accounts.team_id AND user_id = auth.uid() AND role IN ('owner', 'admin'))
);

-- RLS for posts
DROP POLICY IF EXISTS "Users can view their own posts" ON public.posts;
DROP POLICY IF EXISTS "Users can insert their own posts" ON public.posts;
DROP POLICY IF EXISTS "Users can update their own posts" ON public.posts;

CREATE POLICY "Team members can view posts" ON public.posts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = posts.team_id AND user_id = auth.uid())
);
CREATE POLICY "Editors+ can insert posts" ON public.posts FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = posts.team_id AND user_id = auth.uid() AND role IN ('owner', 'admin', 'editor'))
);
CREATE POLICY "Editors+ can update posts" ON public.posts FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.team_members WHERE team_id = posts.team_id AND user_id = auth.uid() AND role IN ('owner', 'admin', 'editor'))
);
