-- Add queue_job_id to publish_jobs table
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS queue_job_id text;

-- Add index on scheduled_at in schedules table for range queries
CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_at ON public.schedules(scheduled_at);
