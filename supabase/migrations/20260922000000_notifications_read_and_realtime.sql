-- Header notification bell: let the browser mark ITS OWN notifications as read, and make sure new
-- notifications are pushed live.
--
-- Found 2026-09-22:
--  * The dashboard could only SELECT notifications (see 20260921000000_restore_read_policies.sql), so
--    "mark as read" had no way to persist. All 31 existing rows have read = false.
--  * A Realtime check (docs/dev-scripts/realtime-check.js) received NO event for an INSERT into
--    public.notifications, i.e. the table is not in the supabase_realtime publication. The bell also polls,
--    so it works without this, but Realtime makes new notifications appear instantly.
--
-- Idempotent: safe to run more than once.

-- 1) The owner may update only the `read` column, and only on their own rows.
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (read) ON public.notifications TO authenticated;

-- 2) Push INSERTs (and updates) of notifications through Supabase Realtime.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
