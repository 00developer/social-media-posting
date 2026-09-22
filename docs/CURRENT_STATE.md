# Current State (snapshot 2026-09-21)

## Git state
- Branch `master`, HEAD `90d94d6 "Fix TS error in accounts page"`. Commit history is only 5 commits, all "Vercel deployment" related (2026-09-18/19). **All feature work since the initial commit is uncommitted** (≈35 changed files, +1,900/−2,350 lines).
- Tracked-but-deleted (working tree): `Blueprint_Package/*` (original blueprint, wireframes, ER diagram, dev prompt), `LinkedIn-integration/*`, `PINTEREST-INTEGRATION/*`, `reels-integration/*`, `youtube-integration/*`. These hold the original requirements/prompts; still recoverable from git (`git show HEAD:Blueprint_Package/DEVELOPMENT_BLUEPRINT.md`). **Do not commit their deletion without deciding they are truly obsolete.**
- Modified: `PROGRESS_REPORT.md`, `apps/web/package.json`, `accounts/page.tsx`, `posts/page.tsx`, `DashboardProvider.tsx`, `DashboardShell.tsx`, every service `src/index.ts` and `dist/index.js`, `services/worker/src/index.ts`.
- Untracked (feature): `apps/web/src/app/dashboard/calendar/`, `supabase/migrations/20260919000000_queue_job_id.sql`, `…000001_threads_schema.sql`, `THREADS_PROGRESS_REPORT.md`, `imple/` (calendar prompt+spec), `thread/` (Threads prompt+spec), `apps/web/package-lock.json`, root `package-lock.json`.
- Untracked (junk / scratch — do **not** commit): `cloudflared.exe` (55 MB), `posts_debug.json` (empty), `download_and_probe.js`, `services/media-service/test-ffmpeg4.js`, `test_out.mp4`, `verify_video.js`. (The two untracked `supabase/migrations/2026091900000*` files are real work, not junk.)
- `services/*/dist/index.js` are **tracked build outputs** and diverge from `src` whenever `src` changes; do not hand-edit, and decide whether they should be tracked at all.
- `.gitignore` has a UTF-16-corrupted tail (`*.txt` then a spaced-out `p a c k a g e - l o c k . j s o n`), so those ignore rules do not work.

## Feature status by area
| Area | State |
|---|---|
| Auth (Supabase email/password) | Works; no email-confirm handling UI, no password reset, no OAuth login |
| Teams / roles / invites | Basic. Auto-team on first login, invite existing users, role checks. No member removal/role edit/rename |
| Billing | Mock plan toggle only |
| Account connect | Twitter, Facebook, Instagram, YouTube, Pinterest, Threads real; LinkedIn URL only; TikTok mock |
| Compose / preview | Working: per-platform preview cards (instagram, tiktok, pinterest, generic), reel toggle, media upload with 480p preview transcode |
| Media processing | Working per platform (images via sharp, video via ffmpeg) |
| Scheduling & queue | Working for the happy path (delayed BullMQ job per platform); no retries, no cancel/edit |
| Publishing adapters | See INTEGRATIONS.md |
| Notifications | In-app via Realtime; email mocked |
| Analytics | Backend sync for YouTube/Pinterest/Threads; UI display effectively broken (see KNOWN_ISSUES) |
| Calendar | **Step 1 implemented (2026-09-21)**: read-only month/week view, aggregate status incl. Partially Published, platform chips + time, per-team refetch, uncached range query; verified via lint/tsc/18 unit tests/build and API calls on real data. **Pending your browser check and manual apply of the `queue_job_id` migration** (missing on the cloud DB). **Step 2 implemented (2026-09-21):** composer extracted into `components/post/*`, `CreatePostModal`, click-to-create with prefill rules, previews that match media-service output, timeline/RLS fixes; a calendar-created Facebook post is verified in DB + queue (scheduled 25 Sep 2026 10:00 IST) but its actual publish has not been observed yet. Steps 3–4 not started |
| Threads | **Ahead of its progress report**: OAuth + adapter + media variant + analytics are all in code; the report still says Step 1 pending. Untested with a real account |
| CI / tests | No tests exist. CI targets branch `main` (repo uses `master`) and calls scripts that don't exist |
| Deployment | Frontend on Vercel; backend local-only |

## Where the previous agent's paperwork is stale
- `PROGRESS_REPORT.md` (Calendar): accurate for Step 1. Says `queue_job_id` "applied to the local Supabase instance"; nothing in code ever writes `queue_job_id`.
- `THREADS_PROGRESS_REPORT.md`: says only Step 1 is partially complete and the migration is pending; the code already contains Steps 1–4 (OAuth, media variant, adapter with quota + polling, analytics sync). It also says to add `THREADS_CLIENT_ID/SECRET` to `.env` — they are already there and used.
- Threads prompt doc says to reuse `META_CLIENT_ID`; the implementation chose separate `THREADS_CLIENT_*` credentials.

## Immediate open item the previous session ended on
Threads: waiting on (a) Meta developer-portal confirmation that the Threads app/credentials are the right ones and the redirect URI `<API_BASE_URL>/api/v1/auth/threads/callback` is registered, (b) applying `20260919000001_threads_schema.sql` to the DB that `.env` points at (without it the `social_accounts_platform_check` constraint will reject `'threads'` inserts, if the constraint is the older version), (c) an end-to-end test with a real Threads test account.
