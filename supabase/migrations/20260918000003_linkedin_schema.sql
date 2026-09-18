-- Add target_type to distinguish between personal profiles and company pages
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS target_type text DEFAULT 'member' CHECK (target_type IN ('member', 'organization'));

-- Add organization_urn to store company page identifier
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS organization_urn text;

-- Add refresh_token_expires_at to track 365-day LinkedIn expiry ceiling
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz;
