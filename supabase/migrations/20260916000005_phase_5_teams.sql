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
