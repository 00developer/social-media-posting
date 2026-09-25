-- Time series behind the Analytics page charts. `analytics` only keeps the latest count per post/platform;
-- the analytics-service appends a row here whenever a post's numbers change (and at least once every few hours),
-- so the charts can show how views / likes / comments grew over time.
-- Idempotent: safe to run more than once.
CREATE TABLE IF NOT EXISTS public.analytics_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  views integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  team_id uuid,
  user_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_history_team_time_idx ON public.analytics_history (team_id, recorded_at);
CREATE INDEX IF NOT EXISTS analytics_history_post_platform_time_idx ON public.analytics_history (post_id, platform, recorded_at DESC);

ALTER TABLE public.analytics_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team members can view their analytics history" ON public.analytics_history;
CREATE POLICY "Team members can view their analytics history" ON public.analytics_history
  FOR SELECT USING (team_id IN (SELECT team_id FROM public.team_members WHERE user_id = auth.uid()));
