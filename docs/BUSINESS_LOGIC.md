# Business Logic

## 1. Roles & permissions (checked in each service by hand; RLS mirrors it only for direct reads)
| Action | viewer | editor | admin | owner |
|---|---|---|---|---|
| View team data | ✔ | ✔ | ✔ | ✔ |
| Create post / schedule / publish | ✘ | ✔ | ✔ | ✔ |
| Connect account (OAuth) | ✘ | ✔ | ✔ | ✔ |
| Disconnect account | ✘ | ✔ (service) — RLS says admin+ | ✔ | ✔ |
| Delete post | ✘ | ✔ | ✔ | ✔ |
| Invite member | ✘ | ✘ | ✔ | ✔ |
| Change plan (billing) | ✘ | ✘ | ✘ | ✔ |
The frontend also disables composer controls when `activeTeam.role === 'viewer'`.
Role lookup order: Upstash cache `team_role:<team>:<user>` (TTL 5 min) → `team_members` DB row. The cache is only *set*, never deleted (a downgraded/removed member keeps access up to 5 min; there is no removal feature anyway).

## 2. Plans / limits
- `free` (default): **max 10 connected accounts per team** (account-service) and **max 500 posts per team** (post-service; comment says "Increased to 500 for testing" — the intended production value is unknown).
- `pro`: no limits enforced. Upgrading is a mock owner-only toggle; no payment integration.
- Limits are checked only at creation time; the post limit counts all posts including drafts.

## 3. Post lifecycle / status machine
```
draft ──(schedule/publish now)──▶ scheduled ──(worker starts)──▶ [processing*] ──▶ published
   ▲                                   │                                   └────▶ failed
   └── created by POST /posts          └── (per-platform publish_jobs: scheduled → processing → completed | failed)
```
- `publish_jobs.status` is the per-platform truth: `scheduled | processing | completed | failed`.
- `posts.status` is set by: post-service (`draft`), scheduling-service (`scheduled`), worker (`published` when **all** of the post's jobs are `completed`; `failed` after retries exceeded), YouTube adapter (`processing`, never reverted on error). `uploading` exists only in the browser (optimistic card).
- Calendar aggregate colour: failed (post failed or any job failed) → red; `published` → green; `uploading`/any job `processing` → amber; else blue ("Scheduled"). "Partially Published" (yellow) from the design doc is **not implemented**.
- Timeline badge: FAILED if post or any job failed.

## 4. Scheduling rules
- One shared `scheduled_at` for all platforms selected in one action (matches the calendar design doc).
- Past dates: allowed up to 5 minutes in the past (treated as "now"); "Publish Now" sends `now`.
- Timezone string is stored for reference only; the instant is sent as UTC ISO by the browser.
- Delay = `scheduledAt − now`; BullMQ delayed job id = `publish_jobs.id`.
- Timeline shows `schedules[0].scheduled_at` — after a retry (extra schedule rows) this may not be the latest.

## 5. Retry / failure rules (implemented 2026-09-22)
Pure rules live in `services/worker/src/failureRules.ts`; the worker (`services/worker/src/index.ts`) applies them.
- **Permanent failure** (HTTP 400/401/403/404/422 from publishing-service, or a message like "not connected", "requires a video", "exceeds", "token expired", "not implemented"): fail at once, no retry.
- **Transient failure** (network errors, 5xx, processing timeouts): up to **3 attempts**; the job stays `scheduled` with `retry_count` = failed attempts and the note "Attempt n/3 failed: … Retrying automatically in 1 min." (then 2 min). The counter is `job.data.failures` (BullMQ `attempts` is not used). Env overrides: `PUBLISH_MAX_ATTEMPTS`, `PUBLISH_RETRY_BASE_MS`.
- **Final failure:** `publish_jobs.status='failed'`, plain error, post status re-derived (`derivePostStatus`: published if the latest job of every platform completed; failed if all finished and any failed; untouched while something is scheduled/processing), and a `failure` notification ("… after 3 attempts: reason"). Bookkeeping errors never fail an already published job (that would cause duplicate posts).
- **Retry button:** `POST /api/v1/posts/:postId/retry` re-queues only the latest-per-platform failed jobs as NEW `publish_jobs` rows (old rows stay as history), post -> `scheduled`. Viewers refused; nothing failed -> 409 `NOTHING_TO_RETRY`; a platform in flight is not duplicated. UI: timeline "Retry failed (n)", calendar modal "Retry failed platforms (n)". "Failed" always means the LATEST job per platform.
- **Rate-limit handling:** HTTP 429 from publishing-service (per-user 5/min Upstash limit, Facebook Reels 30/24 h, Threads quota) → worker tries to delay the job 1 hour and resets DB status to `scheduled`.

## 6. Per-platform content rules (enforced in code)
| Platform | Rules found |
|---|---|
| Twitter/X | text only (`v2.tweet(content)`); media ignored; image variant 1200×675 is generated but unused |
| Facebook | Publishes to the **first** page returned by `/me/accounts` (fallback to `debug_token` granular scopes). Photo if media else text feed post. Reel: needs video; 3-phase upload; **30 reels / 24 h** self-counted; video 3–90 s |
| Instagram | Needs media. First page with a linked IG business account. Image 1080×1350 cover. Reel: `REELS`, ≤90 s, polls container ≤2 min |
| YouTube | Needs a video (jpg/png rejected). Resumable upload, privacy **`unlisted`**, title = first 100 chars, `#Shorts` appended for reels, reel ≤180 s. Polls processing ≤60 s then continues |
| LinkedIn | Author = person URN (`provider_account_id`) or organization URN; uploads image/video via REST `202401`; visibility PUBLIC |
| Pinterest | Needs an image (or video for reel). Board = job's `pinterest_board_id` or the account's default board. Title = first 95 chars. Image variant 1000×1500 |
| Threads | Text ≤ **500 UTF-8 bytes** (checked in adapter); queries `threads_publishing_limit` first (250/24 h); TEXT/IMAGE/VIDEO; polls container ≤2 min; video ≤300 s; image ≤1440 px wide |
| TikTok | Adapter only logs; nothing is published |
General: all-platform video is re-encoded H.264/AAC yuv420p, width capped at 1920 (1080 for reels except Threads).

## 7. Notifications
Success/failure messages built by the worker ("<excerpt> to <platform> has been successfully published."). Stored in `notifications`, pushed to the browser by Supabase Realtime (last 10 shown; sidebar shows 4). Emails are simulated with `console.log`.

## 8. Analytics semantics
Stored per (post, platform) as `views/likes/shares`, refreshed every 5 min for YouTube, Pinterest, Threads. `shares` means different things per platform (see DATABASE.md). The UI only renders the analytics block on posts whose status is `scheduled` (likely a bug — it should be published posts).

## 9. Token/credential handling
Access and refresh tokens are encrypted with AES-256-CBC (`ENCRYPTION_KEY`, 32 bytes, random IV) before storage and decrypted in publishing/analytics/account services. Only YouTube tokens are ever refreshed; Meta (60-day), Threads (60-day), Pinterest and LinkedIn tokens are stored but not refreshed (see KNOWN_ISSUES).
