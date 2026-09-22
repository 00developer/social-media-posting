# Calendar Step 2 — S2.0 Baseline (captured 2026-09-21, before any refactor)

Purpose: freeze what the **original inline composer** in `apps/web/src/app/dashboard/posts/page.tsx` does (file unchanged since 2026-09-20 02:21, 745 lines), so the extracted `PostComposer` can be proven behaviour-identical. Nothing in the repo was changed for S2.0 except this file.

## 1. Composer state (all local to `PostsPage`)
| State | Initial | Notes |
|---|---|---|
| `newPostContent` | `''` | textarea |
| `scheduleAt` | `''` | `datetime-local` string (local time, no zone) |
| `selectedPlatforms` | `[]` | any of `twitter, facebook, instagram, youtube, linkedin, tiktok, pinterest, threads` (all 8 always shown; connection status ignored) |
| `contentType` | `'post'` | `'post'` \| `'reel'`; **not reset after submit** |
| `mediaFile` / `mediaPreview` / `fileInputKey` | `null` / `null` / `0` | preview is an object URL suffixed `#video` or `#image` |
| `isPreviewLoading` | `false` | true while `3006 /media/transcode-preview` runs |
| `previewPlatform` | `null` | which platform tab the preview shows; **not reset after submit** |
| `optimisticPost` | `null` | **shared with the timeline** (renders the "Uploading…" card) → must stay in the page and be set through a callback |
Not composer state (stay in the page): `isPublishing` (used by `handlePublish`), `previewPost` (timeline preview modal).

## 2. Buttons
- `scheduleAt` set → one button **Schedule Post** → `handleCreatePost('schedule')`.
- `scheduleAt` empty → **Publish Now** (`'publish'`) and **Save Draft** (`'draft'`).
- All disabled when: role is `viewer`, content empty, no platform selected, or `optimisticPost !== null`. (So even a *draft* requires ≥1 platform, although platforms are not stored for drafts.)
- Viewer role also disables textarea, radios, platform chips, file input and the date input.

## 3. `handleCreatePost(actionType)` — exact sequence
0. Return if `!user || !activeTeam`. If content empty or no platform → `alert("Please enter content and select at least one platform.")`, stop.
1. `setOptimisticPost({ id:'temp-upload', content, status:'uploading', created_at:now, media_url: JSON.stringify(mediaPreview ? {preview: mediaPreview} : {}) })`.
2. If a file is attached: `POST http://localhost:3006/api/v1/media/upload` multipart `{file, userId, platforms: selectedPlatforms.join(','), contentType}`. On `!success` → `alert('Media upload failed: ' + error)` and **return without resetting the form** (`finally` clears the optimistic card).
3. `POST http://localhost:3002/api/v1/posts` JSON `{ userId, teamId, content, mediaUrl: JSON.stringify(mediaUrls) }` — `mediaUrls` is `{}` when no file, so `posts.media_url = '{}'`. On `!success` → `alert(data.error)`.
4. If `actionType` is `schedule` or `publish`: `runAt = (schedule && scheduleAt) ? new Date(scheduleAt) : new Date()`; `POST http://localhost:3004/api/v1/schedules` JSON `{ userId, postId, platforms: selectedPlatforms, scheduledAt: runAt.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, contentType }`. On failure `alert('Failed to process: ' + error)`; on success + `publish` → `alert('Post queued for immediate publishing!')` (no alert for `schedule`).
5. Reset (also after a failed schedule call — the post then exists as a draft): content `''`, `scheduleAt` `''`, `mediaFile` `null`, revoke `mediaPreview`, `mediaPreview` `null`, `fileInputKey++`, `selectedPlatforms` `[]`; then `fetchTeamData()`.
6. `catch` → `alert('Error creating post: ' + message)`. `finally` → `setOptimisticPost(null)`.
`Save Draft` therefore runs steps 0–3 and 5 only (no schedule request).

## 4. Media preview (`handleMediaChange`)
Revoke previous preview URL; video → `POST 3006 /media/transcode-preview` (fallback to local object URL on failure); image → local object URL. Preview card = `PlatformPreviewCard(activePreviewPlatform, content, mediaPreview, isVideo)` where the active platform falls back to the first selected one.

## 5. Other things living in the same file (must keep working)
Timeline (`posts`, `analytics`, optimistic card), timeline preview modal, `handlePublish` (uses `window.prompt`, sends no `contentType`), `handleDelete`, `VideoPlayer`, `getAspectRatioClass`, `PlatformPreviewCard`, and a stray `console.log('DEBUG POSTS:', posts)` (line 184).
Lint baseline for `src/app/dashboard/posts` + `src/components`: **0 errors, 2 warnings** (`useRef`, `useEffect` imported but unused in `posts/page.tsx`).

## 6. Real DB record shape produced by this flow (cloud DB, 3 existing posts)
- `posts`: `id, user_id, content, media_url, status, created_at, updated_at, team_id`. `status` goes `draft` → `scheduled` (scheduling-service) → `published`. `media_url` = JSON map `{platform: publicUrl}` containing **only the platforms selected at upload time** (e.g. `[instagram, facebook, threads, youtube]`).
- `schedules`: one row per selected platform; identical `scheduled_at`; `timezone` `Asia/Calcutta`.
- `publish_jobs`: one row per platform; `status`, `retry_count` (number), `error_message` (null), `content_type` (`post`/`reel`), `queue_job_id` (null — nothing writes it).
**Identical-records check (Step 2 DoD):** create the same content once from the sidebar and once from the calendar and compare `posts`, `schedules`, `publish_jobs` field-by-field, ignoring `id`, timestamps, and the random uuid segment inside media URLs.

## 7. Environment facts found while capturing the baseline
- `publish_jobs.queue_job_id` **now exists** on the cloud DB (the migration was applied since the last check).
- Cloud DB is missing things the code expects: `publish_jobs.pinterest_board_id`, tables `pinterest_boards` and `pinterest_published_pins`, `social_accounts.provider_account_id / handle / status`, `posts.media_variants`. → Connecting Pinterest would fail on this DB, and LinkedIn/Pinterest publishing cannot work. Not a Step 2 concern, but it confirms the schema drift in `docs/DATABASE.md`.
- Connected accounts on the cloud DB: **instagram, youtube, facebook, threads** (1 each).
  - Text-only posts can publish to **facebook** and **threads**; instagram needs an image/video; youtube needs a video.
- Services needed for an end-to-end Step 2 test: web (3000), post (3002), scheduling (3004), publishing (3003), worker, notification-service, Redis via `REDIS_URL`; media-service (3006) only when a file is attached. All were **down** when checked.

## 8. Regression checklist to run on the Posts page after S2.1 and after S2.2
| # | Check | Expected |
|---|---|---|
| R1 | Empty content or no platform → click any button | Buttons disabled; no request |
| R2 | Text + 1 platform → Save Draft | `POST /posts` only; draft card appears; form resets; `media_url` = `{}` |
| R3 | Text + platform + date → Schedule Post | `/posts` then `/schedules`; status `scheduled`; no alert; form resets |
| R4 | Text + platform → Publish Now | `/posts` then `/schedules` (now); alert "Post queued…" |
| R5 | Attach image → Save Draft | `/media/upload` first; `media_url` has one key per selected platform |
| R6 | Attach video → preview | transcode-preview spinner, then preview plays |
| R7 | Reel toggle stays selected after submit; platform chips reset | as in §3 step 5 |
| R8 | Viewer role | all composer controls disabled |
| R9 | Timeline: "Uploading…" card shows while R5 runs, then disappears | optimistic state still works |
| R10 | Timeline preview modal, Retry/Publish Now (prompt), Delete | unchanged |
