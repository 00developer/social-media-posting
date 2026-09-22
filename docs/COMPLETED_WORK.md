# Completed Work (exists in code; "completed" ≠ "tested")

Ordered roughly by the migration/phase history (Phase 0–5, then per-platform integrations).

## Foundation (Phases 0–5, 2026-09-16)
- Monorepo with npm workspaces; nine backend services + `packages/shared`; Next.js app. Scaffolding scripts (`scaffold-*.mjs`) generated the initial service skeletons.
- Supabase schema, RLS, updated-at trigger, Storage bucket, teams/roles with data migration of pre-existing users.
- Email/password auth; dashboard shell with sidebar, team switcher, plan badge, notification panel, logout.
- Team model: roles, role cache, invite by email (existing users), owner-only plan toggle, plan limits (10 accounts / 500 posts).
- Publishing pipeline: schedule → BullMQ delayed job → worker → publishing-service adapter → notification → Realtime UI refresh.
- Media pipeline: per-platform image variants (sharp) and video transcoding (ffmpeg), Storage upload with 3 retries, 480p browser preview transcode.
- Redis-backed feed cache, per-user publish rate limit, real-time analytics counters + 5-min sync cron.

## Platform integrations (2026-09-18/19)
- **YouTube** — OAuth (offline), resumable upload, session table, Shorts support, processing poll, token refresh endpoint, statistics sync.
- **Reels/Shorts** — `content_type` on `publish_jobs`; UI "Standard Post / Reel" toggle; duration validation per platform (YouTube ≤180 s, Instagram ≤90 s, Facebook 3–90 s); Facebook Reels 3-phase upload with 30/24 h guard; Instagram Reels container flow.
- **LinkedIn** — schema for member vs organization targets, REST adapter (image/video upload + post), UI expiry warning component. (OAuth callback still mock.)
- **Pinterest** — OAuth, board import, default board, image + video pin adapter, `pinterest_published_pins`, analytics sync, 1000×1500 image variant, preview card.
- **Threads** — OAuth (long-lived token), adapter (byte-length check, quota endpoint, container polling), media variants (image ≤1440 px, video ≤300 s), analytics sync by text match, platform added to both frontend lists.

## Calendar feature — Step 1 of 4 (started 2026-09-19, finished 2026-09-21)
- Migration file adding `publish_jobs.queue_job_id` + `idx_schedules_scheduled_at` (**not applied on the cloud DB** as of 2026-09-21).
- `GET /api/v1/posts?from&to` range query (inner join on schedules); now uncached, validated, and without the failing `user:user_id(email)` embed.
- FullCalendar (aligned to 6.1.21) month/week read-only view; `apps/web/src/lib/calendarStatus.ts` derives one aggregate status per post (Scheduled / Processing / Published / Partially Published / Failed) from the latest job per platform; platform chips, local time, legend, timezone label; per-team remount.
- First automated tests in the repo: vitest, `apps/web/src/lib/calendarStatus.test.ts` (18 cases), `npm test` in `apps/web`.
- Old project-level progress report archived in `docs/archive/`.

## Calendar feature — Step 2 of 4 (2026-09-21)
- Composer extracted from `posts/page.tsx` into `PostComposer` (+ `PlatformPreviewCard`), proven verbatim by diff; `CreatePostModal` shell; click-to-create on the calendar (`dateClick`, hover "+" via CSS, prefill rules in `lib/calendarPrefill.ts`, past-day and draft notices, viewer guard, refetch after create).
- Previews now follow the real media output (`lib/mediaFrame.ts`): cropped platforms use `object-cover` in their ratio, others keep the natural ratio, reels are 9:16 with a landscape warning; timeline thumbnails share the rules.
- Fixed a pre-existing timeline bug (scheduled date missing) and a live-DB RLS gap (`supabase/migrations/20260921000000_restore_read_policies.sql`).
- Tests: 53 (calendar status, prefill, media frame). Baseline and regression checklist: `docs/CALENDAR_STEP2_BASELINE.md`.

## Frontend polish
- Platform-specific live preview cards (Instagram, TikTok, Pinterest, generic feed) with video/image handling; multi-platform preview modal on timeline cards; optimistic "uploading" card; failure reason surfaced on cards; Retry button.

## Deployment groundwork
- Vercel build fixes (lightningcss/native binary handling, TS fix), README, `.gitignore`, illustrative Docker Compose (Redis) and Kubernetes manifests, k6 load-test script (points at a non-existent `/health`).

## Calendar feature — Step 3 of 4 (2026-09-22): click-to-edit caption
- `PATCH /api/v1/posts/:id` (caption only; 409 once any platform's latest job is processing/completed; Threads 500-byte rule; team-scoped; sets `updated_at`), `services/post-service/src/editability.ts`, 37 real HTTP checks (`docs/dev-scripts/s31_tests.js`).
- `lib/calendarEdit.ts` + `lib/calendarEvent.ts` (parity-tested against the server), `PostModalShell`, `EditPostModal`, calendar `eventClick`. 118 tests total.
- Proven on the real post: caption edits (via HTTP and by the owner in the browser) change only `content` / `updated_at`; schedules, jobs and BullMQ jobs stay identical. See `PROGRESS_REPORT.md`.
