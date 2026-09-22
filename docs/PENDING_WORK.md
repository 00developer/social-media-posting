# Pending Work

Priorities are a recommendation from the audit, not a statement from the product owner. Confirm with the owner before starting anything large. The previous workflow was strictly step-by-step with a stop after each step; keep that discipline unless told otherwise.

## P0 — Unblocks the in-flight work (Threads + Calendar)
1. **Reconcile DB state**: check which migrations are applied to the DB in `.env` (`supabase migration list`); apply `20260919000000_queue_job_id.sql` and `20260919000001_threads_schema.sql` there. Dump/compare the live schema to detect the drift listed in DATABASE.md (missing `provider_account_id`, `handle`, `status`, `media_variants`; teams INSERT policies).
2. **Threads end-to-end test** with a real Threads tester account: connect → verify row in `social_accounts` → publish text/image/video → confirm notification and analytics. Decide: add `threads_manage_insights` scope, character-vs-byte limit, UI counter.
3. **Calendar Steps 2–4** (per `imple/CALENDAR_INTEGRATION_DEVELOPMENT.md`):
   - Step 2 create-from-date (`dateClick` → open composer prefilled) — the composer is inline in `posts/page.tsx`, not a modal, so it needs extracting into a shared component first.
   - Step 3 click-to-edit — **there is no update-post endpoint**; needs `PATCH /posts/:id` plus edit UI.
   - Step 4 drag-to-reschedule — needs `PATCH /api/v1/posts/:postId/reschedule`; must cancel/re-add BullMQ jobs (`queue.getJob(publish_jobs.id)` works because `jobId == publish_jobs.id`; `queue_job_id` is currently unused), update `schedules`/`publish_jobs`, invalidate caches, reject non-`scheduled` posts, be all-or-nothing. Also needs a "Drafts / No date" view and "Partially Published" status colour.

## P1 — Correctness of what already exists
4. Make retries real: `attempts` + `backoff` on `queue.add`, throw `DelayedError` after `moveToDelayed`, update `posts.status` and notify on the first terminal failure, fix "all jobs completed" so retried posts can become `published`.
5. Fix publishing lookups to be team-aware (`team_id`, and support multiple accounts per platform); Facebook page selection.
6. Token refresh for Meta/Threads (60-day), Pinterest, LinkedIn; surface `refresh_token_expires_at` consistently.
7. Finish LinkedIn OAuth callback (code exchange, profile → `provider_account_id`, org selection) and store `handle` for all platforms so the Accounts page can show which account is connected.
8. Analytics UI: set `team_id` on inserted rows (or drop the team filter), show analytics for published posts, decide a real meaning for `shares`.
9. Pinterest media URL bug; non-reel video handling for Facebook/Instagram; Twitter media upload.
10. TikTok: real integration or remove from the platform lists.

## P1 — Security / production readiness
11. Real authentication for services: verify the Supabase JWT (`Authorization: Bearer`), derive `userId` from it, stop trusting query/body ids; restrict CORS; validate inputs.
12. Remove the hardcoded fallback `ENCRYPTION_KEY`; plan a key rotation/migration strategy first (existing tokens depend on the current value). Consider authenticated encryption (AES-GCM).
13. Persist OAuth `state` (Redis/DB with TTL) instead of an in-memory Map.
14. Config: `NEXT_PUBLIC_API_*` base URLs in the frontend, service URLs via env for worker/publishing/analytics; make services deployable (Dockerfiles, `.dockerignore`), stop tracking `dist/`.
15. Fix RLS gaps (team-scoped policies for `schedules`, `publish_jobs`, `analytics`, `notifications`; teams INSERT/bootstrap through a server endpoint or security-definer function; `posts` delete policy).

## P2 — Product features referenced but missing
- Edit post / edit draft; delete cancels queued jobs; per-platform text variants; character counters (X 280, Threads 500, etc.).
- Team management UI (remove member, change role, pending invites by email, rename team).
- Real billing (Stripe or similar) replacing the mock toggle; production values for plan limits.
- Real email delivery in notification-service.
- Carousels (Threads/Instagram), Stories, hashtags/first-comment, link previews.
- Analytics dashboard page (aggregate views), Facebook/Instagram/LinkedIn/Twitter metrics.
- Password reset, email confirmation UX, profile page.

## P3 — Engineering hygiene
- Automated tests (none exist), lint/type-check scripts so CI does something; fix CI branch (`main` vs `master`).
- Shared package for types, Supabase client, authz helper, adapter interface; split `posts/page.tsx` and `publishing-service/src/index.ts` (789 lines) into modules.
- Remove debug code (`console.log('DEBUG POSTS')`), scratch files, `scaffold-*.mjs`, `scratch_init.sql`, `cloudflared.exe` from the tree; fix `.gitignore` encoding.
- Update `.env.example` (missing most keys), page metadata ("Create Next App"), README (mentions TikTok as supported; Threads and Calendar absent).
- Align FullCalendar package versions (`@fullcalendar/react ^7.1.0` vs plugins `^6.1.21`) and remove the `as any` casts.
- Commit the work in logical chunks — the entire feature history currently exists only in the working tree.
