# Calendar Step 4 (Drag-to-Reschedule) — Implementation Plan

## 1. Goal
Allow users to reschedule scheduled posts directly from the Calendar by dragging and dropping them to a new date/time slot, while keeping BullMQ timers and database schedules 100% in sync without double-publishes or orphaned timers.

---

## 2. Core Invariants & Business Rules
1. **Only `Scheduled` Posts Can Be Moved:**
   - A post is draggable **only if all its latest platform jobs are in `scheduled` status**.
   - If any platform job is `processing`, `completed`, or `failed`, or if the post is a `draft`, dragging is disabled in the UI and rejected by the backend (`409 CONFLICT`).
2. **No Past Rescheduling:**
   - Dropping a post onto a past date or current time is rejected (`400 BAD REQUEST`) and reverted in the UI.
3. **Atomic BullMQ + Database Synchronization:**
   - The reschedule operation must update `schedules.scheduled_at` in Supabase **AND** move the actual BullMQ delayed timers in Redis using `job.changeDelay()`.
   - If moving timers fails, rollback cleanly so no platform fires at an unsynced time.
4. **Permissions:**
   - Team `viewer` role cannot reschedule posts (`403 FORBIDDEN`).
5. **Cache Invalidation:**
   - Invalidate `feed:${teamId}` in Redis so the timeline and calendar always fetch fresh dates.

---

## 3. Sub-Tasks Breakdown

### Phase 1: Backend Endpoint (`services/scheduling-service`)
- **Route:** `PATCH /api/v1/posts/:postId/reschedule`
- **Request Body:** `{ scheduledAt: string }` (ISO timestamp)
- **Logic:**
  1. Authenticate user (`requireUser`) and verify team membership (reject `viewer`).
  2. Verify target date is not in the past (`new Date(scheduledAt) >= Date.now()`).
  3. Fetch post and its latest `publish_jobs`. Verify all jobs have `status === 'scheduled'`.
  4. Compute `newDelay = Math.max(0, new Date(scheduledAt).getTime() - Date.now())`.
  5. For each job row in `publish_jobs`:
     - Load job from BullMQ `publish-queue` (`await publishQueue.getJob(job.id)`).
     - Update timer: `await bj.changeDelay(newDelay)`.
  6. Update database rows:
     - `schedules.scheduled_at = scheduledAt`, `schedules.updated_at = now`.
     - `posts.updated_at = now`.
  7. Invalidate Redis feed cache `feed:${teamId}`.
  8. Return `{ success: true, newScheduledAt, affectedJobs: [...] }`.

### Phase 2: Frontend Helpers & Event Drag Rules (`apps/web`)
- **`apps/web/src/lib/calendarStatus.ts`:**
  - Export helper `isPostDraggable(post)`: returns `true` only if `status === 'scheduled'` and all latest platform jobs are `scheduled`.
- **`apps/web/src/lib/calendarEvent.ts`:**
  - In `toEvent()`, set `editable: canCreate && isPostDraggable(post)`.
  - Add visual cues/classes for draggable events vs locked/published events.

### Phase 3: FullCalendar Drag & Drop Wiring (`apps/web/src/app/dashboard/calendar/page.tsx`)
- Set `editable={canCreate}` on `<FullCalendar />`.
- Add `eventDrop` handler:
  1. Check if dropped date/time is in the past:
     - If past: call `info.revert()`, display amber notice: *"Cannot reschedule a post to the past."*
  2. Call `PATCH ${SCHEDULING_SERVICE_URL}/api/v1/posts/:postId/reschedule`:
     - Pass `scheduledAt: info.event.start.toISOString()`.
  3. If rejected (e.g. 409 conflict, network error):
     - Call `info.revert()`.
     - Refetch calendar events (`refetchEvents()`).
     - Display error notice.
  4. If successful:
     - Show success notice.
     - Call `fetchTeamData()` so timeline syncs instantly.

### Phase 4: Automated Testing & Verification
1. **Unit Tests:**
   - Test `isPostDraggable` with all status combinations (all scheduled, mixed, completed, failed, drafts).
   - Test reschedule payload and timezone conversion.
2. **API Verification:**
   - Test `PATCH /reschedule` with scratch data: past date check, viewer role check, non-scheduled status check, valid timer move check.
3. **Queue Verification:**
   - Verify BullMQ `delayed` timestamp moves to the exact new time in Redis.
