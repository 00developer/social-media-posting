# SocialPush — Calendar View Integration — AI Development Agent Prompt
### For use with Antigravity (Gemini 3.1 Pro High)

**How to use this:** Paste this entire document as your instruction to the agent, in the **same Antigravity project** where SocialPush already exists (post creation, scheduling, Reels/Shorts, and Facebook/Instagram/YouTube/LinkedIn/Pinterest connections are already built and working). Keep `CALENDAR_INTEGRATION_DEVELOPMENT.md` in the same folder as extra reference — this file is the direct, step-gated build instruction the agent should actually follow.

---

## Role

You are an autonomous senior full-stack engineer working on an **existing, already-partially-built codebase** — SocialPush, a multi-platform social media publishing SaaS. Post creation, scheduling, and multi-platform publishing are already fully working. Your job now is to add a **calendar view** as a new interface on top of this existing system — hover a date to add a post, see scheduled/published posts laid out visually, click to edit, drag to reschedule. This is primarily a **frontend feature that reuses existing backend logic** — you must resist the temptation to rebuild post-creation or scheduling logic just because you're building a new screen for it. You must follow the **Operating Protocol** in Section 3 exactly, on every single step, with zero exceptions.

---

## 1. Context — What Already Exists (do not rebuild any of this)

- **Post creation, the Create Post form/modal, platform selection, content-type (Post vs Reel/Short) selection, and the Pinterest board selector are already built.** The calendar's job is to open this *existing* component pre-filled with a date — not to build a second post-creation UI.
- **Scheduling Service** already converts a user's local time to UTC and creates delayed BullMQ jobs. **Reuse this conversion utility** for the reschedule flow you're building — do not write a second timezone-conversion implementation.
- **The post state machine** (`Draft → Scheduled → Processing → Publishing → Published/Failed`) and the **Aggregate Status Logic** (a post's displayed status is derived from all its per-platform job statuses, e.g. "Partially Published") are already built — the calendar must use these, not invent a parallel status/color scheme.
- **Row Level Security** on `posts`/`publish_jobs` already scopes data to the authenticated user.

**Your job is to build a new visual interface onto data and flows that already exist — not to duplicate any of it.** If you find yourself writing new post-creation logic, new scheduling logic, or a new status system "just for the calendar," stop — you're duplicating something that already exists and should be reused instead.

---

## 2. Prerequisites

1. Add **FullCalendar** to the frontend: `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction` (the last one is required for `dateClick` and `eventDrop`, which this feature depends on). Do not hand-roll a calendar grid.
2. **Before writing any reschedule logic, confirm `publish_jobs` (or wherever scheduled jobs are tracked) stores the actual BullMQ job ID** (e.g. a `queue_job_id` column). If it's missing, add it via migration as part of Step 1 — this is a hard dependency for Step 4, since rescheduling requires cancelling the *actual* queued timer, not just updating a database timestamp.

---

## 3. Operating Protocol — CRITICAL, follow exactly every step, no exceptions

For **every step** listed in Section 7, follow this exact loop. Do not shortcut it, do not combine steps, do not skip Step 5.

### Step 1 of the loop — Build
Implement only what is in scope for the current step's numbered instructions in Section 7. Do not implement a later step early. Do not skip part of the current step.

### Step 2 of the loop — Self-check (mandatory before reporting anything as done)
- Run the linter and the type-checker on all changed/new code.
- Run the full automated test suite.
- Boot the app and actually use the calendar in a browser: create a real post via the hover-plus flow, confirm it actually publishes at the chosen time through the existing pipeline; for the reschedule step, actually drag a real scheduled post and confirm — by checking Redis/BullMQ directly, not just the UI — that the old timer is gone and only the new one fires.
- Confirm a post created/edited through the calendar's Create Post modal produces identical database records to one created through the original (non-calendar) entry point — the calendar must not create a parallel/different shape of post record.
- Actively search for: broken imports, unhandled promise rejections, missing environment variables, console/runtime errors, type errors, dead code, any duplicated post-creation or scheduling logic, and any case where dragging or clicking on the calendar could double-publish a post or leave a stale queued job.

### Step 3 of the loop — Fix
Fix every issue found in Step 2 before moving on. Never report a step as complete while a test is failing, the app fails to boot, or a real drag/click/create action on the calendar doesn't do what it visually appears to do. If you find yourself fixing the same issue more than 3 times without success, **stop and report the blocker** instead of continuing to patch blindly.

### Step 4 of the loop — Report
Produce a completion report using exactly this format:

```
## Calendar Step [N] — [Step Name] — Complete

### What was built
- (bullet list of what was actually implemented, step by step)

### Self-check performed
- Lint: pass / fail
- Type-check: pass / fail
- Tests: X passed / Y failed
- Manual smoke test: (what you actually did in the browser, and what happened)
- (Step 4 only) Confirmed no duplicate/stale queued job after a real reschedule: pass / fail

### Issues found & fixed
- (bullet list, or "None found")

### Known limitations / intentionally deferred
- (bullet list, or "None")

### Waiting for your approval to start Step [N+1] — [Next Step Name]
```

### Step 5 of the loop — STOP and wait for explicit approval
Do not write, generate, or scaffold **any** code for the next step. Wait for the user to explicitly say something like "go ahead," "approved," "start step [N+1]," or "yes continue."

- If the user gives feedback or asks for changes instead, apply them, repeat Step 2 (self-check) and Step 3 (fix), and produce an **updated** completion report for the same step — still without starting the next step.
- If the user asks a question, answer it in place without starting new code.

**You must never:**
- Auto-start the next step right after finishing the current one.
- Build a second/parallel post-creation form instead of reusing the existing Create Post component.
- Build a second timezone-conversion implementation instead of reusing the existing one.
- Allow a drag-reschedule to update only the database timestamp without also cancelling the original BullMQ job via its `queue_job_id`.
- Allow dragging of a post that is not in `Scheduled` status, in either the UI or the backend endpoint.
- Invent a new status/color scheme instead of using the existing Aggregate Status Logic.
- Do the steps in Section 7 out of order.

---

## 4. Engineering Rules for This Addition

- The calendar is a new view over existing data and existing flows — never a reason to duplicate post-creation, scheduling, or publishing logic.
- Server-side enforcement, not just UI enforcement, for: which posts are draggable (`Scheduled` only), and range-query results being scoped to the authenticated user (RLS already does this — don't bypass it with an unnecessary service-role call from a user-facing endpoint).
- Reuse the existing UTC-conversion utility for any date/time math introduced here.
- All new database columns (e.g. `queue_job_id` if missing) are added via a versioned Supabase migration.

---

## 5. Working Logic — Calendar-Specific Decisions (read before Step 1)

1. **One post = one shared scheduled time across all its target platforms**, for calendar purposes — the Create Post modal has a single date/time picker for the whole post, not per-platform pickers. Build against this assumption; do not add per-platform time pickers unless explicitly asked.
2. **A calendar event represents a post, not an individual platform job.** A post targeting 3 platforms is **one** card, colored via the existing Aggregate Status Logic — never three separate events.
3. **Status → color:** Scheduled → blue, Processing/Publishing → amber, Published → green, Partially Published → yellow, Failed → red. Reuse the existing state machine values; do not invent new ones.
4. **Only `Scheduled`-status posts are draggable.** Enforce this in both the UI (don't initiate the drag) and the backend (reject a reschedule request for anything not `Scheduled`) — the UI check alone is not a real safeguard.
5. **Draft vs. Scheduled:** a post saved *with* a date/time is `Scheduled` and appears on the calendar grid. A post saved *without* one is `Draft` and does **not** appear on the grid — it needs a separate "Drafts"/"No Date" view (Step 5) instead.
6. **Rescheduling reuses the existing UTC-conversion utility** — the same one the Scheduling Service already uses, not a new implementation.
7. **Rescheduling must move the real timer, not just a database row.** A reschedule operation must, for every affected platform job: cancel the existing BullMQ delayed job via its stored `queue_job_id`, compute the new UTC time via the existing conversion utility, create a new delayed job, store the new `queue_job_id`, and update `scheduled_at`. If any platform's re-queue fails partway through, do not leave the post in a silently inconsistent state — either roll back what succeeded or clearly flag the post as needing attention.

---

## 6. Backend Additions (no new tables required)

### 6.1 Calendar range-fetch
An endpoint or direct RLS-scoped Supabase query returning posts with `scheduled_at` inside a given `[from, to]` range, including each platform job's status. Example: `GET /api/v1/posts?from=2026-09-01&to=2026-09-30`. Confirm an index on `scheduled_at` exists (it may already, per the original database design) rather than assuming.

### 6.2 Reschedule mutation
`PATCH /api/v1/posts/:postId/reschedule`, implementing Working Logic point 7 exactly:
1. Verify every platform job under the post is currently `Scheduled` — reject clearly otherwise.
2. For each platform job: cancel the existing BullMQ job (via `queue_job_id`), compute new UTC time, create a new delayed job, store the new `queue_job_id`, update `scheduled_at`.
3. If any platform fails partway through, handle it explicitly rather than leaving a silent partial state.

---

## 7. Build Steps (in this exact order — do not reorder, merge, or skip ahead)

### Step 1 — Calendar Read View (no create/edit/drag yet)
1. Add the `queue_job_id` column to the relevant job-tracking table if it doesn't already exist (Section 2, prerequisite 2).
2. Install and configure FullCalendar (month/week views).
3. Build the range-fetch query/endpoint (Section 6.1).
4. Render existing real posts as color-coded, read-only events on the calendar, in the user's local timezone.

**Definition of done:** opening the calendar shows real scheduled/published posts, correctly positioned and colored — confirmed against the actual database, not sample/mock data.

### Step 2 — Create Post via Calendar (hover + click)
1. Add the hover "+" affordance on empty day cells and a `dateClick` handler.
2. Wire it to open the **existing** Create Post modal (platform selection, content type, Pinterest board selector, media upload — all already built) with the clicked date pre-filled.
3. Confirm the normal Draft-vs-Scheduled rule (Working Logic point 5) is respected for posts created this way.

**Definition of done:** a real post created by clicking a calendar date actually publishes at the chosen time through the unmodified existing pipeline.

### Step 3 — Click-to-Edit Existing Post
1. Wire event click to open the same modal, pre-filled with the existing post's data and each platform's individual status.
2. Confirm edits save back to the same post/job records — no duplicate records created.

**Definition of done:** editing a real scheduled post's caption through this flow updates the same database record, verified directly, not just visually.

### Step 4 — Drag-to-Reschedule
1. Implement the reschedule endpoint (Section 6.2).
2. Enable `eventDrop` only for `Scheduled`-status events; call the endpoint on drop; revert the visual move if the backend rejects it.
3. Explicitly test: drag a real scheduled post to a new time, then confirm directly in Redis/BullMQ that only one job remains armed for that post, at the new time — the old one must be gone, not just superseded.

**Definition of done:** dragging a real scheduled post results in exactly one publish attempt, at the new time; attempting to drag a `Processing` post is blocked both in the UI and by the API.

### Step 5 (optional) — Drafts / No Date View
1. Add a toggle/panel listing undated drafts, separate from the calendar grid itself.

---

## 8. First Action

Start with **Step 1 only**. When Step 1's self-check (Section 3, loop Step 2) passes cleanly with real posts rendering correctly on the calendar, produce the Step 1 completion report and stop and wait for approval before touching Step 2, exactly as Section 3 requires. Do not proceed to any later step under any circumstances until the user explicitly approves each in turn.
