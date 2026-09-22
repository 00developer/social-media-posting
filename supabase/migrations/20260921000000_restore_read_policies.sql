-- Restore browser read access to tables whose SELECT policies are missing on the live DB.
--
-- Found 2026-09-21: as the logged-in owner, the dashboard (anon key + user JWT) sees 0 rows in
-- schedules, publish_jobs, notifications and analytics even though every row belongs to that
-- user (service role sees 7 / 7 / 31 / 2). posts, social_accounts and team_members are fine.
-- Symptoms: timeline shows the post's created_at instead of its scheduled date, job status and
-- errors never show, sidebar notifications stay empty, analytics never render.
--
-- Same rule the original migrations defined (own rows only). SELECT only: every write to these
-- tables goes through the backend services with the service-role key, which bypasses RLS.
-- Idempotent: safe to run on a DB where some or all of these policies already exist.

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own schedules" ON public.schedules;
CREATE POLICY "Users can view their own schedules" ON public.schedules
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own publish_jobs" ON public.publish_jobs;
CREATE POLICY "Users can view their own publish_jobs" ON public.publish_jobs
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.analytics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own analytics" ON public.analytics;
CREATE POLICY "Users can view their own analytics" ON public.analytics
  FOR SELECT USING (auth.uid() = user_id);
