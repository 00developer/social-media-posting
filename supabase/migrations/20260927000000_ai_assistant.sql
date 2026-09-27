-- Foundation for the AI Assistant (caption/hashtag generator + comment-reply suggestions).
-- Idempotent: safe to run more than once.

-- One row per AI generation (caption, comment classification, or comment reply), used only to count usage against
-- the safety ceiling in packages/ai/src/quota.ts. No plan-based limit is enforced yet (decided later).
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  kind text NOT NULL, -- 'caption' | 'classify' | 'reply'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_team_time_idx ON public.ai_usage (team_id, created_at);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team members can view their AI usage" ON public.ai_usage;
CREATE POLICY "Team members can view their AI usage" ON public.ai_usage
  FOR SELECT USING (team_id IN (SELECT team_id FROM public.team_members WHERE user_id = auth.uid()));

-- Per-comment AI state: what the classifier decided, and the suggested reply (if any) waiting for review.
ALTER TABLE public.post_comments ADD COLUMN IF NOT EXISTS ai_status text; -- 'suggested' | 'skipped_spam' | 'flagged_negative'
ALTER TABLE public.post_comments ADD COLUMN IF NOT EXISTS ai_suggested_reply text;
ALTER TABLE public.post_comments ADD COLUMN IF NOT EXISTS ai_classified_at timestamptz;

-- Advanced opt-in: when true, "normal"-classified comments are replied to automatically instead of only suggested.
-- Off by default - negative/spam comments are NEVER auto-replied to, regardless of this setting.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS ai_auto_reply_enabled boolean NOT NULL DEFAULT false;
