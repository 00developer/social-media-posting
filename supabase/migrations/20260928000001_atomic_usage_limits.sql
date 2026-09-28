-- Closes two "check-then-write" race conditions found in a codebase audit: two concurrent requests near a limit
-- could both read "under the limit" and both write, together going over it. A Postgres advisory transaction lock
-- (released automatically when the transaction ends) serializes concurrent callers for the same team, so the
-- count each one sees is always up to date - this is what an app-level SELECT-then-INSERT can never guarantee.

-- AI generation quota (packages/ai/src/quota.ts). Returns true and records one use if the team is under its
-- monthly ceiling, false (and records nothing) if not.
CREATE OR REPLACE FUNCTION try_record_ai_usage(p_team_id uuid, p_kind text, p_ceiling int)
RETURNS boolean AS $$
DECLARE
  current_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ai_usage:' || p_team_id::text));
  SELECT count(*) INTO current_count FROM public.ai_usage
    WHERE team_id = p_team_id AND created_at >= date_trunc('month', now());
  IF current_count >= p_ceiling THEN
    RETURN false;
  END IF;
  INSERT INTO public.ai_usage (team_id, kind) VALUES (p_team_id, p_kind);
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Free-plan post cap (services/post-service's POST /api/v1/posts). A BEFORE INSERT trigger rather than an RPC:
-- posts already insert directly via the client's normal .insert(), and every write to `posts` goes through this
-- path regardless of which service or code path performs it, so the limit can't be bypassed by inserting from
-- somewhere the app-level check was never added to.
CREATE OR REPLACE FUNCTION enforce_free_plan_post_limit() RETURNS trigger AS $$
DECLARE
  team_plan text;
  current_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('posts_limit:' || NEW.team_id::text));
  SELECT plan INTO team_plan FROM public.teams WHERE id = NEW.team_id;
  IF team_plan = 'free' THEN
    SELECT count(*) INTO current_count FROM public.posts WHERE team_id = NEW.team_id;
    IF current_count >= 500 THEN
      RAISE EXCEPTION 'FREE_PLAN_LIMIT_REACHED: Free plan allows max 500 posts.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_free_plan_post_limit ON public.posts;
CREATE TRIGGER trg_enforce_free_plan_post_limit BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION enforce_free_plan_post_limit();
