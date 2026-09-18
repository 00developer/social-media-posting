-- Drop existing constraint if it exists (using standard naming convention)
ALTER TABLE public.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_platform_check;

-- Add updated constraint including pinterest
ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_platform_check 
CHECK (platform IN ('twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'pinterest'));

-- Create pinterest_boards table
create table if not exists public.pinterest_boards (
  id uuid primary key default gen_random_uuid(),
  social_account_id uuid references public.social_accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  pinterest_board_id text not null,
  board_name text,
  is_default boolean default false,
  created_at timestamptz default now(),
  UNIQUE(social_account_id, pinterest_board_id)
);

-- Enable RLS
alter table public.pinterest_boards enable row level security;

-- Add policy
create policy "owner_access_only"
on public.pinterest_boards for all
using (user_id = auth.uid());

-- Add pinterest_board_id to publish_jobs
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS pinterest_board_id text;
