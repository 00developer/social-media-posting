# RESUME HERE — Calendar work handover

Written 2026-09-21 ~19:30 IST at the end of a long session. **Read this first**, then continue with "Next steps". Everything here was checked against the code/DB at that time; where something was *not* verified it says so.

## 00. START HERE TOMORROW (state at end of 2026-09-22)
**Latest state supersedes older text below** (§0, §2.2, §2.3 and §3 are historical: Step 3 is fully done, S3.5/S3.6 finished, the 404 dev-server issue was a one-off).
- ✅ Done and verified: Calendar Steps 1–3; Reels 9:16 fix; header notification bell (migration `20260922000000` applied by owner); **failure notifications + automatic retries + Retry button** (details: §2.5, BUSINESS_LOGIC §5, KNOWN_ISSUES #6/#8/#45–49, PROGRESS_REPORT).
- Tests at hand-over: **227 unit tests** (`cd apps/web && npm test`), `tsc` + ESLint clean, `node docs/dev-scripts/retry-e2e.js` **42 PASS** (needs worker + notification-service running; writes scratch data to Supabase/Redis and cleans up, ~3 min).
- 🟡 **Owner to do first (browser, not yet verified by anyone):** (1) timeline: a failed post shows the per-platform error + **"Retry failed (n)"**; an automatically-retried job shows an amber "Attempt n/3 failed… Retrying automatically" note; (2) calendar: click a failed event → modal has **"Retry failed platforms (n)"**; (3) bell shows the failure notification. KNOWN_ISSUES #49.
- ⏳ Not started (needs a plan + owner approval first): **Calendar Step 4** (drag to reschedule, §2.4), **Step 5** (drafts view). Whole-project backlog: `docs/PENDING_WORK.md`.
- ⚠ Still open: the real test post `85e737cb…` publishes **23 Sep 10:00 IST** to real accounts (landscape variants, uploaded before the 9:16 fix); its 4 queued jobs predate the retry change and get the full 3 attempts (#48). Step 2's "calendar-created post publishes at its time" was never observed.
- Nothing is committed to git. Services must be running (worker, notification, scheduling, post, publishing, media); check with `node docs/dev-scripts/queue.js`.
- Never `next build` while `next dev` runs. Never build retry logic on BullMQ `attemptsMade` (use `job.data.failures`).

## 0. TL;DR
- We are building the **Calendar** feature of SocialPush step by step (spec: `imple/CALENDAR_INTEGRATION_DEVELOPMENT.md` + `imple/CALENDAR_ANTIGRAVITY_PROMPT.md`).
- **Step 1 (read view): done.** **Step 2 (click a day → create post): done, one check still open** (a calendar-created post has not been seen *publishing* yet). **Step 3 (click an event → edit caption): S3.0–S3.4 done, S3.5 and S3.6 remain.**
- Nothing has been committed to git. All work is in the working tree.
- Immediate to-do for the owner: **restart the web dev server** (it answers 404 on every route — see §3).
- S3.5 (event click → `EditPostModal`) is **implemented** (2026-09-22). Next task: **S3.6 — verification + report** (§2.3), which starts with the owner clicking an event in the browser.

## 1. Status board

| Step | Status | Evidence / what's open |
|---|---|---|
| Calendar 1 — read view | ✅ Done | Real posts show at the right day/time with status colours (owner's screenshots). Processing / Partially Published / Failed colours are unit-tested only (no real post in those states). |
| Calendar 2 — create from a day | ✅ Done, 1 open check | Modal, prefill (`09:00` / next hour), past-day notice, single-scroll modal, reel warning confirmed by screenshots. DB rows + BullMQ job of a calendar-created post were verified identical in shape to a sidebar-created one. **Open:** a calendar-created post publishing at its time was never observed (the only post publishes 23 Sep 10:00 IST). Also unconfirmed by the owner: hover "+", Esc/backdrop/X, scroll lock, draft notice, timeline thumbnails, viewer role. |
| Calendar 3 — edit caption | ✅ Done (2026-09-22) | S3.0 baseline ✅ · S3.1 backend `PATCH` ✅ (37/37 real HTTP checks) · S3.2 helpers ✅ · S3.3 modal shell ✅ · S3.4 `EditPostModal` ✅ (render-tested only) · S3.5 calendar wiring ✅ (code; **not yet clicked in a browser**) · S3.5 wiring ✅ · **S3.6 ✅: real-post proof (HTTP and the owner's own browser edit) — all invariants held both times; final report in `PROGRESS_REPORT.md`.** Unconfirmed UI items: read-only/viewer view, Esc/backdrop/X while saving, "+N more", hover "+" |
| Calendar 4 — drag to reschedule | ⏳ Not started | Needs its own plan (see §2.4). |
| Calendar 5 — drafts / "No Date" view | ⏳ Not started (optional) | |

Automated state at hand-over: **118 unit/render tests pass** (`cd apps/web && npm test`), `tsc --noEmit` clean, ESLint clean on `src/lib`, `src/components`, `posts/`, `calendar/`. The last successful `next build` was before the vitest config/test files were added (they aren't part of the bundle).

## 2. Next steps (in order)

### 2.1 Before touching code
1. Owner restarts `next dev` for `apps/web` (§3). If it still 404s, delete `apps/web/.next/dev` and start again.
2. Confirm the backend services are running with the **new Redis** (they were restarted once; PIDs changed). `node docs/dev-scripts/verify_redis.js` and `node docs/dev-scripts/queue.js` should show 4 delayed jobs at 23 Sep 04:30 UTC.
3. Re-read `docs/CALENDAR_STEP3_BASELINE.md` (decisions, snapshot, invariants).

### 2.2 S3.5 — calendar wiring — ✅ DONE in code (kept for reference; browser check pending → S3.6)
What was built: `lib/calendarEvent.ts` (`toEvent` now puts the whole post in `extendedProps.post`; unit-tested), `eventClick` + `eventInteractive` in `calendar/page.tsx` opening `EditPostModal` for **all roles** (viewer → read-only; only one of create/edit modal open at a time), `onSaved` → `refetchEvents()` + provider `fetchTeamData()`, `onOutdated` (409) → `refetchEvents()`, pointer cursor via `.calendar-events-clickable .fc-event` in `globals.css`. `EditablePostRecord` type moved to `lib/calendarEdit.ts`. Verified so far: tests (118), `tsc`, ESLint, and the **real DB post** run through `toEvent` + `EditPostModal` (4 platforms, all Scheduled, caption, Threads counter, 9:16 reel frame, Save disabled). **Not yet verified in a browser:** the click itself, the "+N more" popover, that clicking an event does not also open the create modal, Save round-trip, and the cursor. Original to-do list:
- `toEvent()` currently keeps only `statusLabel` and `platforms` in `extendedProps`; add the **whole post record** (`content`, `media_url`, `status`, `publish_jobs` incl. `error_message` / `content_type`, `schedules`) — the range endpoint already returns all of it.
- Add `eventClick` (works for **all roles**): open `<EditPostModal post userId teamId isViewer={!canCreate} onClose onSaved onOutdated />`. Only one modal at a time (opening create closes edit and vice-versa). Mount only while open (`{editing && <EditPostModal …/>}`) so state is fresh.
- `onSaved` → `calendarRef.current?.getApi().refetchEvents()` **and** the provider's `fetchTeamData()` (pass it down from `CalendarPage` via `useDashboard()`), so the timeline updates too. `onOutdated` (server said 409) → refetch so the colour/status is current.
- Pointer cursor on events for everyone (CSS in `globals.css`, next to the `.calendar-creatable` rules); consider `eventInteractive` for keyboard access.
- Check that events inside the "+N more" popover are clickable, and that clicking an event does **not** also open the create modal.
- Keep `TeamCalendar` keyed by team id (team switch already remounts and closes modals).
- Don't run `next build` while `next dev` runs (§6). Verify with `tsc`, ESLint, tests.

### 2.3 S3.6 — verification and report
1. `node docs/dev-scripts/s31_tests.js` (post-service must be up) → expect 37 passed.
2. Real test post (§4): owner edits the caption from the calendar, then compare with the baseline **invariants** in `CALENDAR_STEP3_BASELINE.md` §3 using `node docs/dev-scripts/snap.js 85e737cb-0b8a-4688-a0f4-37b1b489bba1 <file>` before and after: same post id; only `content` and `updated_at` changed; same 4 schedule rows; same 4 job rows; same 4 queue jobs (compare ids / state / `runsAt`, **not** `delay`); totals still `posts=1, schedules=4, publish_jobs=4`.
3. **Restore the caption exactly** afterwards: `"A test video\nsfvsfvsi\n#ajbca\n#jabiua"` (JSON-escaped; `\n` are newlines). Owner consented to change-and-restore.
4. Owner runs the manual checklist E1–E7 (`CALENDAR_STEP3_BASELINE.md` §5) plus the still-unconfirmed Step 2 items (§1).
5. Ideal end-to-end proof (also closes Step 2's open check): owner schedules a **Facebook-only** post a few minutes ahead from the calendar, edits its caption before it fires, then we watch the job go `completed` and the Page shows the **edited** caption (the worker reads the post fresh at publish time).
6. Write the Step 3 report in `PROGRESS_REPORT.md` using the prompt format (What was built / Self-check performed / Issues found & fixed / Known limitations / Waiting for approval to start Step 4), move "in progress" text out, and update `docs/CURRENT_STATE.md`, `COMPLETED_WORK.md`, `KNOWN_ISSUES.md`, `FILE_MAP.md`.

### 2.4 After Step 3 (only with the owner's go-ahead)
- **Step 4 — drag to reschedule** (needs a plan first): `PATCH /api/v1/posts/:postId/reschedule` in a service that owns the BullMQ queue (scheduling-service, or post-service with its own ioredis connection — **not** the Upstash REST client). Facts to build on: BullMQ 4.18.3 has `job.changeDelay()`; job id == `publish_jobs.id`; the time lives in `schedules.scheduled_at` (there is **no** `publish_jobs.scheduled_at`); `queue_job_id` exists but nothing writes it; "only draggable when every latest job is `scheduled`" must be enforced server-side too; retries leave old `failed` jobs behind, so always use the *latest job per platform* (helpers exist in `lib/calendarStatus.ts` / server `editability.ts`). Also invalidate caches and reject past times.
- **Step 5 — Drafts / No Date view** (optional).
- Spec gaps to remember: no "Partially Published" job-level status exists (derived client-side); timezone is a label, not a selector; composer stays the *only* create path.

### 2.5 Follow-up fixes after Step 3 (2026-09-22)
- ✅ **Reels/Shorts 9:16 regression fixed** (`services/media-service/src/videoFilter.ts`, KNOWN_ISSUES #20f; e2e-verified with `docs/dev-scripts/media-e2e.js`; preview frames and reel warning synced; the existing 23 Sep test post still has landscape variants).
- 🟡 **Sidebar "Updates" -> header notification bell** (KNOWN_ISSUES #44): implemented and render-tested; **the owner must run `supabase/migrations/20260922000000_notifications_read_and_realtime.sql`** in the SQL editor (UPDATE policy for the `read` column + Realtime publication), then re-run `node docs/dev-scripts/realtime-check.js` (expect PASS). Failure notifications + retries: done, see next bullet.
- ✅ **Failure notifications, automatic retries and the Retry button (2026-09-22):** worker-managed retries (3 attempts, 1/2 min backoff, permanent errors fail at once), notification-service crash fixed, `POST /api/v1/posts/:postId/retry`, timeline "Retry failed (n)" + calendar modal "Retry failed platforms (n)", TikTok stub now fails honestly. Verified: `docs/dev-scripts/retry-e2e.js` 42/42, 227 unit tests, tsc/ESLint clean, real test post 85e737cb… unchanged. **Not verified:** the buttons in a browser. Details: BUSINESS_LOGIC §5, KNOWN_ISSUES #6/#8/#45-49.

## 3. Environment right now (2026-09-21 evening)
- **Web dev server (`next dev`, :3000) answers 404 on every route.** Cause: a `next build` I ran while it was running corrupted `.next/dev/types/routes.d.ts` + `validator.ts` (I deleted those two generated files; the 404 remained). **Restart it.**
- Backend services were restarted by the owner after the Redis swap: web `:3000`, post `:3002` (ts-node-dev, reloads on `src` change), publishing `:3003`, scheduling `:3004`, media `:3006` (+ worker, notification, analytics, team, account). Check they are up before testing.
- **Redis was replaced** with a new empty Upstash database; `.env` (gitignored) holds the new `REDIS_URL` / `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. The credentials were pasted in chat once — rotate them if this database matters. The 4 scheduled jobs were re-queued afterwards (`docs/dev-scripts/requeue.js`).
- Supabase (cloud) migrations the owner applied by hand: `20260919000000_queue_job_id` ✅, `20260921000000_restore_read_policies` ✅ (verified: the browser user sees `schedules` / `publish_jobs` / `notifications` / `analytics` again). Pinterest migrations and several columns are **not** on the cloud DB (see `docs/DATABASE.md` drift list) — Pinterest/LinkedIn cannot work on it.
- Connected accounts on the cloud DB: instagram, youtube, facebook, threads (1 each). Text-only posts can go to facebook/threads; instagram needs media; youtube needs video.

## 4. The live test data (⚠ real accounts)
| | |
|---|---|
| Team (owner's "My Personal Team") | `6c62811d-e160-4077-8d76-47fa62b7c61a` |
| Owner user | `47852654-b6fa-4e8d-ab40-f0b04361b9fc` |
| The only post | `85e737cb-0b8a-4688-a0f4-37b1b489bba1`, a **4-platform reel** (facebook, instagram, youtube, threads) |
| Scheduled for | **23 Sep 2026 10:00 IST** (04:30:00 UTC) — it **will publish to those real accounts** if worker + publishing-service are running then |
| publish_jobs | facebook `8c5e9461-5fba-4599-96b0-293c325360ec` · instagram `a879498b-e8b4-408d-874e-194ff8562d61` · youtube `1ad76ccb-66c5-4bc9-a6c9-412e94cb7acd` · threads `865821ef-1b64-4794-bbe2-b870f52e6fda` (all `scheduled`, `content_type=reel`) |
| Original caption | `"A test video\nsfvsfvsi\n#ajbca\n#jabiua"` |
To stop it publishing: delete the post from the timeline **and** remove its 4 jobs from the queue (deleting a post does **not** cancel queued jobs — `KNOWN_ISSUES` #18; the job would then 404 harmlessly), or stop the worker.

## 5. How we work (owner's protocol — keep following it)
- One step at a time: **plan → owner approves → build only that step → self-check (tsc, ESLint, tests, real checks) → honest report → stop and wait for approval.** Never start the next step on your own.
- Owner answers in Hinglish (Hindi in Latin script); reply in the same style, concise, with clear "verified vs not verified".
- Show a **plan first** when asked "plan banao"; don't implement until they say start.
- Ask before: writing to the cloud DB, real publishes, replacing/deleting data, running anything that touches the queue. Scratch data is fine when consented (Step 3: scratch draft/team + changing then restoring the test post's caption).
- Report failures/surprises plainly (several earlier "complete" claims by the previous agent were wrong; this session found them by testing against the real DB).
- Never print or write secrets. `.env` is gitignored; don't put tokens in docs, scripts or commits.
- The owner tests in the browser; describe exactly what to click/look for. I cannot log in to the dashboard.

## 6. Gotchas learned the hard way
- **Never run `next build` while `next dev` is running** (races on `.next`, corrupts generated types, breaks the dev server). Use `tsc --noEmit` + ESLint + `npm test`; build only if dev is stopped.
- **Git Bash drops `TZ=`** when launching Node → run timezone tests from PowerShell (`$env:TZ='America/New_York'`).
- `posts.updated_at` is **not** maintained by the DB on the cloud instance (trigger ineffective) → writers must set it (`PATCH` does).
- RLS on the cloud DB had been missing for `schedules`, `publish_jobs`, `notifications`, `analytics` (fixed by the migration above); teammates still can't see each other's rows (policies are user-scoped).
- The composer must stay the **only** UI path that creates posts (Step 2's "identical records" guarantee).
- `promote-jobs.js` (repo root) publishes every scheduled post immediately — do not run it.
- FullCalendar is pinned to 6.x everywhere (`@fullcalendar/react` was downgraded from 7.1.0).
- vitest needs relative imports inside `src/lib`; components use the `@` alias (configured in `apps/web/vitest.config.mts`).
- The previous agent's `THREADS_PROGRESS_REPORT.md` is stale (Threads code goes beyond it, still untested with a real account).

## 7. What happened, in order (session log)
| # | What | Result |
|---|---|---|
| 1 | Read-only audit of the whole repo | 14 docs in `docs/` (overview, architecture, flows, DB, API, integrations, known issues…). |
| 2 | Analysed the two `imple/` calendar specs and `PROGRESS_REPORT.md` | Spec assumptions that don't match the code (no create modal, no UTC util, no aggregate-status logic, `publish_jobs.scheduled_at` doesn't exist…); old "Step 1 complete" claim was wrong. |
| 3 | **Step 1 completed** | Range endpoint bug fixed (500 from a `user:user_id(email)` embed), uncached + validated range queries, `lib/calendarStatus.ts`, new calendar page (chips, legend, timezone label, per-team remount), FullCalendar 6.x, first tests. |
| 4 | **Step 2** (S2.0–S2.6) | Composer extracted verbatim into `components/post/*`, `CreatePostModal`, click-to-create, `lib/calendarPrefill.ts`, hover "+" CSS, notices, viewer guard. Baseline: `docs/CALENDAR_STEP2_BASELINE.md`. |
| 5 | Bugs found while testing | Timeline showed `created_at` instead of the schedule date → root cause **live-DB RLS gap** (browser saw 0 rows in 4 tables) + provider didn't fetch `schedules`; fixed (`restore_read_policies` migration + provider embed). Previews didn't match real crops → `lib/mediaFrame.ts` + reel-orientation warning + single-scroll modal. |
| 6 | Calendar-created Facebook post verified | DB rows + BullMQ job identical in shape to sidebar posts; job fires exactly at `scheduled_at`. (Publish itself not observed.) |
| 7 | Step 3 plan + decisions | Caption only; editable unless a latest job is `processing`/`completed`; separate form in shared modal shell; viewers read-only; Threads 500-byte rule like the adapter. |
| 8 | S3.0 baseline | `docs/CALENDAR_STEP3_BASELINE.md`. |
| 9 | S3.1 backend | `PATCH /api/v1/posts/:id` + `services/post-service/src/editability.ts`; found DB `updated_at` trigger not effective → set explicitly; 37/37 HTTP checks; real post untouched. |
| 10 | S3.2 helpers | `lib/calendarEdit.ts` (+ parity tests against the server rules over 101 job combinations). |
| 11 | S3.3 | `PostModalShell` extracted from `CreatePostModal` (pure move, diff-proven). |
| 12 | Redis replaced by owner | `.env` updated (3 lines), verified, 4 jobs re-queued, baseline updated. |
| 13 | S3.4 | `EditPostModal` + 21 SSR render tests + `vitest.config.mts`; `next build` incident (§3, §6). |

## 8. Files touched by this work
**New:** `docs/` (this folder), `docs/dev-scripts/`, `apps/web/src/components/post/{PlatformPreviewCard,PostComposer,CreatePostModal,PostModalShell,EditPostModal}.tsx` (+ `EditPostModal.test.tsx`), `apps/web/src/lib/{calendarStatus,calendarPrefill,calendarEdit,mediaFrame}.ts` (+ tests), `apps/web/vitest.config.mts`, `services/post-service/src/editability.ts`, `supabase/migrations/20260921000000_restore_read_policies.sql`.
**Modified by this work:** `apps/web/src/app/dashboard/calendar/page.tsx` (rewritten), `.../posts/page.tsx` (composer moved out, thumbnails/timeline date), `apps/web/src/app/globals.css` (calendar CSS), `apps/web/src/components/DashboardProvider.tsx` (`schedules(*)` embed), `apps/web/package.json` (FullCalendar react 6.x, vitest, `test` script), `services/post-service/src/index.ts` (+ tracked `dist/`: range fix, `PATCH`), `PROGRESS_REPORT.md`, lock files (untracked).
**Modified earlier by the previous agent (not by this work):** `accounts/page.tsx`, `DashboardShell.tsx`, other services' `src`/`dist`, `THREADS_PROGRESS_REPORT.md`, migrations `…000000_queue_job_id`, `…000001_threads_schema`.
**Untracked junk, do not commit:** `cloudflared.exe`, `posts_debug.json`, `download_and_probe.js`, `services/media-service/{test-ffmpeg4.js,test_out.mp4,verify_video.js}`. The deleted `Blueprint_Package/`, `*-integration/` folders are still in git history (`git show HEAD:<path>`).

## 9. Commands
```
# tests / checks (from apps/web)
npm test                       # 118 tests (vitest: lib + SSR render tests)
npx tsc --noEmit
npx eslint src/lib src/components src/app/dashboard/posts src/app/dashboard/calendar
# (2 old ESLint errors remain in accounts/page.tsx and settings/page.tsx — not ours)

# backend check (post-service must be running on :3002)
node docs/dev-scripts/s31_tests.js       # 37 checks, scratch team only

# queue / redis
node docs/dev-scripts/queue.js
node docs/dev-scripts/snap.js <postId> [out.json]
node docs/dev-scripts/verify_redis.js
node docs/dev-scripts/requeue.js --dry   # then without --dry only if jobs are missing

# run everything
npm run dev:all   (root)     # or: npm run dev -w apps/web  and the individual dev:* scripts
```

## 10. Where the details live
`PROGRESS_REPORT.md` (Step 1–3 reports) · `docs/CALENDAR_STEP2_BASELINE.md`, `docs/CALENDAR_STEP3_BASELINE.md` (baselines, invariants, checklists) · `docs/KNOWN_ISSUES.md` (all bugs; #18, #20b–20e are the newest) · `docs/DATABASE.md` (drift + RLS) · `docs/API_MAP.md` (incl. the new `PATCH`) · `docs/FILE_MAP.md` · `docs/PENDING_WORK.md` (whole-project backlog: auth, retries, token refresh, LinkedIn/TikTok, hard-coded localhost URLs…) · `docs/archive/` (the previous agent's original project report).
