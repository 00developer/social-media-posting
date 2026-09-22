# Architecture

## 1. Big picture
```
                         ┌───────────────────────────┐
  Browser (Next.js) ───▶ │ Supabase (Auth, Postgres, │ ◀── direct reads via anon key + RLS
   apps/web              │ Storage, Realtime)        │     (teams, posts+publish_jobs, accounts,
      │                  └───────────────────────────┘      analytics, notifications)
      │  direct fetch to hardcoded http://localhost:PORT  (NO Authorization header)
      ▼
 ┌──────────┬──────────┬───────────┬────────────┬──────────┬───────────┐
 │ account  │ post     │ media     │ scheduling │ team     │ analytics │
 │ :3001    │ :3002    │ :3006     │ :3004      │ :3009    │ :3008     │
 └────┬─────┴────┬─────┴─────┬─────┴─────┬──────┴────┬─────┴─────┬─────┘
      │ service-role Supabase client (bypasses RLS)   │           │
      │                                                ▼           ▼
      │                                    BullMQ `publish-queue`   Redis counters + cron
      │                                            │
      │                                       ┌────▼─────┐   HTTP POST localhost:3003/publish/:jobId
      │                                       │ worker   │──────────────────────────────┐
      │                                       └────┬─────┘                              ▼
      │                                            │ `notifications-queue`     ┌──────────────────┐
      │                                       ┌────▼──────────────┐            │ publishing-service│
      │                                       │ notification-svc  │            │ :3003 (adapters)  │
      │                                       └───────────────────┘            └────────┬─────────┘
      └── OAuth callbacks ◀── Meta / Google / LinkedIn / Pinterest / Twitter ◀───────────┘ platform APIs
```
Two data paths exist and both matter:
- **Read path (frontend → Supabase directly)** governed by RLS (`DashboardProvider.tsx`).
- **Write / action path (frontend → microservice → Supabase with service-role key)**, which **bypasses RLS** and re-implements authorization by hand in each service.

## 2. Frontend (`apps/web`)
- **Routing (App Router):** `/` → redirect `/login`; `/login` (signup + login, Supabase email/password); `/dashboard` → redirect `/dashboard/posts`; `/dashboard/{posts,calendar,accounts,settings}`.
- **Layout chain:** `dashboard/layout.tsx` wraps pages in `DashboardProvider` (global state) → `DashboardShell` (sidebar, team switcher, notifications, logout).
- **State:** a single React context, `DashboardProvider`, holds `user, teams, activeTeam, accounts, posts (with publish_jobs), notifications (last 10), analytics`. `fetchTeamData()` re-queries Supabase for everything and is called after most actions and on Supabase Realtime events (INSERT `notifications`, UPDATE `publish_jobs`, UPDATE `posts`, filtered by `user_id`).
- **Team bootstrap:** if a user has no team, the client inserts a team + owner membership itself (`fetchUserTeams`). This needs RLS INSERT policies that do **not** exist in the migrations (see DATABASE.md).
- **Pages:** `posts/page.tsx` (~745 lines: composer, per-platform preview cards, media upload, timeline, preview modal — one big file), `calendar/page.tsx` (read-only FullCalendar), `accounts/page.tsx` (connect via popup + polling for close), `settings/page.tsx` (invite, mock billing).
- **Styling:** Tailwind utility classes inline; no component library; icons are inline SVG.
- **Backend URL handling:** literal `http://localhost:3001/3002/3004/3006/3009` strings in 4 files (11 call sites: accounts, calendar, posts, settings pages). No env-based base URL, no API client wrapper.
- **`AGENTS.md` in `apps/web`** warns this is a newer Next.js with breaking changes: consult `node_modules/next/dist/docs/` before writing Next code.

## 3. Backend services
All are single-file Express apps (`src/index.ts`), CORS wide open, `express.json()`, a service-role Supabase client, and `dotenv` loading the root `.env`. **There is no shared middleware, no auth middleware, no validation library, no logger, no shared types, no shared Supabase client** — every service copy-pastes its own setup and its own role-check code.

| Service | Responsibility | Key internals |
|---|---|---|
| account-service | OAuth URL + callback for all platforms; disconnect; YouTube refresh | In-memory `oauthStates` Map; `encrypt()` AES-256-CBC (`iv:cipher` hex); role via cache then DB; free-plan cap of 10 accounts |
| post-service | Create/list/delete posts | Redis feed cache (60 s) keyed `feed:<teamId>` and `feed:<teamId>:range:<from>:<to>`; free-plan cap 500 posts |
| media-service | `POST /media/upload` (fan-out per platform), `POST /media/transcode-preview` | Per-platform sharp resize / ffmpeg transcode; uploads to Storage `post_media/<userId>/<randomUUID>/<platform>.<ext>`; 10-min server timeout |
| scheduling-service | `POST /schedules` | Per platform: insert `schedules` row, insert `publish_jobs` row, `publishQueue.add(..., {delay, jobId: publish_jobs.id})`; then set `posts.status='scheduled'` |
| worker | Consumes `publish-queue` | Marks job `processing`, calls publishing-service over HTTP, then `completed`/`failed`, notifies via `notifications-queue` |
| publishing-service | `POST /publish/:jobId` | Loads job/post/account, per-user Upstash rate limit 5/min, decrypts token, dispatches to adapter |
| notification-service | Consumes `notifications-queue` | Inserts `notifications` row; "email" is only `console.log` |
| analytics-service | `POST /analytics/event`; cron every 5 min | Drains Redis counters into `analytics`; pulls YouTube, Pinterest, Threads stats |
| team-service | list teams, invite, billing | Invite looks up a user by listing auth users; billing is a plan toggle |
| packages/shared | `getRedisConnection`, `getQueue`, `getNotificationsQueue`, `getCachedTeamRole/setCachedTeamRole`, `publishRateLimiter` | Compiled to `dist/` (exists locally, **not tracked in git**) |

### Adapter pattern (publishing-service)
`interface PlatformAdapter { publish(post, account, decryptedToken, contentType?, job?) }` and a `adapters` map keyed by platform. Adding a platform = add a class + map entry + `social_accounts.platform` CHECK constraint update + OAuth branch in account-service + frontend platform list (twice: accounts page and posts page) + media-service variant case.

## 4. Inter-service coupling (hardcoded)
| Caller | Callee | How |
|---|---|---|
| worker | publishing-service | `fetch('http://localhost:3003/api/v1/publish/:jobId')` |
| publishing-service (YouTube) | account-service | `fetch('http://localhost:3001/api/v1/auth/youtube/refresh')` |
| analytics-service (YouTube) | account-service | same URL |
| frontend | all services | `http://localhost:<port>` |
Everything else is coupled through **shared DB tables and Redis queue names/keys** (`publish-queue`, `notifications-queue`, `analytics-queue`, `analytics:<postId>:<platform>:<event>`, `team_role:<team>:<user>`, `feed:<team>`).

## 5. Data ownership quirks
- `post.media_url` is a **JSON string** mapping platform → public URL (e.g. `{"instagram":"https://…/instagram.jpg","twitter":"…"}`), not a URL. Every adapter parses it (`JSON.parse(post.media_url).<platform>`), except Pinterest (see KNOWN_ISSUES).
- `posts.status` is written by four different components (post-service, scheduling-service, worker, YouTube adapter) and read by the frontend and calendar.
- `social_accounts` is looked up by `(user_id, platform)` — **not** by `team_id` — in publishing-service and analytics-service.

## 6. Safe vs. dangerous to modify
### Generally safe (isolated, low blast radius)
- New UI pages/components in `apps/web/src/app/dashboard/*` (calendar Steps 2–4 live in `calendar/page.tsx`).
- Adding a new adapter class / new platform *in addition to* existing ones (append-only pattern), provided all six touch points above are updated.
- `notification-service` (leaf consumer). `team-service` (small, leaf).
- Docs, scripts, the `scaffold-*.mjs` generators (one-shot, obsolete).
- Preview components (`PlatformPreviewCard`) — purely presentational.

### Change carefully (coupled)
- **`DashboardProvider.tsx`** — every page depends on its shape (`posts`, `publish_jobs`, `analytics`, `activeTeam.role`).
- **`posts.media_url` JSON contract** — media-service writes it, frontend renders and parses it, all adapters read it.
- **`publish_jobs` status vocabulary** (`scheduled → processing → completed | failed`) — worker, frontend badges, calendar colours, analytics, and Realtime subscriptions all key off it.
- **Queue payload `{jobId, postId, userId, platform}`** and BullMQ `jobId = publish_jobs.id` — needed by the worker and by future reschedule logic.
- **Role cache** (`team_role:*`, 5-min TTL) — role changes are not invalidated; permission changes take up to 5 minutes to apply.
- **Post feed cache** — only invalidated on create/delete in post-service, not on status changes.

### Do not change casually
- **`ENCRYPTION_KEY` (and the encrypt/decrypt format `ivHex:cipherHex`)** — three copies of the decrypt function exist (account, publishing, analytics) plus a script. Changing key or format makes every stored token undecryptable, forcing all users to reconnect. Note the code silently falls back to a hardcoded key if the env var is missing — if the existing tokens were written with the fallback, **setting a "proper" key will break them**.
- **Existing migrations** — never edit; add new ones. The live DB may already differ from them.
- **Service-role client usage** — these calls are the *only* thing enforcing authorization in the write path.
- **The `social_accounts` platform CHECK constraint** — recreated (drop + add) in each platform migration; keep the list cumulative.

### Where future changes most likely break things
1. Adding real JWT auth: every frontend `fetch` and every service signature changes (`userId/teamId` in query/body today).
2. Supporting multiple accounts per platform: publishing/analytics lookups (`.single()` on user+platform), accounts UI (`isConnected` disables the button), Pinterest board rows, Facebook page selection.
3. Deploying services off `localhost`: worker→publishing, publishing/analytics→account, and the whole frontend.
4. Calendar drag-to-reschedule: touches scheduling-service, `schedules`/`publish_jobs` rows, the BullMQ delayed jobs, post-service cache, and the calendar's status colouring.
5. Making retries work: changes to `queue.add` options, worker error handling, and the "post becomes published only when all jobs completed" rule.
