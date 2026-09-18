-- Create schedules table
CREATE TABLE public.schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  timezone text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS for schedules
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- Policies for schedules
CREATE POLICY "Users can view their own schedules" ON public.schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own schedules" ON public.schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own schedules" ON public.schedules FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own schedules" ON public.schedules FOR DELETE USING (auth.uid() = user_id);


-- Create publish_jobs table
CREATE TABLE public.publish_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  retry_count integer DEFAULT 0 NOT NULL,
  error_message text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS for publish_jobs
ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;

-- Policies for publish_jobs
CREATE POLICY "Users can view their own publish_jobs" ON public.publish_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own publish_jobs" ON public.publish_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own publish_jobs" ON public.publish_jobs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own publish_jobs" ON public.publish_jobs FOR DELETE USING (auth.uid() = user_id);


-- Triggers for updated_at
CREATE TRIGGER set_timestamp_schedules
BEFORE UPDATE ON public.schedules
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_publish_jobs
BEFORE UPDATE ON public.publish_jobs
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();
