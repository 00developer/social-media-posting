# API Map

**Auth model for every endpoint below: none.** Identity is whatever `userId` / `teamId` / `inviterId` / `requesterId` the caller supplies (query string or JSON body). No token is verified. CORS is `*`. Treat every endpoint as public.

Base URLs are `http://localhost:<port>` (hardcoded in the frontend). Responses are mostly `{success:true,...}` or `{error:string}`.

## account-service (:3001) — `services/account-service/src/index.ts`
| Method & path | Input | Behaviour |
|---|---|---|
| `GET /api/v1/auth/:platform/url` | query `userId, teamId` | Role check (non-viewer) + free-plan ≤10 accounts (402). Returns `{url}` for `twitter` (OAuth2 PKCE via twitter-api-v2), `facebook`/`instagram` (FB dialog v18.0), `threads` (threads.net/oauth), `youtube` (Google, offline+consent), `linkedin`, `pinterest`, `tiktok` (mock: URL points back at own callback). Unknown → 400. |
| `GET /api/v1/auth/:platform/callback` | query `state, code` | Looks up `oauthStates`, exchanges code, encrypts, inserts `social_accounts`, returns HTML that closes the popup. Errors → `500 "Authentication failed"`. |
| `DELETE /api/v1/auth/accounts/:id` | query `userId, teamId` | Non-viewer role check (note: viewers blocked; editors *can* delete although RLS says admin+); deletes `social_accounts` row by id+team. |
| `POST /api/v1/auth/youtube/refresh` | body `{accountId}` | Refreshes Google token, re-encrypts and saves, returns `{success, accessToken}`. Internal use by publishing/analytics; also publicly callable. |
Also exports `refreshYouTubeToken()` (not imported anywhere).

## post-service (:3002)
| Method & path | Input | Behaviour |
|---|---|---|
| `GET /api/v1/posts` | query `userId, teamId, [from, to]` | Any role. Without range: last 50 posts (+`user:user_id(email)`, `publish_jobs`, `schedules`), cached 60 s. With `from`&`to`: posts with `schedules!inner` in range, cached under a range key. Response includes `source: cache|database`. |
| `POST /api/v1/posts` | body `userId, teamId, content, mediaUrl` | Non-viewer; free plan ≤500 posts (402). Inserts `status='draft'`. Deletes `feed:<team>` cache. |
| `DELETE /api/v1/posts/:id` | query `userId, teamId` | Non-viewer. Deletes post (cascade). **Does not cancel queued BullMQ jobs.** Invalidates feed cache. |
| `PATCH /api/v1/posts/:id` | body `userId, teamId, content` | **Caption edit only** (added for Calendar Step 3, logic in `src/editability.ts`). ids must be UUIDs (400); non-member/viewer → 403; post looked up within the team (404). **409 `NOT_EDITABLE`** when any platform's latest job is `processing` or `completed`; otherwise editable (draft, scheduled, failed, or a mix). Content must be a non-empty string ≤ 10 000 chars (400); if a Threads job exists, ≤ 500 UTF-8 bytes (400, same rule as the adapter). Same content → `200 {unchanged:true}` with no write. Writes only `posts.content` + `updated_at` (set explicitly); never touches schedules, jobs or the queue; invalidates the feed cache. |
Not present: update/edit post, get single post, reschedule (planned as `PATCH /api/v1/posts/:postId/reschedule`), `/health` (referenced by `scripts/load-test.js`).

## scheduling-service (:3004)
| `POST /api/v1/schedules` | body `userId, postId, platforms[], scheduledAt (ISO), timezone, [contentType]` | Non-viewer (via post's team). Rejects invalid or > 5 min past dates. For each platform: `schedules` + `publish_jobs` insert + BullMQ delayed job (`jobId = publish_jobs.id`). Sets `posts.status='scheduled'`. Not transactional: a failure mid-loop leaves partial rows and jobs. Does **not** verify a connected account exists for each platform. |
| `POST /api/v1/posts/:postId/retry` | body `userId, [platforms[]]` | Non-viewer. Re-queues the latest failed job per platform (optionally only `platforms`) as new `publish_jobs` rows + BullMQ jobs; post -> `scheduled`. 400 bad ids/platforms, 403 viewer/non-member, 404 post, 409 `{code:'NOTHING_TO_RETRY'}`. Returns `{success, retried[], jobs[]}`. |

## media-service (:3006)
| `POST /api/v1/media/upload` | multipart `file`, `userId`, `platforms` (comma list), `contentType` | Builds per-platform variants, uploads (3 tries) to Storage, returns `{success, mediaUrls:{platform:url}}`. No size limit, no auth, in-memory buffering. |
| `POST /api/v1/media/transcode-preview` | multipart `file` | 480p H.264 mp4 streamed back (used for browser preview). |
Server timeout 10 min.

## publishing-service (:3003)
| `POST /api/v1/publish/:jobId` | path `jobId` | Internal (called by worker). Rate limit 5/min/user (Upstash only). Runs the adapter. `404` job/post/account missing; `400` no adapter; `429` rate limit; `500` other. Sets `X-RateLimit-*` headers. |

## team-service (:3009)
| `GET /api/v1/teams` | query `userId` | Teams + role for user. (Unused by the frontend, which reads Supabase directly.) |
| `POST /api/v1/teams/:teamId/invite` | body `email, role, inviterId` | owner/admin only; existing users only. Role value is not validated against the enum (DB CHECK catches it). |
| `POST /api/v1/teams/:teamId/billing` | body `plan, requesterId` | owner only; `plan` unvalidated. |

## analytics-service (:3008)
| `POST /api/v1/analytics/event` | body `postId, platform, eventType (views|likes|shares)` | `INCR analytics:<post>:<platform>:<event>`. Unauthenticated, no caller in repo. |
Plus a BullMQ repeatable job `sync-analytics` every 5 min on `analytics-queue` (worker lives in the same process).

## Queues / workers
| Queue | Producer | Consumer | Payload |
|---|---|---|---|
| `publish-queue` | scheduling-service (delayed, `jobId = publish_jobs.id`) | `services/worker` | `{jobId, postId, userId, platform}` — no BullMQ `attempts`/`backoff` (the worker retries via `job.data.failures` + `moveToDelayed`); jobs may carry `failures` |
| `notifications-queue` | worker | notification-service | `{userId, type: 'success'|'failure', message}` |
| `analytics-queue` | analytics-service (repeat `*/5 * * * *`) | analytics-service | `{}` |

## External OAuth endpoints registered per provider
`<API_BASE_URL>/api/v1/auth/{twitter|facebook|instagram|threads|linkedin|pinterest|tiktok}/callback`; YouTube uses `GOOGLE_REDIRECT_URI` (the `.env` value points at a `/api/v1/auth/youtube/callback` path on the account-service host).

## Frontend → backend call sites (all hardcoded localhost)
`accounts/page.tsx` (3001 ×2) · `posts/page.tsx` (3006 ×2, 3002 ×2, 3004 ×2) · `calendar/page.tsx` (3002) · `settings/page.tsx` (3009 ×2). Direct Supabase reads/writes: `DashboardProvider.tsx`, `login/page.tsx`.
