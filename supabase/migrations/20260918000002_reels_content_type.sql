ALTER TABLE public.publish_jobs 
ADD COLUMN IF NOT EXISTS content_type text DEFAULT 'post' CHECK (content_type IN ('post', 'reel'));
