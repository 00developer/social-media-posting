# Calendar Step 3 (Click-to-Edit) — S3.0 Baseline (captured 2026-09-21 ~17:45 IST, before any Step 3 change)

Nothing was modified for S3.0 except this file. Everything below was read-only.

## 1. Decisions confirmed by the owner
| Topic | Decision |
|---|---|
| Scope | **Caption only.** Time = Step 4; platforms / media = later. |
| Editable when | draft (no jobs), OR every platform's latest job is `scheduled`, OR every latest job is `failed`. Read-only if any latest job is `processing` or `completed`. Enforced **server-side** too. |
| UI | Separate edit form inside a shared modal shell (`PostModalShell`); `PostComposer` is not touched. |
| Threads | Server validates like the adapter: ≤ 500 UTF-8 **bytes** (mismatch with Threads' 500-*character* limit is tracked separately). |
| Viewers | May open the modal read-only (per-platform status), cannot save. |
| Test consent | Scratch draft (create + delete) and changing the real scheduled test post's caption (then restoring it). |

## 2. Code facts
- `services/post-service/src/index.ts` routes today: `GET /api/v1/posts`, `POST /api/v1/posts`, `DELETE /api/v1/posts/:id`. **No PATCH/PUT.**
- post-service (port 3002) runs as `ts-node-dev … src/index.ts` → it reloads by itself when `src` changes; no manual restart needed.
- Worker and publishing-service load the post fresh at publish time, so a caption change on a scheduled post needs no queue change.
- Calendar `toEvent()` currently drops the post from `extendedProps` (only `statusLabel`, `platforms`).

## 2b. S3.1 result (backend done, 2026-09-21)
`PATCH /api/v1/posts/:id` exists (`services/post-service/src/index.ts` + pure rules in `src/editability.ts`; `dist/` rebuilt). Verified with **37 real HTTP checks** against the running service, all inside a scratch team that was deleted afterwards (validation, auth, viewer, team scoping, draft edit, editability matrix incl. retries/mixed states, 409-before-400 precedence, Threads byte rule, exact round-trip of newline/emoji/Hindi). The real test post, its 4 schedules, 4 jobs and 4 queue jobs are byte-identical before/after the whole run; totals still `1 / 4 / 4`.
- **Decision recorded:** "mixed scheduled + failed" (nothing published) is editable — the rule is "read-only iff any platform's latest job is `processing` or `completed`".
- **Finding:** on the live DB `posts.updated_at` does not move on UPDATE (trigger not effective), so the endpoint sets `updated_at` explicitly; invariant 1 below therefore holds. See `KNOWN_ISSUES` #20e.
- Note: `failed` count in the publish queue dropped from 40 to 0 during this step (not caused by this work).

## 2c. Redis replaced (2026-09-21, after S3.3)
The owner deleted the old Upstash Redis database and created a new one; `REDIS_URL`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the root `.env` now point to it (verified: TLS `PING`, REST `/ping` and a set/get round-trip, BullMQ works; the old host appears nowhere else in the repo). The new database is **empty**, so:
- Every previously queued BullMQ job is gone: the 4 jobs of the test post `85e737cb…` and the 11 orphans. The 4 `publish_jobs` rows are still `scheduled` in Supabase, but **nothing will fire them** until they are re-queued (same `jobId = publish_jobs.id`, delay = `scheduled_at − now`).
- The **queue part of the invariants in §3 is void** — re-take the queue snapshot after any re-queue. The database invariants are unaffected.
- **Re-queued (owner approved):** the 4 `scheduled` jobs of `85e737cb…` were added back to the new `publish-queue` exactly like scheduling-service does (`add('publish-post', {jobId, postId, userId, platform}, {delay, jobId: publish_jobs.id})`, no extra options): all `delayed`, `jobId == publish_jobs.id`, payload identical, run time within 1 ms of `schedules.scheduled_at` (`2026-09-23T04:30:00Z`); a second run added nothing. **New queue baseline for the invariants in §3:** exactly these 4 jobs (facebook, instagram, youtube, threads), `state=delayed`, `runsAt=2026-09-23T04:30:00Z`, `attempts=1`; queue totals `delayed=4, everything else 0`. The delays differ from §3 because they were computed at re-queue time — compare ids, state and `runsAt`, not `delay`.
- Running services keep their connection to the old (deleted) Redis until restarted; `.env` is only read at process start.
- The analytics repeat job is recreated by analytics-service on its next start; role/feed caches simply start cold.

## 3. State of the environment
- DB now holds **exactly 1 post** (all earlier posts, including the published ones and `#fbt`, were deleted by the owner): totals `posts=1, schedules=4, publish_jobs=4`.
  - Consequence for testing: there is **no published post left** to use for the "edit must be rejected" test → that check will use a scratch post with scratch job rows (inserted and deleted by the test), never a real one.
- `publish-queue`: 15 delayed jobs, of which 4 belong to the test post below and **11 are orphans** (their posts/rows were deleted; they will 404 and fail harmlessly when due). Untouched. Do not run `promote-jobs.js`.
- Test post for Step 3: **`85e737cb-0b8a-4688-a0f4-37b1b489bba1`** — a 4-platform **reel** (facebook, instagram, youtube, threads), scheduled **23 Sep 2026 10:00 IST** (04:30:00Z). It will publish to those real accounts at that time if the services are running.

### Snapshot to compare against after the edit
- `posts` row: `status=scheduled`, `updated_at=2026-09-21T11:56:09.457261+00:00`, `media_url` keys `[facebook, threads, instagram, youtube]`.
- **Original caption (restore this exactly):** `"A test video\nsfvsfvsi\n#ajbca\n#jabiua"` (JSON-escaped; `\n` = newline).
- `schedules` (4, all `scheduled_at=2026-09-23T04:30:00+00:00`, ids start `dcbec862` fb, `d6af1f62` ig, `42e981df` yt, `fd7d5272` th).
- `publish_jobs` (4, all `status=scheduled`, `content_type=reel`, `retry_count=0`): 
  `8c5e9461-5fba-4599-96b0-293c325360ec` facebook · `a879498b-e8b4-408d-874e-194ff8562d61` instagram · `1ad76ccb-66c5-4bc9-a6c9-412e94cb7acd` youtube · `865821ef-1b64-4794-bbe2-b870f52e6fda` threads.
- BullMQ `publish-queue`: those same 4 ids, `state=delayed`, `runsAt=2026-09-23T04:30:00Z` (facebook +4 ms), delays 146027982 / 146027544 / 146027024 / 146026558 ms at capture time (delay is fixed at enqueue; it must not change).

### Invariants to prove after a caption edit (Step 3 definition of done)
1. Same `posts.id`; only `content` and `updated_at` changed; `status` unchanged.
2. `schedules`: same 4 rows (ids, `scheduled_at`, `updated_at` unchanged).
3. `publish_jobs`: same 4 rows (ids, `status`, `retry_count`, `updated_at` unchanged).
4. Queue: same 4 delayed jobs (ids, delay, runsAt unchanged) — no job added, removed or re-timed.
5. Totals still `posts=1, schedules=4, publish_jobs=4`; orphan count still 11.
6. After the check, caption restored to the original string above.

## 4. Open item carried over from Step 2
The Step 2 definition of done ("a calendar-created post publishes at the chosen time through the unmodified pipeline") has **still not been observed**: the only post left publishes on 23 Sep 10:00 IST. Options: observe it then, or the owner schedules a Facebook-only post a few minutes ahead from the calendar.

## 5. Step 3 manual checklist (owner, browser)
| # | Check | Expected |
|---|---|---|
| E1 | Click an event | Modal opens with caption, per-platform status list, read-only time and media preview |
| E2 | Scheduled post | Caption editable, Save enabled only when the text changed and is non-empty |
| E3 | Save | Modal closes; calendar event text updates; timeline shows the new caption |
| E4 | Post with a published/processing job | Read-only, with the reason shown |
| E5 | Viewer role | Read-only, no Save |
| E6 | Esc / backdrop / X while saving | Ignored until the save finishes |
| E7 | Create flow (click empty day) | Unchanged (shared modal shell must not break it) |
