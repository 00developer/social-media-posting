-- Remembers the platform-side id of what we published (Facebook post / video id, Instagram media id,
-- LinkedIn post URN), so the analytics service can look up that post's stats later.
-- (YouTube and Pinterest already have their own tables: youtube_upload_sessions, pinterest_published_pins.)
-- Idempotent: safe to run more than once.
CREATE TABLE IF NOT EXISTS public.published_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_id text NOT NULL,
  external_kind text NOT NULL DEFAULT 'post',   -- 'post' | 'video' | 'reel'
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, platform)
);

ALTER TABLE public.published_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own published posts" ON public.published_posts;
CREATE POLICY "Users can view their own published posts" ON public.published_posts FOR SELECT USING (auth.uid() = user_id);

-- Facebook / Instagram / LinkedIn report comment counts; analytics only had views / likes / shares.
ALTER TABLE public.analytics ADD COLUMN IF NOT EXISTS comments integer NOT NULL DEFAULT 0;
