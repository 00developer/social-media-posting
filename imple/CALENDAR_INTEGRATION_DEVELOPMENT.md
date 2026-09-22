# Calendar View Integration — Development Document
### SocialPush — Adding a calendar-based scheduling interface

**Context:** Post creation, scheduling, Reels/Shorts, and platform connections (Facebook, Instagram, YouTube, LinkedIn, Pinterest) are already built and working. This document adds a **calendar view** as a new primary interface for scheduling — hover any date to add a post, see all scheduled/published posts laid out visually, click to edit, drag to reschedule. This is mostly a **frontend feature that reuses the existing backend** — only two small backend additions are needed (a range-fetch query and a reschedule mutation).

**How to use this:** Feed this document to Antigravity in the same project. It assumes the **Operating Protocol** and **Engineering Rules** from `ANTIGRAVITY_DEVELOPMENT_PROMPT.md` are still in effect — the condensed version is repeated in Section 6.

---

## 1. Prerequisites

1. Add a calendar library to the frontend — **FullCalendar** (`@fullcalendar/react`, plus `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, and `@fullcalendar/interaction` for the hover/click/drag behavior). It has built-in month/week views, a `dateClick` callback (for the hover-plus-click-to-create flow), and an `eventDrop` callback (for drag-to-reschedule) — don't hand-roll a calendar grid from scratch.
2. **Confirm `publish_jobs` (or wherever scheduled jobs are tracked) stores the actual BullMQ job ID**, e.g. a `queue_job_id` column. If it doesn't already exist, add it now via migration. This is required for Step 4 (reschedule) — without a reference to the real queued job, rescheduling can only update the database row, leaving the original timer still armed in Redis to fire at the old time, which would cause an incorrect or duplicate publish.

---

## 2. Working Logic — Calendar-Specific Decisions

1. **One post = one shared scheduled time across all its target platforms, for calendar purposes.** The underlying schema allows a `scheduled_at` per platform, but the Create Post modal (per the reference design) has a single date/time picker for the whole post. Treat this as the working rule: all platform jobs for a post created through this UI share the same `scheduled_at`. Don't build per-platform time pickers unless explicitly asked — that would contradict the reference UI and add complexity nothing currently needs.

2. **A calendar event represents a post, not an individual platform job.** A post targeting 3 platforms shows as **one** card on the calendar, not three. Its color/status uses the existing Aggregate Status Logic already built (Core Working Logic) — e.g. a post that's Published on 2 platforms and Failed on 1 shows as "Partially Published," not as three separate events.

3. **Status → color mapping** (reuse the existing state machine, don't invent new statuses):
   - Scheduled → blue
   - Processing/Publishing → amber/in-progress
   - Published → green
   - Partially Published → yellow
   - Failed → red

4. **Only truly-`Scheduled` posts are draggable.** Once a post has moved past `Scheduled` into `Processing`/`Publishing`, it must not be draggable on the calendar — a post already being published can't meaningfully be "moved." Already-`Published` or `Failed` posts are also not draggable (dragging a published post doesn't un-publish it anywhere). Enforce this in the UI (don't even initiate a drag) **and** in the backend endpoint (reject a reschedule request for a non-`Scheduled` post), since the UI guard alone isn't a real safeguard.

5. **Draft vs. Scheduled stays exactly as previously clarified:** saving a post *with* a date/time selected → `Scheduled`, appears on the calendar grid at that date/time. Saving *without* a date/time → `Draft`, does **not** appear on the calendar grid — it needs a separate "Drafts" or "No Date" view (the reference screenshot's header has a "No Date" control for exactly this) so drafts aren't lost, just not calendar-positioned.

6. **Rescheduling reuses the existing UTC-conversion utility.** When a user drags a post to a new date/time (in their local timezone, e.g. the "Kolkata" timezone shown in the reference UI), convert it to UTC using the same function the Scheduling Service already uses for initial scheduling — do not write a second timezone-conversion implementation for this flow.

7. **Rescheduling must actually move the real timer, not just the database row.** The reschedule operation must: (a) remove/reschedule the existing BullMQ delayed job(s) for every platform job under that post using the stored `queue_job_id`(s), (b) update `scheduled_at` on each affected `publish_jobs` row, and (c) re-add new delayed jobs at the corrected time. Steps (a)–(c) should be treated as one logical operation — if re-queuing fails partway through, the post's status/timers must not be left inconsistent (e.g. one platform rescheduled and another still firing at the old time).

---

## 3. Backend Additions

No new tables are needed. Two additions to existing services:

### 3.1 Calendar range-fetch query
An endpoint (or a direct Supabase query under RLS, if the frontend is allowed to query posts directly) that returns posts with a `scheduled_at` inside a given `[from, to]` range for the current user, including each platform job's status so the frontend can compute the aggregate color from Working Logic point 3. Example shape: `GET /api/v1/posts?from=2026-09-01&to=2026-09-30`.
- Add/confirm an index on `scheduled_at` (or `publish_jobs.scheduled_at`) — this was already flagged as a needed index in the original database design, so it may already exist; confirm rather than assume.

### 3.2 Reschedule mutation
`PATCH /api/v1/posts/:postId/reschedule` (or equivalent), accepting a new date/time. Implements the logic from Working Logic point 7:
1. Verify the post's current status is `Scheduled` for **every** targeted platform job — reject with a clear error otherwise (per Working Logic point 4).
2. For each platform job: remove the existing BullMQ delayed job using its stored `queue_job_id`, compute the new UTC time via the existing conversion utility, create a new delayed job, and store its new `queue_job_id`.
3. Update `scheduled_at` on each `publish_jobs` row (and on `schedules` if that's where it's authoritative) to the new time.
4. If any platform's re-queue fails partway through, roll back the ones that already succeeded rather than leaving a mixed state (or, at minimum, clearly flag the post as needing attention rather than silently leaving it half-rescheduled).

---

## 4. Frontend Implementation

1. **Calendar shell:** render FullCalendar in month/week view (matching the reference UI's "Week"/"Today" controls), scoped to the connected channels the user has, with a timezone selector defaulting to the user's local timezone (already resolved elsewhere in the app for scheduling — reuse it, don't re-detect timezone separately here).
2. **Hover-to-add:** use FullCalendar's day-cell hover state to show a "+" affordance (per the reference screenshot); `dateClick` opens the existing Create Post modal with that date pre-filled (time left for the user to pick, or defaulted to a sensible value like the next hour).
3. **Existing Create Post modal reuse:** the modal that opens is the **same** Create Post component already built (platform selection, content type — Post vs Reel/Short — toggle, Pinterest board selector, media upload) — not a new/parallel form. The calendar's job is to launch it pre-filled with a date, not to reimplement post creation.
4. **Event rendering:** fetch posts for the visible date range (Section 3.1) and render one FullCalendar event per post, colored per Working Logic point 3, labeled with platform icon(s) and time (matching the reference screenshot's "5:00 PM" Instagram chip style).
5. **Click-to-edit:** clicking an existing event opens the same Create Post modal, pre-filled with that post's saved data and showing each targeted platform's individual status (not just the aggregate color) so the user can see exactly what happened per platform.
6. **Drag-to-reschedule:** use FullCalendar's `eventDrop` — but only enable dragging for events whose post status is `Scheduled` (Working Logic point 4); on drop, call the reschedule endpoint (Section 3.2) and revert the visual move if the backend rejects it (e.g. because the post had already started publishing in the moment between render and drop).
7. **Drafts/No Date view:** a separate toggle or panel (matching the reference UI's "No Date" control) listing posts with no `scheduled_at` — these never render on the calendar grid itself.

---

## 5. Build Steps (in order)

### Step 1 — Calendar Read View (no create/edit/drag yet)
1. Install and configure FullCalendar (month/week views).
2. Build the range-fetch query/endpoint (Section 3.1).
3. Render existing posts as color-coded, read-only events on the calendar.

**Definition of done:** opening the calendar shows real scheduled/published posts from the database, correctly positioned by date/time in the user's local timezone, correctly colored by aggregate status.

### Step 2 — Create Post via Calendar (hover + click)
1. Add the hover "+" affordance and `dateClick` handler.
2. Wire it to open the existing Create Post modal with the clicked date pre-filled.
3. Confirm a post created this way follows the normal Draft-vs-Scheduled rule (Working Logic point 5) and appears correctly on the calendar once saved with a time.

**Definition of done:** a real post created by clicking a calendar date actually publishes at the chosen time through the existing pipeline — this is just a new entry point into a flow that already works, so the pipeline itself should need zero changes.

### Step 3 — Click-to-Edit Existing Post
1. Wire event click to open the modal pre-filled with the existing post's data and per-platform status.
2. Confirm edits to a not-yet-published post save correctly back to the same post/job records rather than creating duplicates.

**Definition of done:** clicking a real scheduled post, changing its caption, and saving updates the same post — verified in the database, not just visually in the calendar.

### Step 4 — Drag-to-Reschedule
1. Implement the reschedule endpoint (Section 3.2).
2. Enable `eventDrop` only for `Scheduled`-status events; call the endpoint on drop; revert the UI move on rejection.
3. Test explicitly: drag a real scheduled post to a new time and confirm the **old** BullMQ timer does not also fire — i.e. confirm only one publish happens, at the new time, not two.

**Definition of done:** dragging a real scheduled post to a new date/time results in exactly one publish attempt, at the new time; attempting to drag a post that's already `Processing` is blocked both visually and at the API level.

### Step 5 (optional) — Drafts / No Date View
1. Add a toggle/panel listing undated drafts, matching Working Logic point 5.

---

## 6. Operating Protocol (condensed — full version in `ANTIGRAVITY_DEVELOPMENT_PROMPT.md`)

For **each step in Section 5**:
1. **Build** only that step's scope.
2. **Self-check:** lint + type-check + tests; actually create/edit/drag a real post through the UI and confirm the underlying database and queue state match what's shown on screen — not just that the calendar "looks right."
3. **Fix** anything broken before calling the step done.
4. **Report**, same format as the main prompt, including explicit confirmation for Step 4 that dragging didn't leave a duplicate/stale queued job.
5. **STOP.** Wait for explicit approval before the next step.

---

## 7. Rules Specific to This Addition

- The calendar is a new *view* onto existing data and existing flows — it must not duplicate post-creation, scheduling, or publishing logic that already exists elsewhere in the codebase.
- Never allow a drag-reschedule to proceed without first cancelling the original queued job via its stored `queue_job_id` — updating only the database timestamp is not sufficient and will cause a double-publish.
- Enforce the "only `Scheduled` posts are draggable" rule server-side, not just in the UI.
- Reuse the existing timezone-conversion utility for reschedules; do not write a second implementation.
- A calendar event's color must be derived from the existing Aggregate Status Logic, not a new status scheme invented for the calendar.

---096    

*End of Calendar View Integration Development Document.*
