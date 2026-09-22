# Project Overview

## Purpose
**SocialPush** is a multi-platform social media publishing and scheduling tool ("write once, publish everywhere"). A user (or team) connects social accounts via OAuth, composes a post with optional image/video, picks target platforms, and either publishes immediately or schedules it. A background worker publishes through per-platform adapters and notifies the user. Analytics are periodically pulled back per post.

Target platforms (adapter present): Twitter/X, Facebook (Pages), Instagram (Business), YouTube, LinkedIn, TikTok (stub), Pinterest, Threads. Content types: `post` and `reel` (Reels/Shorts/vertical video).

## Tech stack
| Layer | Tech |
|---|---|
| Frontend | Next.js **16.3.5** (App Router), React **19.2.8**, Tailwind CSS 4, TypeScript, FullCalendar (calendar page) |
| Backend | Node.js + Express 4 microservices in TypeScript (run with `ts-node-dev`), one npm workspace each |
| DB / Auth / Storage | Supabase (Postgres + RLS + Supabase Auth email/password + Storage bucket `post_media`, cloud project) |
| Queue | BullMQ 4 on Redis (`REDIS_URL`, ioredis; TLS auto-enabled for `rediss://`/upstash) |
| Cache / rate limit | Upstash Redis REST (`@upstash/redis`, `@upstash/ratelimit`) — optional |
| Media | `sharp` (images), `fluent-ffmpeg` + `ffmpeg-static`/`ffprobe-static` (video), `multer` (memory storage) |
| Infra artifacts | `infra/docker-compose.yml` (Redis only), `k8s/deployments.yaml` (illustrative), `.github/workflows/ci.yml` |
| Deploy in use | Frontend on **Vercel** (recent commits fix Vercel builds); backend runs locally, exposed to OAuth providers through a **cloudflared** tunnel (`API_BASE_URL`) |

## Repo layout (monorepo, npm workspaces: `apps/*`, `services/*`, `packages/*`)
```
apps/web/                 Next.js dashboard (login, posts, calendar, accounts, settings)
services/account-service  OAuth connect/disconnect, token encryption, YouTube token refresh   :3001
services/post-service     Post CRUD + cached feed / calendar range query                       :3002
services/publishing-service Platform adapters + POST /publish/:jobId                           :3003
services/scheduling-service Creates schedules + publish_jobs + BullMQ delayed jobs             :3004
services/media-service    Upload, per-platform image/video variants, preview transcode         :3006
services/analytics-service Event counter API + 5-min cron syncing platform stats               :3008
services/team-service     List teams, invite member, (mock) billing plan                       :3009
services/worker           BullMQ consumer of `publish-queue` → calls publishing-service        (no port)
services/notification-service BullMQ consumer of `notifications-queue` → DB row + mock email    (no port)
packages/shared           Redis/BullMQ helpers, role cache, rate limiter (@socialpush/shared)
supabase/migrations       16 SQL migrations
docs/                     This documentation
```
Port numbers are defaults hardcoded in each service (`process.env.PORT || 300x`); there is no port 3005/3007.

## Running locally (as intended by README / root package.json)
1. `npm install` at the root.
2. Root `.env` (loaded by every service via `dotenv` from `../../../.env`). Keys present in the current `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `UPSTASH_REDIS_REST_URL/TOKEN`, `FACEBOOK_APP_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `THREADS_CLIENT_ID/SECRET`, `API_BASE_URL`. Optional keys read by code but **not** in `.env`: `ENCRYPTION_KEY`, `TWITTER_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET/REDIRECT_URI`, `PINTEREST_CLIENT_ID/SECRET/REDIRECT_URI`.
3. `apps/web/.env.local` must hold `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the frontend does not read the root `.env`).
4. `packages/shared` must be built (`npm run build -w @socialpush/shared`) — services import its compiled `dist/`. No root script does this.
5. `npm run dev:all` (runs web + all services concurrently). **Note:** the `dev:all` script references `dev:*` scripts that all exist, but it does not build `shared`.
6. Redis must be reachable (`docker compose -f infra/docker-compose.yml up` or a hosted Redis).
7. For OAuth (Meta requires HTTPS), start a tunnel (`cloudflared.exe` sits in the repo root, untracked) and set `API_BASE_URL` to the tunnel URL; register `<API_BASE_URL>/api/v1/auth/<platform>/callback` with each provider.

## Users & tenancy model
Email/password users (Supabase Auth). Every resource belongs to a **team** (`team_id`); each user gets a team (auto-created on first login), with roles `owner | admin | editor | viewer`. Plans `free | pro` gate account/post counts. See BUSINESS_LOGIC.md.
