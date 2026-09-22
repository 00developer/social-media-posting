-- Update social_accounts platform check constraint to include 'threads'
ALTER TABLE public.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_platform_check CHECK (platform IN ('twitter', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'pinterest', 'threads'));
