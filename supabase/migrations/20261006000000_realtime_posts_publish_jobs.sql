-- The dashboard subscribes to UPDATEs on posts and publish_jobs (DashboardProvider.tsx) so a post's status
-- refreshes the moment the worker changes it, but only notifications was ever added to the supabase_realtime
-- publication (20260922000000), so those two listeners never fired on a database built from these migrations.
-- Idempotent, same pattern as the notifications migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'publish_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_jobs;
  END IF;
END $$;
