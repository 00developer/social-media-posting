-- Security hardening (2026-09-28): closes two gaps found in a full-codebase audit.
--
-- 1) `teams` never had an INSERT policy. DashboardProvider.tsx creates a new user's first personal team with a
--    direct client-side `supabase.from('teams').insert(...)`, fully subject to RLS (unlike the historical
--    migration backfill above, which ran as the DB owner and bypassed RLS). With RLS enabled and no permissive
--    INSERT policy, that insert was silently denied for every brand-new signup - `docs/KNOWN_ISSUES.md #22`
--    flagged this as suspected but unverified; it wasn't previously noticed because every existing team was
--    created by that one-time backfill, not through this code path.
-- 2) `team_members` only had a `FOR ALL` policy requiring an existing owner/admin row for that team - impossible
--    to satisfy for a team's very first member. The new INSERT policy below allows exactly one thing: a user
--    inserting *themselves* as 'owner' of a team that currently has zero members (i.e. bootstrapping their own
--    new team). It cannot be used to join an existing team or grant any other role.

CREATE POLICY "Authenticated users can create a team" ON public.teams FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "First member of a new team becomes its owner" ON public.team_members FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND role = 'owner'
  AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = team_members.team_id)
);

-- Defense in depth for the `plan` column: team-service's /billing and /settings endpoints already validate this
-- server-side, but a DB-level constraint means no future code path (or a direct DB write) can set anything else.
ALTER TABLE public.teams ADD CONSTRAINT teams_plan_check CHECK (plan IN ('free', 'pro'));
