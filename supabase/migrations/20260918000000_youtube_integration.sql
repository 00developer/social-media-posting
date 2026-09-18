-- Add channel_id and channel_title to social_accounts
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS channel_id text;
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS channel_title text;

-- Create youtube_upload_sessions table
CREATE TABLE public.youtube_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_uri text NOT NULL,
  bytes_uploaded bigint DEFAULT 0,
  status text CHECK (status IN ('in_progress','completed','failed')) DEFAULT 'in_progress',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS for youtube_upload_sessions
ALTER TABLE public.youtube_upload_sessions ENABLE ROW LEVEL SECURITY;

-- Policy for youtube_upload_sessions
CREATE POLICY "owner_access_only"
ON public.youtube_upload_sessions FOR ALL
USING (user_id = auth.uid());

-- Trigger for updated_at on youtube_upload_sessions
CREATE TRIGGER set_timestamp_youtube_upload_sessions
BEFORE UPDATE ON public.youtube_upload_sessions
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();
