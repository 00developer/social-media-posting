-- Store the platform-side identity of a connected account (e.g. LinkedIn member id / display name).
-- The LinkedIn publisher builds its author URN from provider_account_id.
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS provider_account_id text;
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS handle text;
