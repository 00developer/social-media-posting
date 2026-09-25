-- Comments (and replies) on the posts we published, pulled from each platform by the analytics-service so users
-- can answer them from the dashboard. Replies written from the dashboard are stored here too (is_own = true).
-- A top-level comment has parent_external_id NULL; a reply points at the platform id of the comment it answers.
-- Idempotent: safe to run more than once.
CREATE TABLE IF NOT EXISTS public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  account_id uuid,                              -- the connected social account the post belongs to
  platform text NOT NULL,
  external_post_id text NOT NULL,               -- platform id of the post / video / media
  external_comment_id text NOT NULL,
  parent_external_id text,
  author_name text,
  author_id text,
  text text NOT NULL DEFAULT '',
  commented_at timestamptz,
  is_own boolean NOT NULL DEFAULT false,        -- written by the connected account itself (incl. replies sent from here)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_comment_id)
);

CREATE INDEX IF NOT EXISTS post_comments_team_time_idx ON public.post_comments (team_id, commented_at DESC);
CREATE INDEX IF NOT EXISTS post_comments_post_idx ON public.post_comments (post_id, platform);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team members can view their post comments" ON public.post_comments;
CREATE POLICY "Team members can view their post comments" ON public.post_comments
  FOR SELECT USING (team_id IN (SELECT team_id FROM public.team_members WHERE user_id = auth.uid()));
