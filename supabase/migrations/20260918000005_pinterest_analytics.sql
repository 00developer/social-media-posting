-- Create pinterest_published_pins table to track pin_id for analytics
CREATE TABLE public.pinterest_published_pins (
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  pin_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (post_id)
);

-- Enable RLS
ALTER TABLE public.pinterest_published_pins ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own pinterest published pins" ON public.pinterest_published_pins FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own pinterest published pins" ON public.pinterest_published_pins FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own pinterest published pins" ON public.pinterest_published_pins FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own pinterest published pins" ON public.pinterest_published_pins FOR DELETE USING (auth.uid() = user_id);
