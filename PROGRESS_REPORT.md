# Calendar Integration — Progress Report

Previous project-level report (YouTube Shorts, Reels, notifications, LinkedIn Step 1) was overwritten by an earlier Calendar report; it is archived at `docs/archive/PROJECT_PROGRESS_REPORT_2026-09-19.md`. Its LinkedIn claims (OAuth callback + 60-day refresh in account-service) do **not** match the code — only the authorize URL exists.

## Failure notifications, automatic retries and Retry button (2026-09-22)
- **Root causes:** jobs had no retries (first failure was final); the worker notified only after >3 retries (never); notification-service had died on an unhandled ECONNRESET so queued notifications were never delivered; the TikTok adapter reported false success.
- **Built:** worker-managed retries (3 attempts, 1 min / 2 min backoff, permanent errors fail at once), failure notification with the reason, post status derived from the latest job per platform, `POST /api/v1/posts/:postId/retry`, timeline "Retry failed (n)" + per-platform errors/retry notes, calendar modal "Retry failed platforms (n)", TikTok now fails honestly.
- **Verified:** `docs/dev-scripts/retry-e2e.js` 42/42 on the running services (scratch data, cleaned up); 227 unit tests; tsc + ESLint clean; the real 23 Sep test post and its 4 queued jobs unchanged. **Not verified:** clicking the buttons in a browser.

## Follow-up fixes after Step 3 (2026-09-22) - Reels/Shorts 9:16 and the notifications bell

### 1. Reels/Shorts were uploaded as normal landscape videos (KNOWN_ISSUES #20f) - fixed
- **Cause (verified with ffprobe on the real post):** `content_type=reel` reached the DB correctly, but the previous agent's uncommitted Threads change to `media-service` `processVideo` replaced the committed "scale + pad onto a 9:16 canvas" logic with "keep the source aspect ratio", so the YouTube/Instagram/Facebook reel variants stayed 1080x608 landscape and YouTube published a normal video.
- **Fix:** `services/media-service/src/videoFilter.ts` (`getVideoFilter`): reels -> 1080x1920 padded for every platform except Threads; standard videos -> platform canvas; Threads -> natural aspect. Restoring the old canvases exposed a latent bug (Facebook `1920:1005` has an odd height and makes ffmpeg fail) -> now `1920:1006`. Preview frames (`lib/mediaFrame.ts`) and the reel warning (now "will sit inside the 9:16 frame with black bars", never for Threads) synced.
- **Verified:** `docs/dev-scripts/media-e2e.js` - 3 clips (landscape/vertical/square) x reel/post x 6 platforms through the real upload endpoint, measured with ffprobe: **40/40**, padding geometry confirmed, scratch files deleted. 127 tests, `tsc`, ESLint clean. **Not affected:** posts already uploaded keep their old landscape variants (the 23 Sep test post).

### 2. "Updates" panel (KNOWN_ISSUES #44) - UI done, one migration for the owner
- Sidebar box removed; **bell with unread badge in the sticky header**, dropdown with full text, relative times, "New" highlight (opening marks unread as read), "Mark all read", older-than-7-days behind "Show older (n)"; polling every 30 s while the tab is visible; session-local read memory.
- **Findings:** the DB refuses "mark as read" (verified: 0 rows changed) and **Realtime does not deliver `notifications` INSERTs** (verified: no event in 30 s) -> `supabase/migrations/20260922000000_notifications_read_and_realtime.sql` (column-level UPDATE on `read` + Realtime publication) must be run by the owner; afterwards re-run `docs/dev-scripts/realtime-check.js`.
- **Verified:** 33 new tests (helpers + render of bell/list); the owner's real 30 notifications render correctly. 160 tests total, `tsc`, ESLint clean. No `next build` (dev server rule). **Not verified in a browser:** placement/appearance, opening/closing, mark-read behaviour.
- **Not done (separate step):** failure notifications never fire because retries never happen (KNOWN_ISSUES #6).

---

## Calendar Step 3 — Click-to-Edit Existing Post — Complete (caption edit); a few UI checks still unconfirmed

Scope agreed with the owner: **caption only** (time = Step 4; platforms / media = later). Baseline, decisions and invariants: `docs/CALENDAR_STEP3_BASELINE.md`.

### What was built
- **Backend:** `PATCH /api/v1/posts/:id` in post-service (+ pure rules in `services/post-service/src/editability.ts`). Body `{userId, teamId, content}`. 400 for bad ids / empty / non-string / > 10 000 chars / Threads text > 500 UTF-8 bytes; 403 non-member or viewer; 404 wrong team or unknown post; **409 `NOT_EDITABLE`** when any platform's latest job is `processing` or `completed`; `200 unchanged:true` (no write) for identical text. Writes only `posts.content` + `updated_at` (set explicitly because the DB trigger is not effective), never schedules / jobs / queue; invalidates the feed cache.
- **Frontend helpers (`lib/calendarEdit.ts`, `lib/calendarEvent.ts`):** per-platform status list (latest job per platform, error message, schedule time), `getEditability` (mirrors the server; **parity-tested against the server rules over 101 job combinations**), caption validation (empty / 10 000 / Threads bytes), media-map parsing, `toEvent` carrying the whole post in `extendedProps`.
- **UI:** `PostModalShell` extracted from `CreatePostModal` (pure move, diff-proven); new `EditPostModal` (caption textarea, character + Threads byte counter, per-platform status badges with errors and times, live preview with the Step 2 frame rules, Save / Cancel or Close, busy-block while saving, server errors shown inline, read-only mode with the reason); calendar `eventClick` opens it for every role (viewer read-only), only one modal at a time, save → `refetchEvents()` + timeline refresh, 409 → refetch, pointer cursor.

### Self-check performed
- Lint (`src/lib`, `src/components`, `posts`, `calendar`): **pass, 0 warnings**. Type-check: **pass**. Tests: **118 passed / 0 failed** (status 18, prefill 14, media frame 21, calendar edit 35 incl. parity, calendar event 9, edit-modal SSR render 21). `s31_tests.js`: **37/37** real HTTP checks (scratch team, deleted afterwards). No `next build` was run in this stretch (dev server was running); the last successful build predates only test/config files.
- **Real post, real DB, real queue** (`85e737cb…`, 4-platform reel, 23 Sep 10:00 IST), snapshots compared with `docs/dev-scripts/compare-snapshots.js`:
  - caption changed with the exact `PATCH` the modal sends → **all invariants held**; restored → held, content byte-identical;
  - caption changed **by the owner in the browser (calendar → click event → edit → Save)** to `"A video of mountain
#sfvsfvsi
#ajbca
#youtube"` → **all invariants held** (same post id; only `content` / `updated_at` changed; same 4 schedule rows, 4 job rows, 4 BullMQ jobs; totals 1 / 4 / 4); then restored to the original `"A test video
sfvsfvsi
#ajbca
#jabiua"` → held.
- Confirmed by the owner in the browser: click an event → edit modal → change caption → Save works. **Not confirmed:** read-only view of a published/processing post, viewer role, Esc / backdrop / X while saving, the "+N more" popover, that an event click never also opens the create modal, hover "+" and scroll lock (Step 2 items), and that the calendar text and the Posts timeline updated (the owner didn't report it).

### Issues found & fixed
- `posts.updated_at` is not maintained by the live DB → the endpoint sets it (KNOWN_ISSUES #20e).
- Redis replaced by the owner mid-step → 4 scheduled jobs re-queued and re-verified.
- A `next build` run while `next dev` was running corrupted Next's generated types (lesson recorded; use tsc / ESLint / tests instead).
- One `tsc` weak-type error and a vitest alias problem (fixed before the final runs).

### Known limitations / intentionally deferred
- Only the caption is editable (time → Step 4; platforms / media not editable at all yet). Editing after a job started publishing is refused; a tiny race remains between the server's check and the update.
- No auth on any service (pre-existing): the endpoint trusts `userId` / `teamId` like the others.
- The test post will publish to the real accounts on 23 Sep 10:00 IST. Its uploaded video variants are **landscape** although it is a reel (KNOWN_ISSUES #20f) — YouTube will treat it as a normal video.
- Threads limit is enforced in bytes (adapter rule) although Threads counts characters.

### Waiting for your approval to start Step 4 — Drag-to-Reschedule
Needs its own plan first (see `docs/RESUME_HERE.md` §2.4).

---

## Calendar Step 2 — Create Post via Calendar (hover + click) — Implemented; one end-to-end check still open

Status: code complete, automated checks green, and a real calendar-created Facebook post is correctly in the DB and the queue. **Still open:** that post is scheduled for 25 Sep 2026 10:00 IST, so "publishes at the chosen time through the unmodified pipeline" (the step's definition of done) has **not** been observed yet.

### What was built
- **Composer extraction (no behaviour change):** the inline composer from `posts/page.tsx` (745 → ~270 lines) is now `components/post/PostComposer.tsx` + `components/post/PlatformPreviewCard.tsx`. Proven verbatim by whitespace-insensitive diff of handlers and JSX against the original; only additions are the props `variant`, `initialScheduleAt`, `onSubmitted(actionType)` and `onOptimisticChange`.
- **`components/post/CreatePostModal.tsx`:** modal shell — Esc / backdrop / X close (ignored while uploading or creating), scroll lock, focus restore, fresh composer on every open.
- **`lib/calendarPrefill.ts` (+ tests):** clicked day → `datetime-local` value: past day blocked; today → next full hour (23:59 if that spills into tomorrow); later day → 09:00; week-view slot → exact slot unless already started.
- **`calendar/page.tsx`:** `interactionPlugin` (click only, drag still disabled), `dateClick` → prefill → modal, past-day amber notice, draft notice ("Saved as a draft… don't appear on the calendar"), `refetchEvents()` after create, viewer role gets no "+" and no click. `globals.css`: hover "+" on month-view days that aren't in the past.
- **Preview fix (found while testing in the modal):** `lib/mediaFrame.ts` + `PlatformPreviewCard`. Previews now match what media-service really produces: instagram 4:5 / twitter 16:9 / youtube 16:9 / pinterest 2:3 cropped (`object-cover`); facebook / linkedin / threads keep the image's own ratio; reels use 9:16; normal video keeps its ratio. Landscape video in reel mode shows a warning. Timeline thumbnails and the timeline preview modal use the same rules. Modal has a single scroll area.
- **Timeline date bug (pre-existing, found in testing):** the timeline showed `created_at` instead of the scheduled date because `DashboardProvider` never fetched `schedules`, and on the live DB the browser user could not read `schedules`/`publish_jobs`/`notifications`/`analytics` at all (missing RLS SELECT policies). Fixed by embedding `schedules(*)`, `getPostStart()` in the timeline, and `supabase/migrations/20260921000000_restore_read_policies.sql` (applied by you; confirmed working).

### Self-check performed
- Lint (`src/lib`, `src/components`, `posts`, `calendar`): **pass, 0 warnings**. (Whole `src/app/dashboard` still has 2 old errors in `accounts/page.tsx` and `settings/page.tsx`, untouched.)
- Type-check: **pass**. Tests: **53 passed / 0 failed** (calendar status 18, prefill 14, media frame 21); prefill also run under Asia/Kolkata, UTC, America/New_York and Pacific/Auckland. `next build`: **pass**. Dev server confirmed to serve the new code.
- Real data, verified by me (read-only queries): the post created from the calendar modal (`#fbt`, Facebook, image, 25 Sep 2026 10:00 IST) has exactly 1 `posts`, 1 `schedules`, 1 `publish_jobs` row; `posts` status `scheduled`; job `scheduled`, `content_type=post`, `retry_count=0`, `error_message=null`; `schedules.timezone=Asia/Calcutta`; `media_url={"facebook": <public url>}`. Column set and value kinds are **identical** to a post created from the sidebar composer (compared field by field).
- Queue: a BullMQ delayed job exists with `jobId == publish_jobs.id`, payload `{jobId, postId, userId, platform}`, firing at 04:30:00.003 UTC vs schedule 04:30:00.000 UTC (3 ms, BullMQ stamps the enqueue time). One job for one platform, no duplicate.
- Calendar API for that week returns the post with its schedule and job; `source: database` (uncached).
- Confirmed by you in the browser (screenshots, 2026-09-21 17:21): timeline date/time correct after the RLS fix; sidebar notifications now show; clicking a future day opens the modal with the schedule field pre-filled `22-09-2026 09:00`; clicking a past day shows the amber "You can't schedule a post in the past" notice and no modal; the modal now has a single scrollbar; a landscape video in reel mode shows the 9:16 frame and the "isn't vertical" warning; calendar shows legend, timezone label, and chips with time + platform (green published on 19/20 Sep, blue scheduled `#fbt` on 25 Sep); scheduling from the calendar works.
- **Not yet verified:** the scheduled publish itself (definition of done), hover "+", Esc / backdrop / X close and scroll lock, draft notice, viewer role, timeline thumbnails, and the Processing / Partially Published / Failed colours on real posts (unit-tested only).

### Issues found & fixed
- Timeline date wrong (embed missing + RLS drift, see above); preview frames not matching the real output; double scrollbars in the modal; one `tsc` weak-type error in `mediaFrame.ts` (fixed before the final run); my first multi-timezone test run used Git Bash, which silently dropped `TZ` — re-run properly from PowerShell.

### Known limitations / intentionally deferred
- 10 of the 11 delayed jobs in the `publish-queue` belong to posts that no longer exist (probably deleted from the timeline; the `publish_jobs` rows are gone, so `POST /publish/:jobId` will 404 and each job will just fail when its time comes — nothing gets published). Deleting a post does not cancel its queued jobs (KNOWN_ISSUES #18). Not cleaned up; do **not** run `promote-jobs.js` (it promotes every delayed job).
- Retries still never happen (`attempts` = 1 on every job, confirmed in the queue).
- Week-view "+" is not shown (click works); the current, already-started time slot is blocked as "past".
- Month-view event chips are not clickable yet (Step 3). No live refresh of calendar colours when a job changes status.
- Old `getAspectRatioClass` removed; previews are a CSS approximation of the crop, not the exact processed file.

### Waiting for your approval to start Step 3 — Click-to-Edit Existing Post
Prerequisite for Step 3: there is **no update-post endpoint** in post-service (`PATCH /posts/:id`); the scope of what is editable (caption only vs platforms/media/time) needs a decision first.

---

## Calendar Step 1 — Calendar Read View — Implemented, awaiting your browser check

Status: code complete and verified against real data at the API level. **Not yet confirmed in a browser** and **the `queue_job_id` migration still has to be applied by you** (see below).

### What was built
- **`apps/web/src/lib/calendarStatus.ts` (new):** pure helpers.
  - `deriveCalendarStatus` — aggregate status from the *latest job per platform* (retries leave old rows behind):
    - all completed → Published (green)
    - some completed + some failed → **Partially Published** (dark yellow, new)
    - all failed, or failed with the rest still waiting → Failed (red)
    - any processing, or some completed with the rest waiting → Processing (amber)
    - otherwise → Scheduled (blue)
    - no jobs visible → falls back to `posts.status`
  - `getPostStart` (newest schedule row wins), `getPostPlatforms`, `STATUS_META`, `PLATFORM_SHORT_LABELS`.
- **`apps/web/src/lib/calendarStatus.test.ts` (new):** 18 vitest cases (every status rule, retry handling, no-jobs fallback, empty input).
- **`apps/web/src/app/dashboard/calendar/page.tsx` (rewritten):**
  - FullCalendar function event source; query params built with `URLSearchParams` (previous raw `from`/`to` broke on `+` in UTC offsets).
  - Calendar is remounted per team (`key={teamId}`), fixing stale events after switching team.
  - Event chips show local time + platform badges (FB/IG/YT/…) + text; status legend; "Times shown in <timezone>" label; loading, error and empty states.
  - Strictly read-only (`editable=false`, no click/drag handlers, interaction plugin not registered). Removed `as any` casts and the empty `useEffect`.
- **`services/post-service/src/index.ts` (+ rebuilt tracked `dist/`):**
  - Range queries (`from` + `to`) are **never cached** (range keys were never invalidated, so they could serve stale data for 60 s) and `from`/`to` are validated (400 on invalid dates).
  - Range select no longer embeds `user:user_id(email)`. That embed (present since the initial commit) fails on this DB with *"Could not find a relationship between 'posts' and 'user_id'"*, which made the range endpoint — and the normal feed — return 500. Left unchanged for the normal feed (not used by the frontend; see limitations).
- **`apps/web/package.json`:** `@fullcalendar/react` `^7.1.0` → `^6.1.21` (now matches core/daygrid/timegrid 6.1.21); added `vitest` devDependency and `"test": "vitest run"`.

### Self-check performed
- Lint (eslint on `src/app/dashboard/calendar`, `src/lib`): **pass**
- Type-check (`tsc --noEmit` apps/web; `tsc` post-service): **pass**
- Tests: **18 passed / 0 failed** (only test suite in the repo)
- Build (`next build`): **pass**, `/dashboard/calendar` generated
- API check against the real DB (post-service started from rebuilt `dist/`, one team with 3 published posts, 19–20 Sep 2026):
  - IST-offset range → 3 posts; date-only 19→20 Sep → 2 posts; 20→21 Sep → 1 post; October → 0; other team → 0; unauthorised user → 403
  - Every response `source: database` (no cache), including a repeated identical query
  - Raw unencoded `+` offset → 400 (confirms the old page's bug; new page encodes)
- Manual browser smoke test: **NOT performed** — I cannot log in to the dashboard. Layout height (`h-[calc(100vh-8rem)]`), chip rendering, month/week switching and the visual colours still need your eyes.
- Colours for Scheduled / Processing / Partially Published / Failed were verified by unit tests only; the DB currently holds only `published` posts (6 jobs, all `completed`), so no real post exists in those states.

### Issues found & fixed
- Range endpoint returned 500 on the real DB (`user:user_id(email)` embed) — **the earlier "Step 1 complete" had never worked against real data.**
- Unencoded `from`/`to` with UTC offsets → invalid date.
- Range cache served stale data and was never invalidated.
- Calendar did not refetch on team switch.
- No "Partially Published" status; posts with one failed job showed fully red.
- Event label lacked platform and time; `uploading` status check referred to a status that never exists in the DB.
- FullCalendar `react` 7.x vs 6.x mismatch and `as any` workarounds.

### Known limitations / intentionally deferred
- **Migration not applied to the cloud DB:** `publish_jobs.queue_job_id` is missing there (verified). No CLI link or DB credentials are available to me. Run in the Supabase SQL editor:
  ```sql
  ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS queue_job_id text;
  CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_at ON public.schedules(scheduled_at);
  ```
  The calendar does not use the column; it is a Step 4 prerequisite. Nothing writes `queue_job_id` yet (Step 4; `publish_jobs.id` is already the BullMQ job id).
- Normal (non-range) `GET /api/v1/posts` still returns 500 on this DB because of the same embed. The frontend does not call it (timeline reads Supabase directly); fix separately if a consumer appears.
- Timezone is a label, not a selector (selector deferred to Step 2, per plan).
- `posts` list is limited by Supabase's default 1000-row cap on the range query.
- Calendar does not live-update when a job changes status (refetch on navigation only).
- Post-service `dist/` is tracked in git; rebuilt to match `src`.
- Lock files (`package-lock.json`, `apps/web/package-lock.json`) are untracked and changed by the dependency updates; Vercel installs depend on them — review before committing.

### Waiting for your approval to start Step 2 — Create Post via Calendar (hover + click)
Note for Step 2: the "existing Create Post modal" does not exist — the composer is an inline form in `posts/page.tsx` and must first be extracted into a shared component (see `docs/PENDING_WORK.md`).
