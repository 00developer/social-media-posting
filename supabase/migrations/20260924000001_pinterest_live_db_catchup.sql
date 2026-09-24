-- Brings the live DB up to what the Pinterest code expects. Idempotent: safe to run more than once.
-- Deliberately does NOT touch social_accounts_platform_check (the threads migration already includes 'pinterest').

-- Pinterest connect writes status = 'active' on social_accounts.
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- Per-job board override read by PinterestAdapter.
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS pinterest_board_id text;

CREATE TABLE IF NOT EXISTS public.pinterest_boards (
  id uuid primary key default gen_random_uuid(),
  social_account_id uuid references public.social_accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  pinterest_board_id text not null,
  board_name text,
  is_default boolean default false,
  created_at timestamptz default now(),
  UNIQUE(social_account_id, pinterest_board_id)
);
ALTER TABLE public.pinterest_boards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner_access_only" ON public.pinterest_boards;
CREATE POLICY "owner_access_only" ON public.pinterest_boards FOR ALL USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.pinterest_published_pins (
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  pin_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (post_id)
);
ALTER TABLE public.pinterest_published_pins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own pinterest published pins" ON public.pinterest_published_pins;
DROP POLICY IF EXISTS "Users can insert their own pinterest published pins" ON public.pinterest_published_pins;
DROP POLICY IF EXISTS "Users can update their own pinterest published pins" ON public.pinterest_published_pins;
DROP POLICY IF EXISTS "Users can delete their own pinterest published pins" ON public.pinterest_published_pins;
CREATE POLICY "Users can view their own pinterest published pins" ON public.pinterest_published_pins FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own pinterest published pins" ON public.pinterest_published_pins FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own pinterest published pins" ON public.pinterest_published_pins FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own pinterest published pins" ON public.pinterest_published_pins FOR DELETE USING (auth.uid() = user_id);
