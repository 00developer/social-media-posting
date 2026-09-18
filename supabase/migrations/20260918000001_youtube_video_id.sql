-- Add video_id to youtube_upload_sessions
ALTER TABLE public.youtube_upload_sessions ADD COLUMN IF NOT EXISTS video_id text;
